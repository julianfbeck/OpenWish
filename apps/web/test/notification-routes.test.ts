import { beforeEach, describe, expect, it } from "vitest";

import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

const projectId = "project-emails";
const apiKey = "ow_api_emails";
const projectSlug = "emails-app";
const ownerUuid = "11111111-1111-4111-8111-111111111111";
const adminEmail = "owner@example.com";

function createEnv(db: MockD1Database, bucket: MockR2Bucket, email: MockSendEmail) {
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

describe("notification email flow", () => {
  let db: MockD1Database;
  let bucket: MockR2Bucket;
  let email: MockSendEmail;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: projectSlug,
          name: "Emails App",
          api_key: apiKey,
          admin_token: "ow_admin_emails",
          watermark_enabled: 0,
          notification_email: null,
          created_at: "2026-04-09T09:00:00.000Z",
          updated_at: "2026-04-09T09:00:00.000Z",
        },
      ],
    });
    bucket = new MockR2Bucket();
    email = new MockSendEmail();
    env = createEnv(db, bucket, email);
  });

  it("saves a notification email through the settings PATCH and clears it with empty string", async () => {
    const cookie = await login(env);

    const save = await requestApp(
      `/api/admin/projects/${projectSlug}/settings`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEmail: adminEmail }),
      },
      env,
    );
    expect(save.status).toBe(200);
    const savedPayload = (await save.json()) as { project: { notificationEmail: string } };
    expect(savedPayload.project.notificationEmail).toBe(adminEmail);
    expect(db.state.projects[0]?.notification_email).toBe(adminEmail);

    const clear = await requestApp(
      `/api/admin/projects/${projectSlug}/settings`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEmail: "" }),
      },
      env,
    );
    expect(clear.status).toBe(200);
    expect(db.state.projects[0]?.notification_email).toBeNull();
  });

  it("sends a test email through the test-email endpoint", async () => {
    const cookie = await login(env);

    const response = await requestApp(
      `/api/admin/projects/${projectSlug}/test-email`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ to: adminEmail }),
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      from: "noreply@example.com",
      to: adminEmail,
    });
    expect(email.sent[0]?.raw).toContain("Subject: ");
  });

  it("fires a notification email when a new wish is created", async () => {
    db.state.projects[0]!.notification_email = adminEmail;

    const response = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": ownerUuid,
        },
        body: JSON.stringify({
          title: "New filter",
          description: "Filter feedback by source.",
          state: "pending",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe(adminEmail);
    expect(email.sent[0]?.raw).toContain("New filter");
  });

  it("fires a notification email when a new bug is created", async () => {
    db.state.projects[0]!.notification_email = adminEmail;

    const response = await requestApp(
      "/api/bug/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": ownerUuid,
        },
        body: JSON.stringify({
          title: "Crash",
          description: "Crashes on launch.",
          screenshotKeys: [],
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe(adminEmail);
    expect(email.sent[0]?.raw).toContain("Crash");
  });

  it("does not send a notification email when the project has none configured", async () => {
    const response = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": ownerUuid,
        },
        body: JSON.stringify({
          title: "Quiet wish",
          description: "Should not trigger an email.",
          state: "pending",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(email.sent).toHaveLength(0);
  });
});
