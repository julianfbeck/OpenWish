import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signUnsubscribeToken } from "../src/server/unsubscribe";
import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

const projectId = "project-reporter";
const apiKey = "ow_api_reporter";
const projectSlug = "reporter-app";

const ownerUuid = "11111111-1111-4111-8111-111111111111";
const wishId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bugId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const wishOwnerEmail = "wish-owner@example.com";
const bugReporterEmail = "bug-reporter@example.com";

function createEnv(db: MockD1Database, bucket: MockR2Bucket) {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: bucket as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_CORS_ORIGIN: "*",
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_NOTIFICATION_FROM: "OpenWish <noreply@example.com>",
    OPENWISH_DASHBOARD_URL: "https://dash.example.com",
    CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    CLOUDFLARE_EMAIL_API_TOKEN: "cf-token-456",
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

type SentEmail = { url: string; body: Record<string, unknown> };

function emailFetchMock() {
  const calls: SentEmail[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({ success: true, result: { delivered: [], queued: [], permanent_bounces: [] } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return { fn, calls };
}

describe("reporter notification emails", () => {
  let db: MockD1Database;
  let bucket: MockR2Bucket;
  let env: ReturnType<typeof createEnv>;
  let mail: ReturnType<typeof emailFetchMock>;

  beforeEach(() => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: projectSlug,
          name: "Reporter App",
          api_key: apiKey,
          admin_token: "ow_admin_reporter",
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
      users: [
        {
          id: "user-owner",
          project_id: projectId,
          uuid: ownerUuid,
          custom_id: null,
          email: wishOwnerEmail,
          name: null,
          payment_per_month: null,
          email_unsubscribed: 0,
          created_at: "2026-04-09T09:00:00.000Z",
          updated_at: "2026-04-09T09:00:00.000Z",
        },
      ],
      wishes: [
        {
          id: wishId,
          project_id: projectId,
          user_uuid: ownerUuid,
          title: "Dark mode",
          description: "Please add a dark theme.",
          state: "pending",
          created_at: "2026-04-09T09:30:00.000Z",
          updated_at: "2026-04-09T09:30:00.000Z",
        },
      ],
      bugs: [
        {
          id: bugId,
          project_id: projectId,
          user_uuid: ownerUuid,
          title: "Crash on launch",
          description: "App crashes when opening.",
          state: "open",
          screenshot_keys: "[]",
          reporter_email: bugReporterEmail,
          created_at: "2026-04-09T09:40:00.000Z",
          updated_at: "2026-04-09T09:40:00.000Z",
        },
      ],
    });
    bucket = new MockR2Bucket();
    env = createEnv(db, bucket);
    mail = emailFetchMock();
    vi.stubGlobal("fetch", mail.fn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emails the bug reporter when an admin replies, preferring reporter_email", async () => {
    const cookie = await login(env);

    const response = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${bugId}/comments`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Thanks, we are looking into it." }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]?.url).toContain("/accounts/cf-account-123/email/sending/send");
    expect(mail.calls[0]?.body.to).toBe(bugReporterEmail);
    expect(mail.calls[0]?.body.from).toEqual({ address: "noreply@example.com", name: "OpenWish" });
    expect(String(mail.calls[0]?.body.text)).toContain("Crash on launch");
    expect(String(mail.calls[0]?.body.text)).toContain("Unsubscribe:");
  });

  it("emails the bug reporter when status transitions to fixed", async () => {
    const cookie = await login(env);

    const response = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${bugId}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "fixed" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]?.body.to).toBe(bugReporterEmail);
    expect(String(mail.calls[0]?.body.subject)).toContain("fixed");
  });

  it("does not email when the bug is already fixed", async () => {
    db.state.bugs[0]!.state = "fixed";
    const cookie = await login(env);

    const response = await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${bugId}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "fixed" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(mail.calls).toHaveLength(0);
  });

  it("does not email on a non-resolving bug status change", async () => {
    const cookie = await login(env);

    await requestApp(
      `/api/admin/projects/${projectSlug}/bugs/${bugId}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "confirmed" }),
      },
      env,
    );

    expect(mail.calls).toHaveLength(0);
  });

  it("emails the wish owner when status transitions to implemented", async () => {
    const cookie = await login(env);

    const response = await requestApp(
      `/api/admin/projects/${projectSlug}/wishes/${wishId}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "implemented" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]?.body.to).toBe(wishOwnerEmail);
    expect(String(mail.calls[0]?.body.subject)).toContain("implemented");
    expect(String(mail.calls[0]?.body.text)).toContain("https://dash.example.com/feedback/reporter-app");
  });

  it("emails the wish owner when an admin replies", async () => {
    const cookie = await login(env);

    const response = await requestApp(
      `/api/admin/projects/${projectSlug}/wishes/${wishId}/comments`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Shipping next week!" }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(mail.calls).toHaveLength(1);
    expect(mail.calls[0]?.body.to).toBe(wishOwnerEmail);
    expect(String(mail.calls[0]?.body.text)).toContain("Shipping next week!");
  });

  it("skips sending when the reporter has no email on file", async () => {
    db.state.users[0]!.email = null;
    const cookie = await login(env);

    await requestApp(
      `/api/admin/projects/${projectSlug}/wishes/${wishId}`,
      {
        method: "PATCH",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ state: "implemented" }),
      },
      env,
    );

    expect(mail.calls).toHaveLength(0);
  });

  it("skips sending to an unsubscribed reporter", async () => {
    db.state.users[0]!.email_unsubscribed = 1;
    const cookie = await login(env);

    await requestApp(
      `/api/admin/projects/${projectSlug}/wishes/${wishId}/comments`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Any update?" }),
      },
      env,
    );

    expect(mail.calls).toHaveLength(0);
  });

  it("unsubscribes via a signed token and then suppresses future sends", async () => {
    const token = await signUnsubscribeToken(env, projectId, ownerUuid);
    expect(token).toBeTruthy();

    const unsub = await requestApp(
      `/api/public/unsubscribe?token=${encodeURIComponent(token!)}`,
      { method: "GET" },
      env,
    );
    expect(unsub.status).toBe(200);
    expect(db.state.users[0]?.email_unsubscribed).toBe(1);

    const cookie = await login(env);
    await requestApp(
      `/api/admin/projects/${projectSlug}/wishes/${wishId}/comments`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Late reply." }),
      },
      env,
    );

    expect(mail.calls).toHaveLength(0);
  });

  it("rejects a tampered unsubscribe token", async () => {
    const token = await signUnsubscribeToken(env, projectId, ownerUuid);
    const tampered = `${token}x`;

    const response = await requestApp(
      `/api/public/unsubscribe?token=${encodeURIComponent(tampered)}`,
      { method: "GET" },
      env,
    );

    expect(response.status).toBe(400);
    expect(db.state.users[0]?.email_unsubscribed).toBe(0);
  });
});
