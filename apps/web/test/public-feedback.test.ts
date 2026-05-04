import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { requestApp } from "./support/app";

const projectId = "project-public-form";
const apiKey = "ow_api_public";
const projectSlug = "public-app";

function createEnv(
  db: MockD1Database,
  email: MockSendEmail = new MockSendEmail(),
  overrides: Partial<Record<string, string>> = {},
) {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: email as unknown as SendEmail,
    OPENWISH_CORS_ORIGIN: "*",
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_NOTIFICATION_FROM: "noreply@example.com",
    OPENWISH_DASHBOARD_URL: "https://dash.example.com",
    OPENWISH_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    OPENWISH_TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    ...overrides,
  };
}

function makeProjectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: projectId,
    slug: projectSlug,
    name: "Public App",
    api_key: apiKey,
    admin_token: "ow_admin_public",
    watermark_enabled: 0,
    notification_email: null,
    public_form_enabled: 1,
    created_at: "2026-04-09T09:00:00.000Z",
    updated_at: "2026-04-09T09:00:00.000Z",
    ...overrides,
  };
}

function mockTurnstile(success: boolean) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(
      JSON.stringify({
        success,
        "error-codes": success ? [] : ["invalid-input-response"],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

describe("Public feedback routes", () => {
  let db: MockD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database({ projects: [makeProjectRow()] });
    env = createEnv(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET project info returns the public payload only when the form is enabled", async () => {
    mockTurnstile(true);

    const response = await requestApp(
      `/api/public/projects/${projectSlug}`,
      { method: "GET" },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Public App",
      slug: projectSlug,
      enabled: true,
      turnstileSiteKey: "1x00000000000000000000AA",
    });
  });

  it("GET project info returns 404 when the form is disabled", async () => {
    db = new MockD1Database({
      projects: [makeProjectRow({ public_form_enabled: 0 })],
    });
    env = createEnv(db);

    const response = await requestApp(
      `/api/public/projects/${projectSlug}`,
      { method: "GET" },
      env,
    );
    expect(response.status).toBe(404);
  });

  it("POST submit creates a bug when kind=bug and Turnstile passes", async () => {
    const turnstileSpy = mockTurnstile(true);

    const response = await requestApp(
      `/api/public/feedback/${projectSlug}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.10",
        },
        body: JSON.stringify({
          kind: "bug",
          title: "Crash on launch",
          description: "App freezes on the splash screen",
          email: "user@example.com",
          turnstileToken: "test-token",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; id: string };
    expect(body.kind).toBe("bug");
    expect(body.id).toMatch(/[0-9a-f-]{36}/);

    expect(db.state.bugs).toHaveLength(1);
    expect(db.state.bugs[0]?.title).toBe("Crash on launch");
    expect(db.state.bugs[0]?.reporter_email).toBe("user@example.com");

    expect(turnstileSpy).toHaveBeenCalledTimes(1);
    const formData = (turnstileSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body as
      | FormData
      | undefined;
    expect(formData?.get("response")).toBe("test-token");
    expect(formData?.get("remoteip")).toBe("203.0.113.10");
  });

  it("POST submit creates a wish when kind=wish", async () => {
    mockTurnstile(true);

    const response = await requestApp(
      `/api/public/feedback/${projectSlug}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "wish",
          title: "Add dark mode",
          description: "Please add a dark mode option",
          turnstileToken: "test-token",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string };
    expect(body.kind).toBe("wish");
    expect(db.state.wishes).toHaveLength(1);
    expect(db.state.wishes[0]?.title).toBe("Add dark mode");
    expect(db.state.bugs).toHaveLength(0);
  });

  it("POST submit returns 401 when Turnstile fails", async () => {
    mockTurnstile(false);

    const response = await requestApp(
      `/api/public/feedback/${projectSlug}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "bug",
          title: "Bad token",
          description: "Captcha should fail",
          turnstileToken: "bad-token",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    expect(db.state.bugs).toHaveLength(0);
  });

  it("POST submit returns 404 when the project's public form is disabled", async () => {
    db = new MockD1Database({
      projects: [makeProjectRow({ public_form_enabled: 0 })],
    });
    env = createEnv(db);
    mockTurnstile(true);

    const response = await requestApp(
      `/api/public/feedback/${projectSlug}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "bug",
          title: "Disabled",
          description: "Should not land",
          turnstileToken: "test-token",
        }),
      },
      env,
    );

    expect(response.status).toBe(404);
    expect(db.state.bugs).toHaveLength(0);
  });

  it("POST submit returns 429 after too many attempts from the same IP", async () => {
    mockTurnstile(true);

    const baseInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.7",
      },
      body: JSON.stringify({
        kind: "bug",
        title: "Spammy",
        description: "Hammering the endpoint",
        turnstileToken: "test-token",
      }),
    } satisfies RequestInit;

    // public-form-ip cap is 5/min — the 6th submission must be rate-limited.
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await requestApp(
        `/api/public/feedback/${projectSlug}`,
        baseInit,
        env,
      );
      expect(response.status).toBe(200);
    }

    const blocked = await requestApp(
      `/api/public/feedback/${projectSlug}`,
      baseInit,
      env,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});
