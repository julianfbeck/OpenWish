import { beforeEach, describe, expect, it } from "vitest";

import { dashboardSessionCookieName } from "../src/server/dashboardAuth";
import { readSetCookie, requestApp } from "./support/app";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

type QueryResult<Row> = {
  results?: Row[];
};

class MockPreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly state: { projects: Array<{ slug: string; name: string; watermark_enabled: number }> },
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<Row>() {
    if (this.sql.includes("SELECT * FROM projects WHERE slug = ?")) {
      const slug = String(this.bindings[0] ?? "");
      const project = this.state.projects.find((entry) => entry.slug === slug);
      if (!project) {
        return null;
      }

      return {
        id: `${slug}-id`,
        slug: project.slug,
        name: project.name,
        api_key: `${slug}-api`,
        admin_token: `${slug}-admin`,
        watermark_enabled: project.watermark_enabled,
        created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        updated_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      } as Row;
    }

    return null;
  }

  async all<Row>() {
    if (this.sql.includes("SELECT slug, name, watermark_enabled")) {
      return {
        results: this.state.projects as Row[],
      } satisfies QueryResult<Row>;
    }

    return { results: [] } satisfies QueryResult<Row>;
  }

  async run() {
    return { success: true };
  }
}

class MockD1Database {
  constructor(
    private readonly state: { projects: Array<{ slug: string; name: string; watermark_enabled: number }> },
  ) {}

  prepare(sql: string) {
    return new MockPreparedStatement(sql, this.state);
  }
}

function createEnv() {
  return {
    DB: new MockD1Database({
      projects: [
        { slug: "studio", name: "Studio", watermark_enabled: 0 },
        { slug: "atlas", name: "Atlas", watermark_enabled: 1 },
      ],
    }) as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_CORS_ORIGIN: "*",
    OPENWISH_DASHBOARD_USERNAME: "admin",
    OPENWISH_DASHBOARD_PASSWORD: "secret-pass",
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_NOTIFICATION_FROM: "noreply@example.com",
    OPENWISH_DASHBOARD_URL: "https://dash.example.com",
  };
}

describe("dashboard auth", () => {
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    env = createEnv();
  });

  it("logs in with configured env credentials", async () => {
    const response = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "admin",
          password: "secret-pass",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { username: string };
    expect(payload.username).toBe("admin");
    expect(readSetCookie(response)).toContain(`${dashboardSessionCookieName}=`);
  });

  it("rejects invalid dashboard credentials", async () => {
    const response = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "admin",
          password: "wrong",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
  });

  it("issues a 30-day persistent session cookie by default", async () => {
    const response = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      },
      env,
    );

    const cookie = readSetCookie(response) ?? "";
    expect(cookie).toContain("Max-Age=2592000"); // 30 days in seconds
    expect(cookie).toContain("HttpOnly");
  });

  it("honours OPENWISH_DASHBOARD_SESSION_DAYS", async () => {
    const response = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      },
      { ...env, OPENWISH_DASHBOARD_SESSION_DAYS: "7" },
    );

    expect(readSetCookie(response) ?? "").toContain("Max-Age=604800"); // 7 days
  });

  it("slides the session by re-issuing the cookie on each session check", async () => {
    const login = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "secret-pass" }),
      },
      env,
    );
    const cookie = readSetCookie(login) ?? "";
    expect(cookie).toBeTruthy();

    const session = await requestApp(
      "/api/auth/session",
      { headers: { Cookie: cookie } },
      env,
    );

    expect(session.status).toBe(200);
    const refreshed = readSetCookie(session) ?? "";
    expect(refreshed).toContain(`${dashboardSessionCookieName}=`);
    expect(refreshed).toContain("Max-Age=2592000");
  });

  it("protects project listing behind the dashboard session", async () => {
    const unauthenticated = await requestApp("/api/admin/projects", undefined, env);
    expect(unauthenticated.status).toBe(401);

    const login = await requestApp(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "admin",
          password: "secret-pass",
        }),
      },
      env,
    );
    const cookie = readSetCookie(login);
    expect(cookie).toBeTruthy();

    const authenticated = await requestApp(
      "/api/admin/projects",
      {
        headers: {
          Cookie: cookie ?? "",
        },
      },
      env,
    );

    expect(authenticated.status).toBe(200);
    const payload = (await authenticated.json()) as {
      projects: Array<{ slug: string; name: string }>;
    };
    expect(payload.projects).toHaveLength(2);
    expect(payload.projects[0]?.slug).toBe("studio");
  });
});
