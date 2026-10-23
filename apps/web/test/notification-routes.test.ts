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
const commenterUuid = "22222222-2222-4222-8222-222222222222";
const wishId = "33333333-3333-4333-8333-333333333333";
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

// The text part as the recipient reads it, whatever transfer encoding mimetext
// picked for it.
function decodedBody(raw: string | undefined) {
  const message = raw ?? "";
  const separator = message.search(/\r?\n\r?\n/);
  const headers = message.slice(0, separator);
  const body = message.slice(separator).trim();
  if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) {
    return body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return body;
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
    expect(decodedBody(email.sent[0]?.raw)).toContain("New filter");
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
    expect(decodedBody(email.sent[0]?.raw)).toContain("Crash");
  });

  it("fires a notification email when a user comments on a wish", async () => {
    db.state.projects[0]!.notification_email = adminEmail;
    db.state.wishes.push({
      id: wishId,
      project_id: projectId,
      user_uuid: ownerUuid,
      title: "Dark mode",
      description: "Please add a dark theme.",
      state: "pending",
      created_at: "2026-04-09T08:00:00.000Z",
      updated_at: "2026-04-09T08:00:00.000Z",
    });

    const response = await requestApp(
      "/api/comment/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": commenterUuid,
        },
        body: JSON.stringify({ wishId, description: "Would love this for night shifts." }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]?.to).toBe(adminEmail);
    expect(decodedBody(email.sent[0]?.raw)).toContain("Dark mode");
    expect(decodedBody(email.sent[0]?.raw)).toContain("Would love this for night shifts.");
    expect(decodedBody(email.sent[0]?.raw)).toContain(commenterUuid);
  });

  it("emails the full feature request with a direct link and the platform", async () => {
    db.state.projects[0]!.notification_email = adminEmail;
    const description = `${"Search should cover card names, set codes and artists. ".repeat(8)}End of request.`.slice(0, 500);

    const response = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": ownerUuid,
          "x-wishkit-sdk-kind": "ios",
        },
        body: JSON.stringify({ title: "Better search", description, state: "pending" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string };
    const raw = decodedBody(email.sent[0]?.raw);
    expect(raw).toContain(description);
    expect(raw).not.toContain("…");
    expect(raw).toContain("Platform: iOS");
    expect(raw).toContain(`https://dash.example.com/dashboard/${projectSlug}/features/${created.id}`);
  });

  it("emails the full bug report with a direct link to the bug", async () => {
    db.state.projects[0]!.notification_email = adminEmail;
    const description = `Steps: ${"open the scanner, rotate the phone, ".repeat(60)}then it crashes.`.slice(0, 2_000);

    const response = await requestApp(
      "/api/bug/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": ownerUuid,
          "x-wishkit-sdk-kind": "android",
        },
        body: JSON.stringify({ title: "Rotation crash", description, screenshotKeys: [] }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string };
    const raw = decodedBody(email.sent[0]?.raw);
    expect(raw).toContain(description);
    expect(raw).toContain("Platform: Android");
    expect(raw).toContain(`https://dash.example.com/dashboard/${projectSlug}/bugs/${created.id}`);
    // A 2,000-character description stays within SMTP's line length limit.
    expect(Math.max(...(email.sent[0]?.raw ?? "").split(/\r?\n/).map((line) => line.length))).toBeLessThanOrEqual(998);
  });

  it("emails the full comment with a direct link to its feature request", async () => {
    db.state.projects[0]!.notification_email = adminEmail;
    db.state.wishes.push({
      id: wishId,
      project_id: projectId,
      user_uuid: ownerUuid,
      title: "Dark mode",
      description: "Please add a dark theme.",
      state: "pending",
      created_at: "2026-04-09T08:00:00.000Z",
      updated_at: "2026-04-09T08:00:00.000Z",
    });
    const comment = `Grüße aus Köln — ${"I scan cards at night and the white screen is blinding. ".repeat(30)}Thanks!`.slice(0, 2_000);

    const response = await requestApp(
      "/api/comment/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": commenterUuid,
        },
        body: JSON.stringify({ wishId, description: comment }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const raw = decodedBody(email.sent[0]?.raw);
    expect(raw).toContain(comment);
    expect(raw).toContain(`https://dash.example.com/dashboard/${projectSlug}/features/${wishId}`);
  });

  it("does not email about a comment when the project has no notification email", async () => {
    db.state.wishes.push({
      id: wishId,
      project_id: projectId,
      user_uuid: ownerUuid,
      title: "Dark mode",
      description: "Please add a dark theme.",
      state: "pending",
      created_at: "2026-04-09T08:00:00.000Z",
      updated_at: "2026-04-09T08:00:00.000Z",
    });

    const response = await requestApp(
      "/api/comment/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
          "x-wishkit-uuid": commenterUuid,
        },
        body: JSON.stringify({ wishId, description: "Quiet comment." }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(email.sent).toHaveLength(0);
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
