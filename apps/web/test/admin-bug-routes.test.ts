import { beforeEach, describe, expect, it } from "vitest";

import { adminBugListResponseSchema } from "@openwish/shared";

import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

const projectId = "project-bugs";
const projectSlug = "bugs-app";
const reporterUuid = "11111111-1111-4111-8111-111111111111";
const seededBugId = "22222222-2222-4222-8222-222222222222";
const screenshotKey = `bugs/${projectId}/seed.png`;

function createEnv(
  db: MockD1Database,
  bucket: MockR2Bucket,
  email: MockSendEmail = new MockSendEmail(),
) {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: bucket as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: email as unknown as SendEmail,
    OPENWISH_CORS_ORIGIN: "*",
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_NOTIFICATION_FROM: "noreply@example.com",
    OPENWISH_DASHBOARD_URL: "https://dash.example.com",
  };
}

async function login(env: ReturnType<typeof createEnv>) {
  const response = await requestApp(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret-pass" }),
    },
    env,
  );
  return readSetCookie(response) ?? "";
}

describe("admin bug routes", () => {
  let db: MockD1Database;
  let bucket: MockR2Bucket;
  let env: ReturnType<typeof createEnv>;

  beforeEach(async () => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: projectSlug,
          name: "Bugs App",
          api_key: "ow_api_bugs",
          admin_token: "ow_admin_bugs",
          watermark_enabled: 0,
          notification_email: null,
          public_form_enabled: 0,
          app_store_url: null,
          app_id: null,
          app_name: null,
          app_icon_url: null,
          created_at: "2026-04-09T09:00:00.000Z",
          updated_at: "2026-04-09T09:00:00.000Z",
        },
      ],
    });
    bucket = new MockR2Bucket();
    env = createEnv(db, bucket);

    db.state.bugs.push({
      id: seededBugId,
      project_id: projectId,
      user_uuid: reporterUuid,
      title: "Seeded crash",
      description: "App fails when tapping Submit.",
      state: "open",
      screenshot_keys: JSON.stringify([screenshotKey]),
      reporter_email: null,
      created_at: "2026-04-09T09:30:00.000Z",
      updated_at: "2026-04-09T09:30:00.000Z",
    });

    await bucket.put(screenshotKey, new ArrayBuffer(8), {
      httpMetadata: { contentType: "image/png" },
    });
  });

  it("lists, patches, comments, and deletes bugs (and removes screenshots from R2)", async () => {
    const cookie = await login(env);

    const listResponse = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(listResponse.status).toBe(200);
    const list = adminBugListResponseSchema.parse(await listResponse.json());
    expect(list.list).toHaveLength(1);
    expect(list.list[0]?.state).toBe("open");

    const patchResponse = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${seededBugId}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "inProgress" }),
      },
      env,
    );
    expect(patchResponse.status).toBe(200);
    const afterPatch = adminBugListResponseSchema.parse(await patchResponse.json());
    expect(afterPatch.list[0]?.state).toBe("inProgress");

    const commentResponse = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${seededBugId}/comments`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Looking into it." }),
      },
      env,
    );
    expect(commentResponse.status).toBe(201);
    const afterComment = adminBugListResponseSchema.parse(await commentResponse.json());
    expect(afterComment.list[0]?.commentList).toHaveLength(1);
    expect(afterComment.list[0]?.commentList[0]?.isAdmin).toBe(true);

    const deleteResponse = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${seededBugId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
      env,
    );
    expect(deleteResponse.status).toBe(200);
    const afterDelete = adminBugListResponseSchema.parse(await deleteResponse.json());
    expect(afterDelete.list).toHaveLength(0);
    expect(bucket.has(screenshotKey)).toBe(false);
  });

  it("streams a screenshot when fetched by an admin and rejects cross-project keys", async () => {
    const cookie = await login(env);

    const ok = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${seededBugId}/screenshots/${encodeURIComponent(screenshotKey)}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");

    const foreignKey = encodeURIComponent("bugs/other-project/anything.png");
    const forbidden = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${seededBugId}/screenshots/${foreignKey}`,
      { headers: { Cookie: cookie } },
      env,
    );
    expect(forbidden.status).toBe(403);
  });

  it("requires authentication for the bug list", async () => {
    const response = await requestApp(`/api/admin/projects/${projectSlug}/bugs`, {}, env);
    expect(response.status).toBe(401);
  });
});
