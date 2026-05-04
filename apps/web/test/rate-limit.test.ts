import { beforeEach, describe, expect, it } from "vitest";

import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { requestApp } from "./support/app";

const projectId = "project-rl";
const apiKey = "ow_api_rl";
const projectSlug = "rl-app";
const ownerUuid = "11111111-1111-4111-8111-111111111111";

function createEnv(db: MockD1Database, kv: MockKV) {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: kv as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_CORS_ORIGIN: "*",
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_NOTIFICATION_FROM: "noreply@example.com",
    OPENWISH_DASHBOARD_URL: "https://dash.example.com",
  };
}

function sdkHeaders(uuid: string) {
  return {
    "Content-Type": "application/json",
    "x-wishkit-api-key": apiKey,
    "x-wishkit-uuid": uuid,
  };
}

describe("rate limiting", () => {
  let db: MockD1Database;
  let kv: MockKV;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: projectSlug,
          name: "RL",
          api_key: apiKey,
          admin_token: "ow_admin_rl",
          watermark_enabled: 0,
          notification_email: null,
          public_form_enabled: 0,
          created_at: "2026-04-09T09:00:00.000Z",
          updated_at: "2026-04-09T09:00:00.000Z",
        },
      ],
    });
    kv = new MockKV();
    env = createEnv(db, kv);
  });

  async function postCreate() {
    return requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid),
        body: JSON.stringify({
          title: "Quick wish",
          description: "Test the rate limit.",
          state: "pending",
        }),
      },
      env,
    );
  }

  it("returns 429 with Retry-After once the per-device write quota is exhausted", async () => {
    // sdk-write cap is 30 / minute per (apiKey, uuid).
    let allowedCount = 0;
    let throttledCount = 0;
    let lastResponse: Response | null = null;

    for (let attempt = 0; attempt < 35; attempt += 1) {
      const response = await postCreate();
      lastResponse = response;
      if (response.status === 200) {
        allowedCount += 1;
      } else if (response.status === 429) {
        throttledCount += 1;
      }
    }

    expect(allowedCount).toBe(30);
    expect(throttledCount).toBeGreaterThan(0);
    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("rolls the bucket over when the window key changes", async () => {
    for (let i = 0; i < 30; i += 1) {
      const response = await postCreate();
      expect(response.status).toBe(200);
    }

    // simulate window roll-over by clearing all current bucket entries.
    kv.store.clear();

    const response = await postCreate();
    expect(response.status).toBe(200);
  });

  it("isolates buckets per user uuid", async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await postCreate()).status).toBe(200);
    }

    const otherUuid = "22222222-2222-4222-8222-222222222222";
    const response = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: sdkHeaders(otherUuid),
        body: JSON.stringify({
          title: "Other device",
          description: "Should still be allowed.",
          state: "pending",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
  });
});
