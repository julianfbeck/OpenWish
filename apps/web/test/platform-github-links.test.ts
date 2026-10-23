import { describe, expect, it } from "vitest";

import { bootstrapProject, createV2Issue, createWish } from "../src/server/db";
import { parseGitHubLink } from "../src/server/github-links";
import { handleOpenWishMcpRequest } from "../src/server/mcp";
import { dashboardMcpSubject, type McpAccess } from "../src/server/mcp-access";
import { platformFromContext, platformFromRequest } from "../src/server/platform";
import type { Bindings } from "../src/server/types";
import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";

// Synthetic fixtures only.
type RpcPayload = {
  error?: { code: number; message: string };
  result?: {
    isError?: boolean;
    structuredContent?: Record<string, any>;
    content?: Array<{ type: string; text?: string }>;
  };
};

function environment(db = new MockD1Database()): Bindings {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "test-only-password",
    OPENWISH_DASHBOARD_SESSION_SECRET: "test-only-session-secret",
  };
}

async function fixture() {
  const db = new MockD1Database();
  const env = environment(db);
  await bootstrapProject(env.DB, { name: "Selected project", slug: "selected", watermarkEnabled: false });
  await bootstrapProject(env.DB, { name: "Other project", slug: "other", watermarkEnabled: false });
  const own = db.state.projects.find((project) => project.slug === "selected")!;
  const other = db.state.projects.find((project) => project.slug === "other")!;
  const feature = await createWish(env.DB, own, crypto.randomUUID(), {
    title: "Dark mode", description: "Please add a dark theme.", state: "pending",
  }, "ios");
  const secondFeature = await createWish(env.DB, own, crypto.randomUUID(), {
    title: "Night theme", description: "Duplicate of dark mode.", state: "pending",
  });
  const otherFeature = await createWish(env.DB, other, crypto.randomUUID(), {
    title: "Other feature", description: "Belongs to another project.", state: "pending",
  });
  const issue = await createV2Issue(env.DB, own, crypto.randomUUID(), {
    kind: "bug", title: "Crash on scan", description: "Crashes when scanning.", email: undefined,
    context: { sdk: { name: "openwish-android", version: "2.0.0" } }, screenshotKeys: [],
  });
  const access: McpAccess = {
    mode: "oauth", subject: await dashboardMcpSubject("admin"), projectIds: [own.id], scopes: ["mcp:read", "mcp:write"],
  };
  return { db, env, own, other, feature, secondFeature, otherFeature, issue, access };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function call(f: Fixture, name: string, args: object, access: McpAccess = f.access) {
  const response = await handleOpenWishMcpRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Host: "localhost" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
    f.env,
    undefined,
    access,
  );
  expect(response.status).toBe(200);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = (await response.text()).split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    return JSON.parse(data ?? "{}") as RpcPayload;
  }
  return await response.json() as RpcPayload;
}

function expectSuccess(payload: RpcPayload) {
  expect(payload.error).toBeUndefined();
  expect(payload.result?.isError).not.toBe(true);
  return payload.result?.structuredContent ?? {};
}

function errorText(payload: RpcPayload) {
  expect(payload.result?.isError).toBe(true);
  return payload.result?.content?.map((entry) => entry.text).join(" ") ?? "";
}

describe("platform detection", () => {
  it("reads the SDK kind header and ignores other clients", () => {
    const withKind = (kind?: string) =>
      new Request("http://localhost/api/wish/create", { headers: kind ? { "x-wishkit-sdk-kind": kind } : {} });
    expect(platformFromRequest(withKind("ios"))).toBe("ios");
    expect(platformFromRequest(withKind(" Android "))).toBe("android");
    expect(platformFromRequest(withKind("web"))).toBeNull();
    expect(platformFromRequest(withKind())).toBeNull();
  });

  it("falls back to the SDK context of an issue", () => {
    expect(platformFromContext({ sdk: { name: "openwish-android" } })).toBe("android");
    expect(platformFromContext({ device: { androidVersion: "15", apiLevel: 35 } })).toBe("android");
    expect(platformFromContext({ sdk: { name: "OpenWish" } })).toBe("ios");
    expect(platformFromContext({ app: { bundleId: "com.example.app" } })).toBe("ios");
    expect(platformFromContext({ device: "string-not-object" })).toBeNull();
    expect(platformFromContext({})).toBeNull();
  });
});

describe("GitHub link parsing", () => {
  it.each([
    ["https://github.com/acme/app/issues/12", "https://github.com/acme/app/issues/12", "issue", "acme/app", 12],
    ["https://github.com/acme/app/pull/34/files?diff=split#r1", "https://github.com/acme/app/pull/34", "pull", "acme/app", 34],
    ["http://www.github.com/acme/my.repo_x/issues/7/", "https://github.com/acme/my.repo_x/issues/7", "issue", "acme/my.repo_x", 7],
  ])("accepts %s", (input, url, type, repository, number) => {
    expect(parseGitHubLink(input)).toEqual({ url, type, repository, number });
  });

  it.each([
    "not a url",
    "https://gitlab.com/acme/app/issues/1",
    "https://github.com.evil.test/acme/app/issues/1",
    "https://user:pass@github.com/acme/app/issues/1",
    "https://github.com/acme/app",
    "https://github.com/acme/app/pulls/3",
    "https://github.com/acme/app/issues/0",
    "https://github.com/acme/app/issues/12abc",
    "https://github.com/-acme/app/issues/1",
    "javascript:alert(1)//github.com/acme/app/issues/1",
  ])("rejects %s", (input) => {
    expect(parseGitHubLink(input)).toBeNull();
  });
});

describe("GitHub links over MCP", () => {
  it("links issues and pull requests, deduplicates them and shows them on the project", async () => {
    const f = await fixture();

    const first = expectSuccess(await call(f, "openwish_link_github", {
      project: "selected", target: "feature", targetId: f.feature.id,
      url: "https://github.com/acme/app/issues/12#issuecomment-1",
    }));
    expect(first.githubLinks).toEqual([
      expect.objectContaining({ url: "https://github.com/acme/app/issues/12", type: "issue", repository: "acme/app", number: 12, title: null }),
    ]);

    // The same issue again only updates its title.
    const again = expectSuccess(await call(f, "openwish_link_github", {
      project: "selected", target: "feature", targetId: f.feature.id,
      url: "https://github.com/acme/app/issues/12", title: "Dark mode tracking issue",
    }));
    expect(again.githubLinks).toHaveLength(1);
    expect(again.githubLinks[0].title).toBe("Dark mode tracking issue");

    expectSuccess(await call(f, "openwish_link_github", {
      project: "selected", target: "issue", targetId: f.issue.id, url: "https://github.com/acme/app/pull/34",
    }));

    const project = expectSuccess(await call(f, "openwish_get_project", { project: "selected" }));
    const listed = project.list.find((wish: { id: string }) => wish.id === f.feature.id);
    expect(listed.platform).toBe("ios");
    expect(listed.githubLinks.map((link: { url: string }) => link.url)).toEqual(["https://github.com/acme/app/issues/12"]);

    const issues = expectSuccess(await call(f, "openwish_list_issues", { project: "selected" }));
    expect(issues.list[0]).toMatchObject({
      platform: "android",
      githubLinks: [expect.objectContaining({ type: "pull", number: 34 })],
    });
  });

  it("requires write permission and a feature or issue of the granted project", async () => {
    const f = await fixture();
    const readOnly = { ...f.access, scopes: ["mcp:read"] };
    const link = { project: "selected", target: "feature", targetId: f.feature.id, url: "https://github.com/acme/app/issues/1" };

    expect(errorText(await call(f, "openwish_link_github", link, readOnly))).toContain("Approve the requested permission");
    expect(errorText(await call(f, "openwish_link_github", { ...link, targetId: f.otherFeature.id }))).toContain("Feature request not found");
    expect(errorText(await call(f, "openwish_link_github", { ...link, target: "issue" }))).toContain("Issue not found");
    expect(errorText(await call(f, "openwish_link_github", { ...link, url: "https://example.com/acme/app/issues/1" }))).toContain("GitHub issue or pull request URL");
    expect(errorText(await call(f, "openwish_link_github", { ...link, project: "other", targetId: f.otherFeature.id }))).toContain("not part of this authorization");
    expect(f.db.state.githubLinks).toHaveLength(0);
  });

  it("unlinks a link and reports links that are not attached", async () => {
    const f = await fixture();
    const link = { project: "selected", target: "feature", targetId: f.feature.id, url: "https://github.com/acme/app/pull/9" };
    expectSuccess(await call(f, "openwish_link_github", link));

    const removed = expectSuccess(await call(f, "openwish_unlink_github", { ...link, url: "https://github.com/acme/app/pull/9/commits" }));
    expect(removed.githubLinks).toEqual([]);
    expect(errorText(await call(f, "openwish_unlink_github", link))).toContain("not attached");
  });

  it("moves links when features merge and drops them when a feature is deleted", async () => {
    const f = await fixture();
    const admin = { ...f.access, scopes: ["mcp:read", "mcp:write", "mcp:admin"] };
    const linkTo = (targetId: string, url: string) =>
      call(f, "openwish_link_github", { project: "selected", target: "feature", targetId, url });
    expectSuccess(await linkTo(f.secondFeature.id, "https://github.com/acme/app/issues/1"));
    expectSuccess(await linkTo(f.secondFeature.id, "https://github.com/acme/app/issues/2"));
    expectSuccess(await linkTo(f.feature.id, "https://github.com/acme/app/issues/2"));

    expectSuccess(await call(f, "openwish_merge_features", {
      project: "selected", sourceFeatureId: f.secondFeature.id, targetFeatureId: f.feature.id,
    }, admin));
    expect(f.db.state.githubLinks.map((link) => [link.target_id, link.url]).sort()).toEqual([
      [f.feature.id, "https://github.com/acme/app/issues/1"],
      [f.feature.id, "https://github.com/acme/app/issues/2"],
    ]);

    expectSuccess(await call(f, "openwish_delete_feature", { project: "selected", featureId: f.feature.id }, admin));
    expect(f.db.state.githubLinks).toHaveLength(0);
  });
});

describe("platform recording", () => {
  it("stores the platform of SDK submissions for the dashboard only", async () => {
    const db = new MockD1Database();
    const env = environment(db);
    const project = await bootstrapProject(env.DB, { name: "Scanner", slug: "scanner", watermarkEnabled: false });
    const iosUser = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const androidUser = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const sdkHeaders = (uuid: string, kind?: string) => ({
      "Content-Type": "application/json",
      "x-wishkit-api-key": project.apiKey,
      "x-wishkit-uuid": uuid,
      ...(kind ? { "x-wishkit-sdk-kind": kind } : {}),
    });

    const wish = await requestApp("/api/wish/create", {
      method: "POST", headers: sdkHeaders(iosUser, "ios"),
      body: JSON.stringify({ title: "Widgets", description: "Home screen widgets.", state: "pending" }),
    }, env);
    expect(wish.status).toBe(200);
    // Android context without the header still identifies the platform.
    const issue = await requestApp("/api/v2/issues", {
      method: "POST", headers: sdkHeaders(androidUser),
      body: JSON.stringify({
        title: "Camera freezes", description: "Freezes after a scan.", kind: "bug",
        context: { device: { androidVersion: "15" } },
      }),
    }, env);
    expect(issue.status).toBe(201);
    const legacyBug = await requestApp("/api/bug/create", {
      method: "POST", headers: sdkHeaders(androidUser, "android"),
      body: JSON.stringify({ title: "Login loop", description: "Keeps asking to log in." }),
    }, env);
    expect(legacyBug.status).toBe(200);

    expect(db.state.wishes.map((row) => row.platform)).toEqual(["ios"]);
    expect(db.state.bugs.map((row) => row.platform)).toEqual(["android", "android"]);

    // SDK payloads keep their original shape.
    const sdkFeatures = await requestApp("/api/wish/list", { headers: sdkHeaders(iosUser, "ios") }, env);
    const sdkIssues = await requestApp("/api/v2/issues", { headers: sdkHeaders(androidUser, "android") }, env);
    for (const body of [JSON.stringify(await sdkFeatures.json()), JSON.stringify(await sdkIssues.json())]) {
      expect(body).not.toContain("platform");
      expect(body).not.toContain("githubLinks");
    }

    const login = await requestApp("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "test-only-password" }),
    }, env);
    const cookie = readSetCookie(login) ?? "";
    const board = await (await requestApp("/api/admin/projects/scanner", { headers: { Cookie: cookie } }, env)).json() as {
      list: Array<{ platform: string | null; githubLinks: unknown[] }>;
    };
    expect(board.list).toEqual([expect.objectContaining({ platform: "ios", githubLinks: [] })]);
    const bugs = await (await requestApp("/api/admin/projects/scanner/bugs", { headers: { Cookie: cookie } }, env)).json() as {
      list: Array<{ platform: string | null }>;
    };
    expect(bugs.list.map((bug) => bug.platform)).toEqual(["android", "android"]);
  });
});
