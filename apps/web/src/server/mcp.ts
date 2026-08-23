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
import {
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
  loadIssueNotes,
  loadProjectAnalytics,
  loadProjectById,
  loadProjectSummaries,
  mergeWish,
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

async function projectFor(env: Bindings, projectSlug: string): Promise<ProjectRow> {
  const found = await requireProjectBySlug({ env }, projectSlug);
  if (!found.ok) {
    throw new Error(`OpenWish project '${projectSlug}' was not found.`);
  }
  return found.project;
}

function registerTools(server: McpServer, env: Bindings) {
  server.registerTool(
    "openwish_list_projects",
    {
      title: "List OpenWish projects",
      description: "List every OpenWish project and its public dashboard metadata. API keys are omitted.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const projects = await loadProjectSummaries(env.DB);
      return result({
        projects: projects.map(({ apiKey: _apiKey, ...project }) => project),
      });
    },
  );

  server.registerTool(
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

  server.registerTool(
    "openwish_get_project",
    {
      title: "Get project and features",
      description: "Get project settings, totals, feature requests, votes, and comments.",
      inputSchema: z.object({ project: slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => result(await loadAdminProject(env.DB, await projectFor(env, project))),
  );

  server.registerTool(
    "openwish_get_project_analytics",
    {
      title: "Get project analytics",
      description: "Get views, votes, feature-request totals, engagement rate, and daily series.",
      inputSchema: z.object({ project: slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => result(await loadProjectAnalytics(env.DB, await projectFor(env, project))),
  );

  server.registerTool(
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
      const row = await projectFor(env, project);
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

  server.registerTool(
    "openwish_delete_project",
    {
      title: "Delete project",
      description: "Permanently delete an OpenWish project and its feedback.",
      inputSchema: z.object({ project: slug, confirmProjectSlug: slug }),
      annotations: { destructiveHint: true },
    },
    async ({ project, confirmProjectSlug }) => {
      if (project !== confirmProjectSlug) return failure("confirmProjectSlug must exactly match project.");
      await projectFor(env, project);
      await deleteProject(env.DB, project);
      return result({ deleted: true, project });
    },
  );

  server.registerTool(
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
      const row = await projectFor(env, project);
      const userId = reporterUserId ?? crypto.randomUUID();
      if (reporterEmail) await upsertUser(env.DB, row.id, userId, { email: reporterEmail });
      return result(await createWish(env.DB, row, userId, { ...input, email: reporterEmail }));
    },
  );

  server.registerTool(
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
      const row = await projectFor(env, project);
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

  server.registerTool(
    "openwish_reply_to_feature",
    {
      title: "Reply to feature reporter",
      description: "Add an admin comment and email it to the feature reporter when possible.",
      inputSchema: z.object({ project: slug, featureId: uuid, message: z.string().min(1).max(2_000) }),
    },
    async ({ project, featureId, message }) => {
      const row = await projectFor(env, project);
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

  server.registerTool(
    "openwish_merge_features",
    {
      title: "Merge feature requests",
      description: "Move votes and comments from a source feature into a target, then delete the source.",
      inputSchema: z.object({ project: slug, sourceFeatureId: uuid, targetFeatureId: uuid }),
      annotations: { destructiveHint: true },
    },
    async ({ project, sourceFeatureId, targetFeatureId }) => {
      const row = await projectFor(env, project);
      const merged = await mergeWish(env.DB, row.id, sourceFeatureId, targetFeatureId);
      return merged ? result(await loadAdminProject(env.DB, row)) : failure("Both features must exist and be different.");
    },
  );

  server.registerTool(
    "openwish_delete_feature",
    {
      title: "Delete feature request",
      description: "Permanently delete one feature request, including votes and comments.",
      inputSchema: z.object({ project: slug, featureId: uuid }),
      annotations: { destructiveHint: true },
    },
    async ({ project, featureId }) => {
      const row = await projectFor(env, project);
      return (await deleteWish(env.DB, row.id, featureId))
        ? result({ deleted: true, featureId })
        : failure("Feature request not found.");
    },
  );

  server.registerTool(
    "openwish_list_issues",
    {
      title: "List bugs and card-data issues",
      description: "List all issues with device/app context, selected card data, screenshots, comments, and reporter contact.",
      inputSchema: z.object({ project: slug }),
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => result({ list: await loadAdminBugs(env.DB, await projectFor(env, project)) }),
  );

  server.registerTool(
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
      const row = await projectFor(env, project);
      return result(await createV2Issue(env.DB, row, reporterUserId ?? crypto.randomUUID(), {
        ...input, email: reporterEmail,
      }));
    },
  );

  server.registerTool(
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
      const row = await projectFor(env, project);
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

  server.registerTool(
    "openwish_reply_to_issue",
    {
      title: "Reply to issue reporter",
      description: "Add an admin reply and email it to the issue reporter when possible.",
      inputSchema: z.object({ project: slug, issueId: uuid, message: z.string().min(1).max(2_000) }),
    },
    async ({ project, issueId, message }) => {
      const row = await projectFor(env, project);
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

  server.registerTool(
    "openwish_list_issue_notes",
    {
      title: "List private issue notes",
      description: "List maintainer-only notes. Notes are never emailed to the reporter.",
      inputSchema: z.object({ project: slug, issueId: uuid }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, issueId }) => {
      const row = await projectFor(env, project);
      return result({ list: await loadIssueNotes(env.DB, row.id, issueId) });
    },
  );

  server.registerTool(
    "openwish_add_issue_note",
    {
      title: "Add private issue note",
      description: "Add a maintainer-only implementation note. This never emails the reporter.",
      inputSchema: z.object({ project: slug, issueId: uuid, body: z.string().min(1).max(4_000) }),
    },
    async ({ project, issueId, body }) => {
      const row = await projectFor(env, project);
      const note = await createIssueNote(env.DB, row.id, issueId, body);
      return note ? result(note) : failure("Issue not found.");
    },
  );

  server.registerTool(
    "openwish_delete_issue",
    {
      title: "Delete issue",
      description: "Permanently delete an issue, comments, and stored screenshots.",
      inputSchema: z.object({ project: slug, issueId: uuid }),
      annotations: { destructiveHint: true },
    },
    async ({ project, issueId }) => {
      const row = await projectFor(env, project);
      const deleted = await deleteBug(env.DB, env.BUGS_BUCKET, row, issueId);
      return deleted.deleted ? result({ deleted: true, issueId, screenshotsDeleted: deleted.screenshotKeys.length }) : failure("Issue not found.");
    },
  );

  server.registerTool(
    "openwish_get_issue_screenshot",
    {
      title: "Read issue screenshot",
      description: "Return one screenshot attached to an issue as MCP image content.",
      inputSchema: z.object({ project: slug, issueId: uuid, key: z.string().min(1).max(256) }),
      annotations: { readOnlyHint: true },
    },
    async ({ project, issueId, key }) => {
      const row = await projectFor(env, project);
      const issue = (await loadAdminBugs(env.DB, row)).find((item) => item.id === issueId);
      if (!issue || !issue.screenshotKeys.includes(key)) return failure("Screenshot not found on this issue.");
      const object = await env.BUGS_BUCKET.get(key);
      if (!object) return failure("Screenshot object not found.");
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { content: [{ type: "image" as const, data: btoa(binary), mimeType: object.httpMetadata?.contentType ?? "image/jpeg" }] };
    },
  );

  server.registerTool(
    "openwish_send_test_email",
    {
      title: "Send project test email",
      description: "Send a test notification email. This causes an external side effect.",
      inputSchema: z.object({ project: slug, to: z.string().email() }),
    },
    async ({ project, to }) => {
      await sendTestEmail(env, to, await projectFor(env, project));
      return result({ sent: true, to });
    },
  );
}

function createOpenWishMcpServer(env: Bindings) {
  const server = new McpServer(
    { name: "openwish", version: "2.0.0" },
    {
      instructions:
        "Manage OpenWish projects, feature requests, bugs, card-data issues, replies, notes, analytics, and settings. Confirm destructive actions with the user. Never reveal or repeat the bearer token.",
    },
  );
  registerTools(server, env);
  return server;
}

export async function handleOpenWishMcpRequest(
  request: Request,
  env: Bindings,
  executionContext?: ExecutionContext,
): Promise<Response> {
  const auth = requireMcpBearer({ env, request });
  if (!auth.ok) return auth.response;

  const handler = createMcpHandler(() => createOpenWishMcpServer(env), {
    route: "/mcp",
    allowedHostnames: ["wishkit.juli.sh", "localhost", "127.0.0.1"],
    allowedOriginHostnames: ["wishkit.juli.sh", "localhost", "127.0.0.1"],
    corsOptions: false,
    onerror: (error) => console.error("[openwish] MCP request failed.", error),
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
