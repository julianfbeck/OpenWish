import { describe, expect, it } from "vitest";

import { loadAdminBugs, loadAdminProject } from "../src/server/db";
import type { ProjectRow } from "../src/server/types";
import { requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockKV } from "./support/mock-kv";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";

// Shipped iOS (WishKit + OpenWish) and Android apps decode these payloads and
// cannot be updated in place. Dashboard/MCP-only fields (platform,
// githubLinks, …) must never leak into them, and no field may disappear.
// Synthetic fixtures only.
const apiKey = "ow_api_contract";
const projectId = "10000000-0000-4000-8000-000000000001";
const iosUser = "AAAAAAAA-1111-4AAA-8AAA-AAAAAAAAAAAA";
const androidUser = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const wishId = "20000000-0000-4000-8000-000000000001";
const bugId = "30000000-0000-4000-8000-000000000001";

const wishKeys = ["commentList", "description", "id", "state", "title", "userUUID", "votingUsers"];
const commentKeys = ["createdAt", "description", "id", "isAdmin", "userId"];
const bugKeys = [
  "card", "commentList", "context", "createdAt", "description", "id", "kind", "reporterEmail",
  "screenshotKeys", "state", "title", "updatedAt", "userUUID",
];

function environment() {
  const created = "2026-04-01T10:00:00.000Z";
  const db = new MockD1Database({
    projects: [{
      id: projectId, slug: "contract", name: "Contract", api_key: apiKey, admin_token: "ow_admin_contract",
      watermark_enabled: 0, notification_email: null, public_form_enabled: 0, app_store_url: null,
      app_id: null, app_name: null, app_icon_url: null, created_at: created, updated_at: created,
    }],
    wishes: [{
      id: wishId, project_id: projectId, user_uuid: iosUser, title: "Dark mode", description: "Night theme",
      state: "planned", platform: "ios", created_at: created, updated_at: created,
    }],
    votes: [{ project_id: projectId, wish_id: wishId, user_uuid: androidUser, created_at: created }],
    comments: [{
      id: "40000000-0000-4000-8000-000000000001", project_id: projectId, wish_id: wishId,
      user_uuid: androidUser, description: "Yes", is_admin: 0, created_at: created,
    }],
    bugs: [{
      id: bugId, project_id: projectId, user_uuid: androidUser, title: "Crash", description: "On launch",
      state: "open", screenshot_keys: "[]", reporter_email: null, issue_kind: "bug",
      context_json: '{"device":{"androidVersion":"15"}}', card_json: null, platform: "android",
      created_at: created, updated_at: created,
    }],
    bugComments: [{
      id: "50000000-0000-4000-8000-000000000001", project_id: projectId, bug_id: bugId,
      user_uuid: iosUser, description: "Fixed soon", is_admin: 1, created_at: created,
    }],
    githubLinks: [{
      id: "60000000-0000-4000-8000-000000000001", project_id: projectId, target_type: "wish", target_id: wishId,
      url: "https://github.com/acme/app/issues/1", link_type: "issue", repository: "acme/app", number: 1,
      title: null, created_at: created,
    }],
  });
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
  };
}

function headers(uuid: string, kind?: string) {
  return {
    "Content-Type": "application/json",
    "x-wishkit-api-key": apiKey,
    "x-wishkit-uuid": uuid,
    ...(kind ? { "x-wishkit-sdk-kind": kind } : {}),
  };
}

const sortedKeys = (value: object) => Object.keys(value).sort();

describe("SDK response contract for shipped apps", () => {
  it.each([
    ["original WishKit (no SDK kind)", iosUser, undefined],
    ["OpenWish iOS", iosUser, "ios"],
    ["OpenWish Android", androidUser, "android"],
  ])("keeps the feature and issue list shapes for %s", async (_label, uuid, kind) => {
    const env = environment();
    for (const path of ["/api/wish/list", "/api/v2/features"]) {
      const response = await requestApp(path, { headers: headers(uuid, kind) }, env);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { list: Array<Record<string, any>> };
      expect(sortedKeys(payload)).toEqual(["list", "shouldShowWatermark"]);
      expect(sortedKeys(payload.list[0]!)).toEqual(wishKeys);
      expect(sortedKeys(payload.list[0]!.commentList[0])).toEqual(commentKeys);
      expect(payload.list[0]!.votingUsers).toEqual([{ uuid: androidUser }]);
    }

    const issueOwner = environment();
    for (const path of ["/api/bug/list", "/api/v2/issues"]) {
      const response = await requestApp(path, { headers: headers(androidUser, kind) }, issueOwner);
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { list: Array<Record<string, any>> };
      expect(sortedKeys(payload)).toEqual(["list"]);
      expect(sortedKeys(payload.list[0]!)).toEqual(bugKeys);
      expect(sortedKeys(payload.list[0]!.commentList[0])).toEqual(commentKeys);
    }
  });

  it("keeps the create, vote and comment response shapes", async () => {
    const env = environment();
    const post = (path: string, body: unknown, kind?: string) =>
      requestApp(path, { method: "POST", headers: headers(iosUser, kind), body: JSON.stringify(body) }, env);

    const wish = await post("/api/wish/create", { title: "Widgets", description: "Home widgets", state: "pending" }, "ios");
    expect(sortedKeys(await wish.json())).toEqual(["description", "id", "state", "title"]);

    const bug = await post("/api/bug/create", { title: "Freeze", description: "Freezes" }, "ios");
    expect(sortedKeys(await bug.json())).toEqual(["createdAt", "id", "state"]);

    const issue = await post("/api/v2/issues", { title: "Art", description: "Wrong art", kind: "cardData", context: {} });
    expect(issue.status).toBe(201);
    expect(sortedKeys(await issue.json())).toEqual(["createdAt", "id", "state"]);

    const vote = await post("/api/wish/vote", { wishId });
    expect(sortedKeys(await vote.json())).toEqual(["votingUsers", "wishId"]);

    const comment = await post("/api/comment/create", { wishId, description: "Me too" });
    expect(sortedKeys(await comment.json())).toEqual(commentKeys);
  });

  it("keeps SDK submissions and dashboard lists working before migration 0010", async () => {
    const env = environment();
    // A database without the platform column rejects every statement using it
    // (CREATE TABLE IF NOT EXISTS skips the existing tables).
    const db = env.DB as unknown as MockD1Database;
    const reject = (sql: string) => {
      if (/\bplatform\b/.test(sql) && !sql.trimStart().startsWith("CREATE TABLE IF NOT EXISTS")) {
        throw new Error("D1_ERROR: no such column: platform");
      }
    };
    const run = db.run.bind(db);
    const all = db.all.bind(db);
    db.run = async (sql, bindings) => (reject(sql), run(sql, bindings));
    db.all = async (sql, bindings) => (reject(sql), all(sql, bindings));
    const post = (path: string, body: unknown) =>
      requestApp(path, { method: "POST", headers: headers(androidUser, "android"), body: JSON.stringify(body) }, env);

    expect((await post("/api/wish/create", { title: "Export", description: "CSV export" })).status).toBe(200);
    expect((await post("/api/bug/create", { title: "Freeze", description: "Freezes" })).status).toBe(200);
    expect((await post("/api/v2/issues", { title: "Camera", description: "Black", kind: "bug", context: {} })).status).toBe(201);

    const project = db.state.projects[0] as ProjectRow;
    const board = await loadAdminProject(env.DB, project);
    expect(board.list).toHaveLength(2);
    expect(board.list.every((wish) => wish.platform === null)).toBe(true);
    expect((await loadAdminBugs(env.DB, project)).every((bug) => bug.platform === null)).toBe(true);
  });
});
