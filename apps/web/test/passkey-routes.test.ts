import { beforeEach, describe, expect, it } from "vitest";

import { passkeyAvailabilityResponseSchema } from "@openwish/shared";

import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

function createEnv(db: MockD1Database) {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_CORS_ORIGIN: "*",
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_NOTIFICATION_FROM: "noreply@example.com",
    OPENWISH_DASHBOARD_URL: "https://dash.example.com",
    OPENWISH_PASSKEY_RP_ID: "dash.example.com",
    OPENWISH_PASSKEY_RP_NAME: "OpenWish Test",
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

describe("passkey routes", () => {
  let db: MockD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database();
    env = createEnv(db);
  });

  it("reports `hasPasskey: false` until a credential is registered", async () => {
    const empty = await requestApp("/api/auth/passkey/summary", undefined, env);
    expect(empty.status).toBe(200);
    const payload = passkeyAvailabilityResponseSchema.parse(await empty.json());
    expect(payload.hasPasskey).toBe(false);

    db.state.passkeys.push({
      credential_id: "credA",
      user_subject: "admin",
      public_key: "pk",
      counter: 0,
      transports: null,
      device_type: null,
      backed_up: 0,
      label: "MacBook",
      created_at: new Date().toISOString(),
      last_used_at: null,
    });

    const filled = await requestApp("/api/auth/passkey/summary", undefined, env);
    const filledPayload = passkeyAvailabilityResponseSchema.parse(await filled.json());
    expect(filledPayload.hasPasskey).toBe(true);
  });

  it("rejects password sign-in once any passkey is registered", async () => {
    const ok = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      },
      env,
    );
    expect(ok.status).toBe(200);

    db.state.passkeys.push({
      credential_id: "credLock",
      user_subject: "admin",
      public_key: "pk",
      counter: 0,
      transports: null,
      device_type: null,
      backed_up: 0,
      label: null,
      created_at: new Date().toISOString(),
      last_used_at: null,
    });

    const locked = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      },
      env,
    );
    expect(locked.status).toBe(401);
    const body = (await locked.json()) as { error: string };
    expect(body.error).toMatch(/password sign-in is disabled/i);
  });

  it("issues registration options only to authenticated admins and stores a challenge", async () => {
    const denied = await requestApp(
      "/api/auth/passkey/register/options",
      { method: "POST" },
      env,
    );
    expect(denied.status).toBe(401);

    const cookie = await login(env);
    const allowed = await requestApp(
      "/api/auth/passkey/register/options",
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
      env,
    );
    expect(allowed.status).toBe(200);
    const options = (await allowed.json()) as { challenge: string; rp: { id: string } };
    expect(options.rp.id).toBe("dash.example.com");
    expect(options.challenge.length).toBeGreaterThan(0);
    expect(db.state.authChallenges).toHaveLength(1);
    expect(db.state.authChallenges[0]?.kind).toBe("register");
  });

  it("issues login options publicly and stores a challenge for the configured user", async () => {
    const response = await requestApp(
      "/api/auth/passkey/login/options",
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(200);
    const options = (await response.json()) as { challenge: string; rpId: string };
    expect(options.rpId).toBe("dash.example.com");
    expect(db.state.authChallenges).toHaveLength(1);
    expect(db.state.authChallenges[0]?.kind).toBe("login");
    expect(db.state.authChallenges[0]?.user_subject).toBe("admin");
  });

  it("revokes a passkey when DELETEd by an authenticated admin", async () => {
    // Sign in via password BEFORE the passkey lockout kicks in.
    const cookie = await login(env);

    db.state.passkeys.push({
      credential_id: "credToRemove",
      user_subject: "admin",
      public_key: "pk",
      counter: 0,
      transports: null,
      device_type: null,
      backed_up: 0,
      label: null,
      created_at: new Date().toISOString(),
      last_used_at: null,
    });
    const ok = await requestApp(
      "/api/auth/passkey/credToRemove",
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
      env,
    );
    expect(ok.status).toBe(200);
    expect(db.state.passkeys).toHaveLength(0);

    const missing = await requestApp(
      "/api/auth/passkey/credToRemove",
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
      env,
    );
    expect(missing.status).toBe(404);
  });
});
