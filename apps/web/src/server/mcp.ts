import {
  bugStateSchema,
  issueCardSchema,
  issueContextSchema,
  issueKindSchema,
  wishStateSchema,
} from "@openwish/shared";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

import { resolveAppStoreMetadata } from "./app-store";
import { requireMcpBearer, requireProjectBySlug } from "./auth";
import { isScreenshotKeyForProject } from "./bug-constants";
import { parseGitHubLink } from "./github-links";
import { dashboardMcpSubject, mcpAuthChallenge, mcpResource, mcpScopeFor, type McpAccess } from "./mcp-access";
import {
  addGitHubLink,
  bootstrapProject,
  createBugComment,
  createComment,
  createIssueNote,
  createV2Issue,
  createWish,
  deleteBug,
  deleteProject,
  deleteWish,
  getBugMeta,
  getReporterContact,
  getWishMeta,
  loadAdminBugs,
  loadAdminProject,
  loadGitHubLinksFor,
  loadIssueNotes,
  loadProjectAnalytics,
  loadProjectById,
  loadProjectSummaries,
  mergeWish,
  removeGitHubLink,
  updateBug,
  updateProjectSettings,
  updateWish,
  upsertUser,
} from "./db";
import { sendTestEmail } from "./notifications";
import { notifyReporter } from "./reporter-notify";
import type { Bindings, ProjectRow } from "./types";

const slug = z.string().min(2).max(60).regex(/^[a-z0-9-]+$/).describe("OpenWish project slug");
const uuid = z.string().uuid();
const githubTarget = z
  .enum(["feature", "issue"])
  .describe("'feature' for a feature request (featureId), 'issue' for a bug or card-data issue (issueId)");
const githubUrl = z
  .string()
  .min(1)
  .max(500)
  .describe("GitHub issue or pull request URL, e.g. https://github.com/owner/repo/issues/12 or https://github.com/owner/repo/pull/34");

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function failure(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function projectFor(env: Bindings, projectSlug: string, access?: McpAccess): Promise<ProjectRow> {
  const found = await requireProjectBySlug({ env }, projectSlug);
  if (!found.ok) {
    throw new Error(`OpenWish project '${projectSlug}' was not found.`);
  }
  if (access && !access.projectIds.includes(found.project.id)) {
    throw new Error("This project is not part of this authorization.");
  }
  return found.project;
}

function registerTools(server: McpServer, env: Bindings, request: Request, access?: McpAccess) {
  const listedTools: Array<{
    name: string;
    registered: ReturnType<McpServer["registerTool"]>;
    securitySchemes: Array<{ type: "oauth2"; scopes: string[] }>;
  }> = [];
  // Keep the SDK's schema inference at call sites, while enforcing authorization
  // centrally before any tool callback (including future tools) can run.
  const registerTool = ((...args: Parameters<McpServer["registerTool"]>) => {
    const [name, config, callback] = args;
    const scope = mcpScopeFor(config.annotations);
    const required = scope === "mcp:read" ? [scope] : ["mcp:read", scope];
    const securitySchemes = [{ type: "oauth2" as const, scopes: required }];
    const registered = server.registerTool(name, {
      ...config,
      _meta: {
        ...config._meta,
        securitySchemes,
      },
    }, async (input, extra) => {
      if (access) {
        if (name === "openwish_create_project") {
          return failure("Creating projects and SDK credentials requires API-key access.");
        }
        if (!required.every((needed) => access.scopes.includes(needed))) {
          const description = "Approve the requested permission before using this tool.";
          return {
            ...failure(description),
            _meta: { "mcp/www_authenticate": [mcpAuthChallenge(mcpResource(env, request), required, description)] },
          };
        }
        if (name !== "openwish_list_projects") {
          if (typeof input.project !== "string") return failure("A project-scoped authorization is required.");
          const found = await requireProjectBySlug({ env }, input.project);
          if (!found.ok || !access.projectIds.includes(found.project.id)) {
            return failure("This project is not part of this authorization.");
          }
        }
      }
      return callback(input, extra);
    });
    if (access && name === "openwish_create_project") registered.disable();
    listedTools.push({ name, registered, securitySchemes });
    return registered;
  }) as McpServer["registerTool"];

  registerTool(
    "openwish_list_projects",
    {
      title: "List OpenWish projects",
      description: "List every OpenWish project and its public dashboard metadata. API keys are omitted.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const projects = await loadProjectSummaries(env.DB);
      const allowed = access
        ? (await Promise.all(projects.map(async (project) => {
            const found = await requireProjectBySlug({ env }, project.slug);
            return found.ok && access.projectIds.includes(found.project.id) ? project : null;
          }))).filter((project) => project !== null)
        : projects;
      return result({
        projects: allowed.map(({ apiKey: _apiKey, ...project }) => project),
      });
    },
  );

  registerTool(
    "openwish_create_project",
    {
      title: "Create an OpenWish project",
      description: "Create a project and return its one-time SDK and admin credentials.",
      inputSchema: z.object({
        name: z.string().min(1).max(120),
        slug,
        watermarkEnabled: z.boolean().default(false),
      }),
      annotations: { destructiveHint: false },
    },
    async (input) => result(await bootstrapProject(env.DB, input)),
  );

  registerTool(
    "openwish_get_project",
    {
      title: "Get project and features",
      description: "Get project settings, totals, feature requests, votes, and comments.",
      inputSchema: z.object({ project: slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => result(await loadAdminProject(env.DB, await projectFor(env, project, access))),
  );

  registerTool(
    "openwish_get_project_analytics",
    {
      title: "Get project analytics",
      description: "Get views, votes, feature-request totals, engagement rate, and daily series.",
      inputSchema: z.object({ project: slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => result(await loadProjectAnalytics(env.DB, await projectFor(env, project, access))),
  );

  registerTool(
    "openwish_update_project_settings",
    {
      title: "Update project settings",
      description: "Update notification email, public form, watermark, or App Store link.",
      inputSchema: z.object({
        project: slug,
        watermarkEnabled: z.boolean().optional(),
        notificationEmail: z.string().email().nullable().optional(),
        publicFormEnabled: z.boolean().optional(),
        appStoreUrl: z.string().url().nullable().optional(),
      }),
    },
    async ({ project, appStoreUrl, ...settings }) => {
      const row = await projectFor(env, project, access);
      const patch: Parameters<typeof updateProjectSettings>[2] = settings;
      if (appStoreUrl !== undefined) {
        if (appStoreUrl === null) {
          Object.assign(patch, { appStoreUrl: null, appId: null, appName: null, appIconUrl: null });
        } else {
          const metadata = await resolveAppStoreMetadata(appStoreUrl);
          Object.assign(patch, {
            appStoreUrl,
            appId: metadata?.appId ?? null,
            appName: metadata?.appName ?? null,
            appIconUrl: metadata?.appIconUrl ?? null,
          });
        }
      }
      await updateProjectSettings(env.DB, row.id, patch);
      return result(await loadAdminProject(env.DB, (await loadProjectById(env.DB, row.id)) ?? row));
    },
  );

  registerTool(
    "openwish_delete_project",
    {
      title: "Delete project",
      description: "Permanently delete an OpenWish project and its feedback.",
      inputSchema: z.object({ project: slug, confirmProjectSlug: slug }),
      annotations: { destructiveHint: true },
    },
    async ({ project, confirmProjectSlug }) => {
      if (project !== confirmProjectSlug) return failure("confirmProjectSlug must exactly match project.");
      const row = await projectFor(env, project, access);
      await deleteProject(env.DB, project, row.id);
      return result({ deleted: true, project });
    },
  );

  registerTool(
    "openwish_create_feature",
    {
      title: "Create feature request",
      description: "Create a feature request for a project. Optionally store a reporter email.",
      inputSchema: z.object({
        project: slug,
        title: z.string().min(1).max(50),
        description: z.string().min(1).max(500),
        state: wishStateSchema.default("pending"),
        reporterEmail: z.string().email().optional(),
        reporterUserId: uuid.optional(),
      }),
    },
    async ({ project, reporterEmail, reporterUserId, ...input }) => {
      const row = await projectFor(env, project, access);
      const userId = reporterUserId ?? crypto.randomUUID();
      if (reporterEmail) await upsertUser(env.DB, row.id, userId, { email: reporterEmail });
      return result(await createWish(env.DB, row, userId, { ...input, email: reporterEmail }));
    },
  );

  registerTool(
    "openwish_update_feature",
    {
      title: "Update feature request",
      description: "Edit a feature or change its workflow state. Transitioning to implemented emails the reporter when possible.",
      inputSchema: z.object({
        project: slug,
        featureId: uuid,
        title: z.string().min(1).max(50).optional(),
        description: z.string().min(1).max(500).optional(),
        state: wishStateSchema.optional(),
      }),
    },
    async ({ project, featureId, ...patch }) => {
      const row = await projectFor(env, project, access);
      const before = await getWishMeta(env.DB, row.id, featureId);
      if (!before) return failure("Feature request not found.");
      await updateWish(env.DB, row.id, featureId, patch);
      let reporterNotification = "not_requested";
      if (patch.state === "implemented" && before.state !== "implemented") {
        const contact = await getReporterContact(env.DB, row.id, before.userUuid);
        reporterNotification = await notifyReporter({ env }, row, {
          event: "resolved", kind: "wish", userUuid: before.userUuid, title: before.title,
          to: contact.email, unsubscribed: contact.unsubscribed,
        });
      }
      return result({ reporterNotification, project: await loadAdminProject(env.DB, row) });
    },
  );

  registerTool(
    "openwish_reply_to_feature",
    {
      title: "Reply to feature reporter",
      description: "Add an admin comment and email it to the feature reporter when possible.",
      inputSchema: z.object({ project: slug, featureId: uuid, message: z.string().min(1).max(2_000) }),
    },
    async ({ project, featureId, message }) => {
      const row = await projectFor(env, project, access);
      const meta = await getWishMeta(env.DB, row.id, featureId);
      if (!meta) return failure("Feature request not found.");
      await createComment(env.DB, row.id, featureId, crypto.randomUUID(), message, true);
      const contact = await getReporterContact(env.DB, row.id, meta.userUuid);
      const reporterNotification = await notifyReporter({ env }, row, {
        event: "comment", kind: "wish", userUuid: meta.userUuid, title: meta.title,
        to: contact.email, unsubscribed: contact.unsubscribed, comment: message,
      });
      return result({ reporterNotification, project: await loadAdminProject(env.DB, row) });
    },
  );

  registerTool(
    "openwish_merge_features",
    {
      title: "Merge feature requests",
      description: "Move votes and comments from a source feature into a target, then delete the source.",
      inputSchema: z.object({ project: slug, sourceFeatureId: uuid, targetFeatureId: uuid }),
      annotations: { destructiveHint: true },
    },
    async ({ project, sourceFeatureId, targetFeatureId }) => {
      const row = await projectFor(env, project, access);
      const merged = await mergeWish(env.DB, row.id, sourceFeatureId, targetFeatureId);
      return merged ? result(await loadAdminProject(env.DB, row)) : failure("Both features must exist and be different.");
    },
  );

  registerTool(
    "openwish_delete_feature",
    {
      title: "Delete feature request",
      description: "Permanently delete one feature request, including votes and comments.",
      inputSchema: z.object({ project: slug, featureId: uuid }),
      annotations: { destructiveHint: true },
    },
    async ({ project, featureId }) => {
      const row = await projectFor(env, project, access);
      return (await deleteWish(env.DB, row.id, featureId))
        ? result({ deleted: true, featureId })
        : failure("Feature request not found.");
    },
  );

  registerTool(
    "openwish_list_issues",
    {
      title: "List bugs and card-data issues",
      description: "List all issues with device/app context, selected card data, screenshots, comments, and reporter contact.",
      inputSchema: z.object({ project: slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => result({ list: await loadAdminBugs(env.DB, await projectFor(env, project, access)) }),
  );

  registerTool(
    "openwish_create_issue",
    {
      title: "Create bug or card-data issue",
      description: "Create a bug or card-data issue with generic diagnostic JSON and optional card metadata.",
      inputSchema: z.object({
        project: slug,
        kind: issueKindSchema.default("bug"),
        title: z.string().min(1).max(80),
        description: z.string().min(1).max(2_000),
        reporterEmail: z.string().email().optional(),
        reporterUserId: uuid.optional(),
        context: issueContextSchema.default({}),
        card: issueCardSchema.nullable().optional(),
        screenshotKeys: z.array(z.string().min(1).max(256)).max(4).default([]),
      }),
    },
    async ({ project, reporterEmail, reporterUserId, ...input }) => {
      const row = await projectFor(env, project, access);
      for (const key of input.screenshotKeys) {
        if (!isScreenshotKeyForProject(key, row.id) || !(await env.BUGS_BUCKET.head(key))) {
          return failure("Screenshot keys must identify existing screenshots in this project.");
        }
      }
      return result(await createV2Issue(env.DB, row, reporterUserId ?? crypto.randomUUID(), {
        ...input, email: reporterEmail,
      }));
    },
  );

  registerTool(
    "openwish_update_issue",
    {
      title: "Update issue",
      description: "Edit an issue or change its state. Transitioning to fixed emails the reporter when possible.",
      inputSchema: z.object({
        project: slug,
        issueId: uuid,
        title: z.string().min(1).max(80).optional(),
        description: z.string().min(1).max(2_000).optional(),
        state: bugStateSchema.optional(),
      }),
    },
    async ({ project, issueId, ...patch }) => {
      const row = await projectFor(env, project, access);
      const before = await getBugMeta(env.DB, row.id, issueId);
      if (!before) return failure("Issue not found.");
      const issue = await updateBug(env.DB, row, issueId, patch);
      let reporterNotification = "not_requested";
      if (patch.state === "fixed" && before.state !== "fixed") {
        const contact = await getReporterContact(env.DB, row.id, before.userUuid);
        reporterNotification = await notifyReporter({ env }, row, {
          event: "resolved", kind: "bug", userUuid: before.userUuid, title: before.title,
          to: before.reporterEmail ?? contact.email, unsubscribed: contact.unsubscribed,
        });
      }
      return result({ reporterNotification, issue });
    },
  );

  registerTool(
    "openwish_reply_to_issue",
    {
      title: "Reply to issue reporter",
      description: "Add an admin reply and email it to the issue reporter when possible.",
      inputSchema: z.object({ project: slug, issueId: uuid, message: z.string().min(1).max(2_000) }),
    },
    async ({ project, issueId, message }) => {
      const row = await projectFor(env, project, access);
      const meta = await getBugMeta(env.DB, row.id, issueId);
      if (!meta) return failure("Issue not found.");
      const issue = await createBugComment(env.DB, row, issueId, crypto.randomUUID(), message, true);
      const contact = await getReporterContact(env.DB, row.id, meta.userUuid);
      const reporterNotification = await notifyReporter({ env }, row, {
        event: "comment", kind: "bug", userUuid: meta.userUuid, title: meta.title,
        to: meta.reporterEmail ?? contact.email, unsubscribed: contact.unsubscribed, comment: message,
      });
      return result({ reporterNotification, issue });
    },
  );

  registerTool(
    "openwish_list_issue_notes",
    {
      title: "List private issue notes",
      description: "List maintainer-only notes. Notes are never emailed to the reporter.",
      inputSchema: z.object({ project: slug, issueId: uuid }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, issueId }) => {
      const row = await projectFor(env, project, access);
      return result({ list: await loadIssueNotes(env.DB, row.id, issueId) });
    },
  );

  registerTool(
    "openwish_add_issue_note",
    {
      title: "Add private issue note",
      description: "Add a maintainer-only implementation note. This never emails the reporter.",
      inputSchema: z.object({ project: slug, issueId: uuid, body: z.string().min(1).max(4_000) }),
    },
    async ({ project, issueId, body }) => {
      const row = await projectFor(env, project, access);
      const note = await createIssueNote(env.DB, row.id, issueId, body);
      return note ? result(note) : failure("Issue not found.");
    },
  );

  // GitHub links are stored per feature request or issue and show up in the
  // dashboard plus the githubLinks field of openwish_get_project/list_issues.
  async function githubTargetExists(projectId: string, target: "feature" | "issue", targetId: string) {
    return target === "feature"
      ? Boolean(await getWishMeta(env.DB, projectId, targetId))
      : Boolean(await getBugMeta(env.DB, projectId, targetId));
  }

  registerTool(
    "openwish_link_github",
    {
      title: "Link GitHub issue or pull request",
      description:
        "Link a GitHub issue or pull request to a feature request or issue so the dashboard shows it. Linking the same URL again only updates its title. This never notifies the reporter.",
      inputSchema: z.object({
        project: slug,
        target: githubTarget,
        targetId: uuid.describe("featureId or issueId"),
        url: githubUrl,
        title: z.string().min(1).max(200).optional().describe("Title of the GitHub issue or pull request"),
      }),
    },
    async ({ project, target, targetId, url, title }) => {
      const row = await projectFor(env, project, access);
      const link = parseGitHubLink(url);
      if (!link) return failure("url must be a GitHub issue or pull request URL such as https://github.com/owner/repo/issues/12.");
      if (!(await githubTargetExists(row.id, target, targetId))) {
        return failure(target === "feature" ? "Feature request not found." : "Issue not found.");
      }
      const targetType = target === "feature" ? "wish" : "bug";
      await addGitHubLink(env.DB, row.id, targetType, targetId, link, title?.trim() || null);
      return result({ target, targetId, githubLinks: await loadGitHubLinksFor(env.DB, row.id, targetType, targetId) });
    },
  );

  registerTool(
    "openwish_unlink_github",
    {
      title: "Unlink GitHub issue or pull request",
      description: "Remove a linked GitHub issue or pull request from a feature request or issue. The GitHub item itself is untouched.",
      inputSchema: z.object({ project: slug, target: githubTarget, targetId: uuid.describe("featureId or issueId"), url: githubUrl }),
    },
    async ({ project, target, targetId, url }) => {
      const row = await projectFor(env, project, access);
      const link = parseGitHubLink(url);
      if (!link) return failure("url must be a GitHub issue or pull request URL such as https://github.com/owner/repo/issues/12.");
      const targetType = target === "feature" ? "wish" : "bug";
      if (!(await removeGitHubLink(env.DB, row.id, targetType, targetId, link.url))) {
        return failure("That GitHub link is not attached to this item.");
      }
      return result({ target, targetId, githubLinks: await loadGitHubLinksFor(env.DB, row.id, targetType, targetId) });
    },
  );

  registerTool(
    "openwish_delete_issue",
    {
      title: "Delete issue",
      description: "Permanently delete an issue, comments, and stored screenshots.",
      inputSchema: z.object({ project: slug, issueId: uuid }),
      annotations: { destructiveHint: true },
    },
    async ({ project, issueId }) => {
      const row = await projectFor(env, project, access);
      const deleted = await deleteBug(env.DB, env.BUGS_BUCKET, row, issueId);
      return deleted.deleted ? result({ deleted: true, issueId, screenshotsDeleted: deleted.screenshotKeys.length }) : failure("Issue not found.");
    },
  );

  registerTool(
    "openwish_get_issue_screenshot",
    {
      title: "Read issue screenshot",
      description: "Return one screenshot attached to an issue as MCP image content.",
      inputSchema: z.object({ project: slug, issueId: uuid, key: z.string().min(1).max(256) }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, issueId, key }) => {
      const row = await projectFor(env, project, access);
      const issue = (await loadAdminBugs(env.DB, row)).find((item) => item.id === issueId);
      if (!isScreenshotKeyForProject(key, row.id) || !issue || !issue.screenshotKeys.includes(key)) return failure("Screenshot not found on this issue.");
      const object = await env.BUGS_BUCKET.get(key);
      if (!object) return failure("Screenshot object not found.");
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { content: [{ type: "image" as const, data: btoa(binary), mimeType: object.httpMetadata?.contentType ?? "image/jpeg" }] };
    },
  );

  registerTool(
    "openwish_send_test_email",
    {
      title: "Send project test email",
      description: "Send a test notification email. This causes an external side effect.",
      inputSchema: z.object({ project: slug, to: z.string().email() }),
    },
    async ({ project, to }) => {
      await sendTestEmail(env, to, await projectFor(env, project, access));
      return result({ sent: true, to });
    },
  );

  // SDK v2's high-level tools/list drops nonstandard top-level fields. Publish
  // the OpenAI auth declaration through its public low-level handler, retaining
  // the _meta mirror and the same Standard JSON Schema conversion as the SDK.
  // Tool invocation and schema validation continue through the SDK's handlers.
  server.server.setRequestHandler("tools/list", () => ({
    tools: listedTools.filter(({ registered }) => registered.enabled).map(({ name, registered, securitySchemes }) => ({
      name,
      title: registered.title,
      description: registered.description,
      inputSchema: registered.inputSchema
        ? { type: "object", ...registered.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" }) }
        : { type: "object", properties: {} },
      ...(registered.outputSchema
        ? { outputSchema: registered.outputSchema["~standard"].jsonSchema.output({ target: "draft-2020-12" }) }
        : {}),
      annotations: registered.annotations,
      icons: registered.icons,
      execution: registered.execution,
      securitySchemes,
      _meta: { ...registered._meta, securitySchemes },
    })),
  }));
}

function createOpenWishMcpServer(env: Bindings, request: Request, access?: McpAccess) {
  const server = new McpServer(
    { name: "openwish", version: "2.0.0" },
    {
      instructions:
        "Manage OpenWish projects, feature requests, bugs, card-data issues, replies, notes, linked GitHub issues and pull requests, analytics, and settings. Confirm destructive actions with the user. Never reveal or repeat the bearer token.",
    },
  );
  registerTools(server, env, request, access);
  return server;
}

export async function handleOpenWishMcpRequest(
  request: Request,
  env: Bindings,
  executionContext?: ExecutionContext,
  access?: McpAccess,
): Promise<Response> {
  if (access) {
    const username = env.OPENWISH_DASHBOARD_USERNAME?.trim();
    if (!username || access.subject !== await dashboardMcpSubject(username)) {
      return new Response("Authorization is no longer valid.", { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    if (!access.scopes.includes("mcp:read") || access.projectIds.length === 0) {
      return new Response("Project read permission is required.", {
        status: 403,
        headers: { "Cache-Control": "no-store", "WWW-Authenticate": mcpAuthChallenge(mcpResource(env, request), ["mcp:read"], "Project read permission is required.") },
      });
    }
  } else {
    const auth = requireMcpBearer({ env, request });
    if (!auth.ok) return auth.response;
  }

  const handler = createMcpHandler(() => createOpenWishMcpServer(env, request, access), {
    route: "/mcp",
    allowedHostnames: [new URL(mcpResource(env, request)).hostname, "wishkit.juli.sh", "localhost", "127.0.0.1"],
    allowedOriginHostnames: [new URL(mcpResource(env, request)).hostname, "wishkit.juli.sh", "localhost", "127.0.0.1"],
    corsOptions: false,
    onerror: () => console.error("[openwish] MCP request failed."),
  });
  const context =
    executionContext ??
    ({
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext);
  return handler(request, env, context);
}
