import { beforeEach, describe, expect, it } from "vitest";

import { createBugResponseSchema } from "@openwish/shared";

import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { requestApp } from "./support/app";

const projectId = "project-bugs";
const apiKey = "ow_api_bugs";
const projectSlug = "bugs-app";
const ownerUuid = "11111111-1111-4111-8111-111111111111";

function createEnv(
  db: MockD1Database,
  bucket: MockR2Bucket = new MockR2Bucket(),
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

function sdkHeaders(uuid: string, extras?: Record<string, string>) {
  return {
    "x-wishkit-api-key": apiKey,
    "x-wishkit-uuid": uuid,
    ...extras,
  };
}

function fakePngBuffer(byteLength = 16): ArrayBuffer {
  const buffer = new ArrayBuffer(byteLength);
  const view = new Uint8Array(buffer);
  // PNG signature so the contents look plausible.
  view[0] = 0x89;
  view[1] = 0x50;
  view[2] = 0x4e;
  view[3] = 0x47;
  return buffer;
}

describe("SDK bug routes", () => {
  let db: MockD1Database;
  let bucket: MockR2Bucket;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: projectSlug,
          name: "Bugs App",
          api_key: apiKey,
          admin_token: "ow_admin_bugs",
          watermark_enabled: 0,
          notification_email: null,
          public_form_enabled: 0,
          created_at: "2026-04-09T09:00:00.000Z",
          updated_at: "2026-04-09T09:00:00.000Z",
        },
      ],
    });
    bucket = new MockR2Bucket();
    env = createEnv(db, bucket);
  });

  it("uploads a screenshot, returns a key, and creates a bug referencing it", async () => {
    const uploadResponse = await requestApp(
      "/api/bug/screenshot",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid, { "content-type": "image/png" }),
        body: fakePngBuffer(),
      },
      env,
    );

    expect(uploadResponse.status).toBe(200);
    const { key } = (await uploadResponse.json()) as { key: string };
    expect(key.startsWith(`bugs/${projectId}/`)).toBe(true);
    expect(bucket.has(key)).toBe(true);

    const createResponse = await requestApp(
      "/api/bug/create",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid, { "content-type": "application/json" }),
        body: JSON.stringify({
          title: "Crash on launch",
          description: "App freezes on the splash screen.",
          screenshotKeys: [key],
        }),
      },
      env,
    );

    expect(createResponse.status).toBe(200);
    const payload = createBugResponseSchema.parse(await createResponse.json());
    expect(payload.state).toBe("open");

    const bug = db.state.bugs.find((entry) => entry.id === payload.id);
    expect(bug).toBeDefined();
    expect(JSON.parse(bug?.screenshot_keys ?? "[]")).toEqual([key]);
  });

  it("rejects screenshot uploads with disallowed content types", async () => {
    const response = await requestApp(
      "/api/bug/screenshot",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid, { "content-type": "application/pdf" }),
        body: fakePngBuffer(),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(bucket.size()).toBe(0);
  });

  it("rejects screenshot uploads exceeding the size limit", async () => {
    const response = await requestApp(
      "/api/bug/screenshot",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid, { "content-type": "image/png" }),
        body: fakePngBuffer(5 * 1024 * 1024 + 1),
      },
      env,
    );

    expect(response.status).toBe(413);
    expect(bucket.size()).toBe(0);
  });

  it("rejects bug creation with screenshot keys that do not exist", async () => {
    const response = await requestApp(
      "/api/bug/create",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid, { "content-type": "application/json" }),
        body: JSON.stringify({
          title: "Missing key",
          description: "Made up screenshot.",
          screenshotKeys: [`bugs/${projectId}/does-not-exist.png`],
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(db.state.bugs).toHaveLength(0);
  });

  it("lists only bugs filed by the calling user", async () => {
    const otherUserUuid = "22222222-2222-4222-8222-222222222222";
    const ownBugId = "33333333-3333-4333-8333-333333333333";
    const otherBugId = "44444444-4444-4444-8444-444444444444";
    const adminCommentId = "55555555-5555-4555-8555-555555555555";

    db.state.bugs.push(
      {
        id: ownBugId,
        project_id: projectId,
        user_uuid: ownerUuid,
        title: "Mine",
        description: "Caller's bug.",
        state: "open",
        screenshot_keys: "[]",
        reporter_email: null,
        created_at: "2026-04-09T08:00:00.000Z",
        updated_at: "2026-04-09T08:00:00.000Z",
      },
      {
        id: otherBugId,
        project_id: projectId,
        user_uuid: otherUserUuid,
        title: "Theirs",
        description: "Someone else's bug.",
        state: "open",
        screenshot_keys: "[]",
        reporter_email: null,
        created_at: "2026-04-09T08:01:00.000Z",
        updated_at: "2026-04-09T08:01:00.000Z",
      },
    );

    db.state.bugComments.push({
      id: adminCommentId,
      project_id: projectId,
      bug_id: ownBugId,
      user_uuid: "00000000-0000-4000-8000-000000000000",
      description: "Looking into it.",
      is_admin: 1,
      created_at: "2026-04-09T09:00:00.000Z",
    });

    const response = await requestApp(
      "/api/bug/list",
      { headers: sdkHeaders(ownerUuid) },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      list: Array<{ id: string; title: string; commentList: Array<{ isAdmin: boolean }> }>;
    };
    expect(payload.list).toHaveLength(1);
    expect(payload.list[0]?.title).toBe("Mine");
    expect(payload.list[0]?.commentList[0]?.isAdmin).toBe(true);
  });

  it("rejects bug creation with screenshot keys that belong to other projects", async () => {
    await bucket.put(`bugs/other-project/${crypto.randomUUID()}.png`, fakePngBuffer(), {
      httpMetadata: { contentType: "image/png" },
    });

    const foreignKey = `bugs/other-project/foreign.png`;

    const response = await requestApp(
      "/api/bug/create",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid, { "content-type": "application/json" }),
        body: JSON.stringify({
          title: "Stealing key",
          description: "Trying to reuse another project's key.",
          screenshotKeys: [foreignKey],
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(db.state.bugs).toHaveLength(0);
  });
});
