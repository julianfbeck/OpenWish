import { describe, expect, it } from "vitest";

import { handleOpenWishMcpRequest } from "../src/server/mcp";
import type { Bindings } from "../src/server/types";
import { MockD1Database } from "./support/mock-d1";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";

// Synthetic fixtures only.
const TOKEN = "test-only-mcp-queries-token";
const projectId = "10000000-0000-4000-8000-0000000000bb";
const alice = "aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-0000-4bbb-8bbb-bbbbbbbbbbbb";
const ids = {
  camera: "c0ffee00-0000-4000-8000-000000000001",
  cameraAgain: "c0ffee01-0000-4000-8000-000000000002",
  price: "decade00-0000-4000-8000-000000000003",
  feature: "feed0000-0000-4000-8000-000000000004",
};

function bug(id: string, user: string, title: string, description: string, state: string, createdAt: string, context: object, platform: string | null) {
  return {
    id, project_id: projectId, user_uuid: user, title, description, state, screenshot_keys: "[]", reporter_email: null,
    issue_kind: "bug", context_json: JSON.stringify(context), card_json: null, platform, created_at: createdAt, updated_at: createdAt,
  };
}

function environment(): Bindings {
  const created = "2026-04-01T10:00:00.000Z";
  const db = new MockD1Database({
    projects: [{
      id: projectId, slug: "queries", name: "Queries", api_key: "ow_api_queries", admin_token: "ow_admin_queries",
      watermark_enabled: 0, notification_email: null, public_form_enabled: 0, app_store_url: null,
      app_id: null, app_name: null, app_icon_url: null, created_at: created, updated_at: created,
    }],
    users: [{ project_id: projectId, uuid: alice, email: "alice@example.com", created_at: created }],
    wishes: [{
      id: ids.feature, project_id: projectId, user_uuid: alice, title: "Dark mode", description: "Night theme",
      state: "planned", platform: "ios", created_at: created, updated_at: created,
    }],
    bugs: [
      bug(ids.camera, alice, "Camera stays black", "Black camera after the update", "open", "2026-04-01T10:00:00.000Z",
        { app: { version: "6.0" }, revenueCat: { appUserId: "$RCAnonymousID:alice" } }, "ios"),
      bug(ids.cameraAgain, bob, "Black camera screen", "Camera is black when scanning", "open", "2026-04-03T10:00:00.000Z",
        { app: { version: "6.0" } }, "android"),
      bug(ids.price, bob, "Wrong price", "Price shows zero", "fixed", "2026-04-02T10:00:00.000Z",
        { app: { version: "5.9" } }, "ios"),
    ],
  } as never);
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_GLOBAL_API_KEY: TOKEN,
  };
}

async function call(env: Bindings, name: string, args: Record<string, unknown>) {
  const response = await handleOpenWishMcpRequest(new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "localhost",
      "MCP-Protocol-Version": "2025-11-25",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), env);
  const body = await response.text();
  const json = response.headers.get("Content-Type")?.includes("text/event-stream")
    ? body.split("\n").find((line) => line.startsWith("data: "))!.slice(6)
    : body;
  const payload = JSON.parse(json) as {
    result?: { isError?: boolean; structuredContent?: any; content?: Array<{ text?: string }> };
  };
  return payload.result!;
}

describe("MCP triage tools", () => {
  it("filters, pages and compacts the issue list", async () => {
    const env = environment();
    const all = await call(env, "openwish_list_issues", { project: "queries" });
    expect(all.structuredContent.list).toHaveLength(3);
    expect(all.structuredContent.list[0].description).toBeTruthy();

    const open = await call(env, "openwish_list_issues", { project: "queries", state: ["open"], compact: true, limit: 1 });
    expect(open.structuredContent.total).toBe(2);
    expect(open.structuredContent.nextOffset).toBe(1);
    expect(open.structuredContent.list[0]).toMatchObject({ shortId: ids.cameraAgain.slice(0, 8), platform: "android", appVersion: "6.0" });
    expect(open.structuredContent.list[0].description).toBeUndefined();

    const second = await call(env, "openwish_list_issues", { project: "queries", state: ["open"], compact: true, limit: 1, offset: 1 });
    expect(second.structuredContent.list[0].id).toBe(ids.camera);
    expect(second.structuredContent.nextOffset).toBeNull();

    const search = await call(env, "openwish_list_issues", { project: "queries", query: "PRICE", appVersion: "5.9" });
    expect(search.structuredContent.list.map((issue: { id: string }) => issue.id)).toEqual([ids.price]);
  });

  it("gets issues and features by short id and rejects ambiguous prefixes", async () => {
    const env = environment();
    const issue = await call(env, "openwish_get_issue", { project: "queries", id: ids.price.slice(0, 8) });
    expect(issue.structuredContent.issue.id).toBe(ids.price);
    expect(issue.structuredContent.notes).toEqual([]);

    const ambiguous = await call(env, "openwish_get_issue", { project: "queries", id: "c0ffee" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content?.[0]?.text).toContain("matches 2 issues");

    const feature = await call(env, "openwish_get_feature", { project: "queries", id: "feed0000" });
    expect(feature.structuredContent.feature.title).toBe("Dark mode");
    expect((await call(env, "openwish_get_feature", { project: "queries", id: "abcdef" })).isError).toBe(true);
  });

  it("finds similar issues for an issue or a text", async () => {
    const env = environment();
    const byIssue = await call(env, "openwish_find_similar_issues", { project: "queries", issueId: ids.camera.slice(0, 8) });
    expect(byIssue.structuredContent.list[0].id).toBe(ids.cameraAgain);
    const byText = await call(env, "openwish_find_similar_issues", { project: "queries", text: "price is zero", limit: 1 });
    expect(byText.structuredContent.list.map((issue: { id: string }) => issue.id)).toEqual([ids.price]);
  });

  it("collects a reporter's history by user id or RevenueCat id", async () => {
    const env = environment();
    const byRevenueCat = await call(env, "openwish_get_reporter_history", { project: "queries", revenueCatId: "$RCAnonymousID:alice" });
    expect(byRevenueCat.structuredContent.issues.map((issue: { id: string }) => issue.id)).toEqual([ids.camera]);
    expect(byRevenueCat.structuredContent.features.map((feature: { id: string }) => feature.id)).toEqual([ids.feature]);
    expect(byRevenueCat.structuredContent.contacts).toEqual([{ userId: alice, email: "alice@example.com", unsubscribed: false }]);

    const byUser = await call(env, "openwish_get_reporter_history", { project: "queries", userId: bob });
    expect(byUser.structuredContent.issues).toHaveLength(2);
    expect((await call(env, "openwish_get_reporter_history", { project: "queries" })).isError).toBe(true);
  });

  it("groups open issues by app version and platform", async () => {
    const stats = await call(environment(), "openwish_issue_stats", { project: "queries", state: ["open"] });
    expect(stats.structuredContent).toMatchObject({
      total: 2,
      byAppVersion: { "6.0": 2 },
      byPlatform: { ios: 1, android: 1 },
    });
  });

  it("refuses AI triage when the server has no AI binding", async () => {
    const triage = await call(environment(), "openwish_triage_issue", { project: "queries", id: ids.camera });
    expect(triage.isError).toBe(true);
    expect(triage.content?.[0]?.text).toContain("not enabled");
  });
});
