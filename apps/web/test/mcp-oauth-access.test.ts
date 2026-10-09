import { describe, expect, it, vi } from "vitest";

import { bootstrapProject, createV2Issue, createWish, deleteProject } from "../src/server/db";
import { handleOpenWishMcpRequest } from "../src/server/mcp";
import { dashboardMcpSubject, type McpAccess } from "../src/server/mcp-access";
import type { Bindings, ProjectRow } from "../src/server/types";
import { MockD1Database } from "./support/mock-d1";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";

type RpcPayload = {
  error?: { code: number; message: string };
  result?: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string; data?: string }>;
    tools?: Array<{ name: string }>;
    _meta?: Record<string, unknown>;
  };
};

function mcpRequest(body: object) {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "localhost",
    },
    body: JSON.stringify(body),
  });
}

async function readMcpResponse(response: Response): Promise<RpcPayload> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const text = await response.text();
    const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (!data) throw new Error("MCP SSE response did not contain data.");
    return JSON.parse(data) as RpcPayload;
  }
  return await response.json() as RpcPayload;
}

async function fixture() {
  const db = new MockD1Database();
  const bucket = new MockR2Bucket();
  const email = new MockSendEmail();
  const env: Bindings = {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: bucket as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: email as unknown as SendEmail,
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_NOTIFICATION_FROM: "noreply@example.test",
  };
  await bootstrapProject(env.DB, { name: "Selected project", slug: "selected", watermarkEnabled: false });
  await bootstrapProject(env.DB, { name: "Other project", slug: "other", watermarkEnabled: false });
  const own = db.state.projects.find((project) => project.slug === "selected")!;
  const other = db.state.projects.find((project) => project.slug === "other")!;
  const ownFeature = await createWish(env.DB, own, crypto.randomUUID(), {
    title: "Selected feature", description: "Original selected description", state: "pending",
  });
  const otherFeature = await createWish(env.DB, other, crypto.randomUUID(), {
    title: "Other feature", description: "Original other description", state: "pending",
  });
  const ownIssue = await seedIssue(env, own);
  const otherIssue = await seedIssue(env, other);
  const access: McpAccess = {
    mode: "oauth", subject: await dashboardMcpSubject("admin"), projectIds: [own.id], scopes: ["mcp:read"],
  };
  return { db, bucket, email, env, own, other, ownFeature, otherFeature, ownIssue, otherIssue, access };
}

async function seedIssue(env: Bindings, project: ProjectRow, screenshotKeys: string[] = []) {
  return createV2Issue(env.DB, project, crypto.randomUUID(), {
    kind: "bug", title: "Seeded issue", description: "Original description", email: undefined, context: {}, screenshotKeys,
  });
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function withScopes(f: Fixture, ...scopes: string[]): McpAccess {
  return { ...f.access, scopes: ["mcp:read", ...scopes] };
}

async function rpc(f: Fixture, access: McpAccess, method: string, params: object = {}) {
  const response = await handleOpenWishMcpRequest(
    mcpRequest({ jsonrpc: "2.0", id: 1, method, params }), f.env, undefined, access,
  );
  expect(response.status).toBe(200);
  return readMcpResponse(response);
}

function call(f: Fixture, access: McpAccess, name: string, args: object = {}) {
  return rpc(f, access, "tools/call", { name, arguments: args });
}

function expectDenied(payload: RpcPayload) {
  expect(Boolean(payload.error) || payload.result?.isError === true).toBe(true);
}

function expectSuccess(payload: RpcPayload) {
  expect(payload.error).toBeUndefined();
  expect(payload.result).toBeDefined();
  expect(payload.result?.isError).not.toBe(true);
}

describe("project-scoped OAuth over MCP HTTP", () => {
  it("reads only granted projects and never returns SDK/admin keys", async () => {
    const f = await fixture();
    const listed = await call(f, f.access, "openwish_list_projects");
    expectSuccess(listed);
    expect(listed.result?.structuredContent?.projects).toEqual([
      expect.objectContaining({ slug: "selected", name: "Selected project" }),
    ]);
    const project = await call(f, f.access, "openwish_get_project", { project: f.own.slug });
    expectSuccess(project);
    const serialized = JSON.stringify([listed, project]);
    for (const row of f.db.state.projects) {
      expect(serialized).not.toContain(row.api_key);
      expect(serialized).not.toContain(row.admin_token);
    }
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("adminToken");
  });

  it("excludes project creation even with all OAuth scopes", async () => {
    const f = await fixture();
    const access = withScopes(f, "mcp:write", "mcp:admin");
    const listed = await rpc(f, access, "tools/list");
    expect(listed.result?.tools?.map((tool) => tool.name)).not.toContain("openwish_create_project");
    const before = structuredClone(f.db.state);
    expectDenied(await call(f, access, "openwish_create_project", { name: "Forbidden", slug: "forbidden" }));
    expect(f.db.state).toEqual(before);
  });

  it("rejects read-only mutations before database, screenshot or email effects", async () => {
    const f = await fixture();
    const key = `bugs/${f.own.id}/owned.png`;
    await f.bucket.put(key, new Uint8Array([1, 2, 3]));
    const before = structuredClone(f.db.state);
    const deleted = vi.spyOn(f.bucket, "delete");
    const sent = vi.spyOn(f.email, "send");
    const operations: Array<[string, object]> = [
      ["openwish_create_feature", { project: f.own.slug, title: "Forbidden", description: "Forbidden" }],
      ["openwish_update_feature", { project: f.own.slug, featureId: f.ownFeature.id, state: "implemented" }],
      ["openwish_reply_to_issue", { project: f.own.slug, issueId: f.ownIssue.id, message: "Forbidden reply" }],
      ["openwish_add_issue_note", { project: f.own.slug, issueId: f.ownIssue.id, body: "Forbidden note" }],
      ["openwish_delete_issue", { project: f.own.slug, issueId: f.ownIssue.id }],
      ["openwish_delete_project", { project: f.own.slug, confirmProjectSlug: f.own.slug }],
      ["openwish_send_test_email", { project: f.own.slug, to: "recipient@example.test" }],
    ];
    for (const [name, args] of operations) expectDenied(await call(f, f.access, name, args));
    expect(f.db.state).toEqual(before);
    expect(deleted).not.toHaveBeenCalled();
    expect(sent).not.toHaveBeenCalled();
    expect(f.bucket.has(key)).toBe(true);
  });

  it("allows editing with write scope but keeps destructive actions separate", async () => {
    const f = await fixture();
    const access = withScopes(f, "mcp:write");
    expectSuccess(await call(f, access, "openwish_update_feature", {
      project: f.own.slug, featureId: f.ownFeature.id, title: "Edited title",
    }));
    expect(f.db.state.wishes.find((feature) => feature.id === f.ownFeature.id)?.title).toBe("Edited title");
    expectSuccess(await call(f, access, "openwish_add_issue_note", {
      project: f.own.slug, issueId: f.ownIssue.id, body: "Implementation note",
    }));
    expect(f.db.state.issueNotes).toHaveLength(1);
    const before = structuredClone(f.db.state);
    expectDenied(await call(f, access, "openwish_delete_feature", { project: f.own.slug, featureId: f.ownFeature.id }));
    expect(f.db.state).toEqual(before);
  });

  it("requires write separately from admin and permits an authorized deletion", async () => {
    const f = await fixture();
    const access = withScopes(f, "mcp:admin");
    const before = structuredClone(f.db.state);
    expectDenied(await call(f, access, "openwish_update_issue", {
      project: f.own.slug, issueId: f.ownIssue.id, title: "Forbidden edit",
    }));
    expect(f.db.state).toEqual(before);
    expectSuccess(await call(f, access, "openwish_delete_feature", { project: f.own.slug, featureId: f.ownFeature.id }));
    expect(f.db.state.wishes.some((feature) => feature.id === f.ownFeature.id)).toBe(false);
    expect(f.db.state.wishes.some((feature) => feature.id === f.otherFeature.id)).toBe(true);
  });

  it("rejects another project at the authorization boundary without side effects", async () => {
    const f = await fixture();
    const access = withScopes(f, "mcp:write", "mcp:admin");
    const before = structuredClone(f.db.state);
    const operations: Array<[string, object]> = [
      ["openwish_get_project", { project: f.other.slug }],
      ["openwish_create_issue", { project: f.other.slug, title: "Forbidden", description: "Forbidden" }],
      ["openwish_delete_project", { project: f.other.slug, confirmProjectSlug: f.other.slug }],
    ];
    for (const [name, args] of operations) expectDenied(await call(f, access, name, args));
    expect(f.db.state).toEqual(before);
  });

  it("cannot use a granted project slug with foreign feature or issue IDs", async () => {
    const f = await fixture();
    const access = withScopes(f, "mcp:write", "mcp:admin");
    const before = structuredClone(f.db.state);
    const operations: Array<[string, object]> = [
      ["openwish_update_feature", { project: f.own.slug, featureId: f.otherFeature.id, title: "Forbidden" }],
      ["openwish_delete_feature", { project: f.own.slug, featureId: f.otherFeature.id }],
      ["openwish_reply_to_feature", { project: f.own.slug, featureId: f.otherFeature.id, message: "Forbidden" }],
      ["openwish_merge_features", { project: f.own.slug, sourceFeatureId: f.otherFeature.id, targetFeatureId: f.ownFeature.id }],
      ["openwish_update_issue", { project: f.own.slug, issueId: f.otherIssue.id, title: "Forbidden" }],
      ["openwish_delete_issue", { project: f.own.slug, issueId: f.otherIssue.id }],
      ["openwish_reply_to_issue", { project: f.own.slug, issueId: f.otherIssue.id, message: "Forbidden" }],
      ["openwish_add_issue_note", { project: f.own.slug, issueId: f.otherIssue.id, body: "Forbidden" }],
    ];
    for (const [name, args] of operations) expectDenied(await call(f, access, name, args));
    expect(f.db.state).toEqual(before);
    expect(f.email.sent).toHaveLength(0);
  });

  it("does not transfer an immutable-ID grant to a recreated project slug", async () => {
    const f = await fixture();
    await deleteProject(f.env.DB, f.own.slug);
    await bootstrapProject(f.env.DB, { name: "Replacement", slug: f.own.slug, watermarkEnabled: false });
    const replacement = f.db.state.projects.find((project) => project.slug === f.own.slug)!;
    expect(replacement.id).not.toBe(f.own.id);
    const listed = await call(f, f.access, "openwish_list_projects");
    expectSuccess(listed);
    expect(listed.result?.structuredContent?.projects).toEqual([]);
    const before = structuredClone(f.db.state);
    expectDenied(await call(f, f.access, "openwish_get_project", { project: f.own.slug }));
    expectDenied(await call(f, withScopes(f, "mcp:admin"), "openwish_delete_project", {
      project: f.own.slug, confirmProjectSlug: f.own.slug,
    }));
    expect(f.db.state).toEqual(before);
  });

  it("rechecks the immutable ID if a project is replaced between authorization and its callback", async () => {
    const f = await fixture();
    const replacement = { ...f.own, id: crypto.randomUUID(), name: "Concurrent replacement" };
    const expected = structuredClone(f.db.state);
    expected.projects = expected.projects.map((project) => project.id === f.own.id ? replacement : project);
    const prepare = f.db.prepare.bind(f.db);
    let lookups = 0;
    vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
      if (sql.includes("SELECT * FROM projects WHERE slug = ?") && ++lookups === 2) {
        f.db.state.projects = f.db.state.projects.map((project) => project.id === f.own.id ? replacement : project);
      }
      return prepare(sql);
    });
    expectDenied(await call(f, withScopes(f, "mcp:admin"), "openwish_delete_project", {
      project: f.own.slug, confirmProjectSlug: f.own.slug,
    }));
    expect(lookups).toBe(2);
    expect(f.db.state).toEqual(expected);
  });

  it("does not delete a replacement created after the callback resolved its authorized project", async () => {
    const f = await fixture();
    const replacement = { ...f.own, id: crypto.randomUUID(), name: "Replacement before delete" };
    const expected = structuredClone(f.db.state);
    expected.projects = expected.projects.map((project) => project.id === f.own.id ? replacement : project);
    const prepare = f.db.prepare.bind(f.db);
    let deletionAttempted = false;
    vi.spyOn(f.db, "prepare").mockImplementation((sql) => {
      if (sql.startsWith("DELETE FROM projects WHERE slug = ?")) {
        deletionAttempted = true;
        f.db.state.projects = f.db.state.projects.map((project) => project.id === f.own.id ? replacement : project);
      }
      return prepare(sql);
    });
    await call(f, withScopes(f, "mcp:admin"), "openwish_delete_project", {
      project: f.own.slug, confirmProjectSlug: f.own.slug,
    });
    expect(deletionAttempted).toBe(true);
    expect(f.db.state).toEqual(expected);
  });

  it("rejects grants for a changed dashboard subject and missing read/project grants", async () => {
    const f = await fixture();
    const before = structuredClone(f.db.state);
    const changed = await handleOpenWishMcpRequest(
      mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      { ...f.env, OPENWISH_DASHBOARD_USERNAME: "replacement-admin" }, undefined, f.access,
    );
    expect(changed.status).toBe(401);
    for (const access of [{ ...f.access, scopes: ["mcp:write"] }, { ...f.access, projectIds: [] }]) {
      const response = await handleOpenWishMcpRequest(
        mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }), f.env, undefined, access,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("www-authenticate")).toContain("mcp:read");
    }
    expect(f.db.state).toEqual(before);
  });

  it("rejects foreign and missing screenshots before creating an issue", async () => {
    const f = await fixture();
    const access = withScopes(f, "mcp:write");
    const foreignKey = `bugs/${f.other.id}/foreign.png`;
    const missingKey = `bugs/${f.own.id}/missing.png`;
    const ownKey = `bugs/${f.own.id}/owned.png`;
    await f.bucket.put(foreignKey, new Uint8Array([4, 5]));
    await f.bucket.put(ownKey, new Uint8Array([1, 2]));
    const before = structuredClone(f.db.state);
    for (const key of [foreignKey, missingKey]) {
      expectDenied(await call(f, access, "openwish_create_issue", {
        project: f.own.slug, title: "Attachment", description: "Attachment", screenshotKeys: [key],
      }));
    }
    expect(f.db.state).toEqual(before);
    expectSuccess(await call(f, access, "openwish_create_issue", {
      project: f.own.slug, title: "Valid attachment", description: "Valid attachment", screenshotKeys: [ownKey],
    }));
    expect(f.db.state.bugs).toHaveLength(before.bugs.length + 1);
    expect(f.bucket.has(foreignKey)).toBe(true);
  });

  it("cannot read or delete foreign R2 data referenced by a legacy malformed issue", async () => {
    const f = await fixture();
    const foreignKey = `bugs/${f.other.id}/foreign.png`;
    const ownKey = `bugs/${f.own.id}/owned.png`;
    await f.bucket.put(foreignKey, new Uint8Array([9, 8, 7]), { httpMetadata: { contentType: "image/png" } });
    await f.bucket.put(ownKey, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
    // Seed pre-existing malformed storage directly, bypassing the corrected creation boundary.
    const malformed = await seedIssue(f.env, f.own, [ownKey, foreignKey]);
    const get = vi.spyOn(f.bucket, "get");
    expectDenied(await call(f, f.access, "openwish_get_issue_screenshot", {
      project: f.own.slug, issueId: malformed.id, key: foreignKey,
    }));
    expect(get).not.toHaveBeenCalled();
    const ownImage = await call(f, f.access, "openwish_get_issue_screenshot", {
      project: f.own.slug, issueId: malformed.id, key: ownKey,
    });
    expectSuccess(ownImage);
    expect(ownImage.result?.content).toEqual([expect.objectContaining({ type: "image", data: "AQID" })]);
    const deleted = vi.spyOn(f.bucket, "delete");
    expectSuccess(await call(f, withScopes(f, "mcp:admin"), "openwish_delete_issue", {
      project: f.own.slug, issueId: malformed.id,
    }));
    expect(f.db.state.bugs.some((issue) => issue.id === malformed.id)).toBe(false);
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(deleted).toHaveBeenCalledWith(ownKey);
    expect(f.bucket.has(ownKey)).toBe(false);
    expect(f.bucket.has(foreignKey)).toBe(true);
  });
});
