import { beforeEach, describe, expect, it } from "vitest";

import { requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

const globalKey = "ow_global_test_key";
const projectId = "project-global";
const projectSlug = "global-app";

function createEnv(db: MockD1Database) {
  return {
    DB: db as unknown as D1Database,
    BUGS_BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    RATE_LIMIT_KV: new MockKV() as unknown as KVNamespace,
    NOTIFICATION_EMAIL: new MockSendEmail() as unknown as SendEmail,
    OPENWISH_DASHBOARD_SESSION_SECRET: "local-test-secret",
    OPENWISH_GLOBAL_API_KEY: globalKey,
  };
}

function seededDb() {
  return new MockD1Database({
    projects: [
      {
        id: projectId,
        slug: projectSlug,
        name: "Global App",
        api_key: "ow_api_global",
        admin_token: "ow_admin_global",
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
}

function authed(method: string, body?: unknown) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${globalKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
}

describe("global API (/api/v1)", () => {
  let db: MockD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = seededDb();
    env = createEnv(db);
  });

  it("rejects requests without the global key", async () => {
    const response = await requestApp("/api/v1/projects", { method: "GET" }, env);
    expect(response.status).toBe(401);
  });

  it("rejects a wrong global key", async () => {
    const response = await requestApp(
      "/api/v1/projects",
      { method: "GET", headers: { Authorization: "Bearer nope" } },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("returns 503 when the global key is not configured", async () => {
    const response = await requestApp(
      "/api/v1/projects",
      authed("GET"),
      { ...env, OPENWISH_GLOBAL_API_KEY: undefined },
    );
    expect(response.status).toBe(503);
  });

  it("lists all projects without leaking api keys", async () => {
    const response = await requestApp("/api/v1/projects", authed("GET"), env);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      projects: Array<{ slug: string; name: string; apiKey?: string }>;
    };
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]?.slug).toBe(projectSlug);
    expect(payload.projects[0]?.apiKey).toBeUndefined();
  });

  it("creates a project", async () => {
    const response = await requestApp(
      "/api/v1/projects",
      authed("POST", { name: "Fresh", slug: "fresh-app", watermarkEnabled: false }),
      env,
    );
    expect(response.status).toBe(201);
    const payload = (await response.json()) as { slug: string; apiKey: string };
    expect(payload.slug).toBe("fresh-app");
    expect(payload.apiKey).toMatch(/^ow_api_/);
    expect(db.state.projects.some((project) => project.slug === "fresh-app")).toBe(true);
  });

  it("lists and creates wishes for a project", async () => {
    const create = await requestApp(
      `/api/v1/projects/${projectSlug}/wishes`,
      authed("POST", { title: "Dark mode", description: "Please add dark mode." }),
      env,
    );
    expect(create.status).toBe(201);

    const list = await requestApp(`/api/v1/projects/${projectSlug}/wishes`, authed("GET"), env);
    expect(list.status).toBe(200);
    const payload = (await list.json()) as { list: Array<{ title: string }> };
    expect(payload.list.map((wish) => wish.title)).toContain("Dark mode");
  });

  it("lists and creates bugs for a project", async () => {
    const create = await requestApp(
      `/api/v1/projects/${projectSlug}/bugs`,
      authed("POST", { title: "Crash", description: "Crashes on launch.", screenshotKeys: [] }),
      env,
    );
    expect(create.status).toBe(201);

    const list = await requestApp(`/api/v1/projects/${projectSlug}/bugs`, authed("GET"), env);
    expect(list.status).toBe(200);
    const payload = (await list.json()) as { list: Array<{ title: string }> };
    expect(payload.list.map((bug) => bug.title)).toContain("Crash");
  });

  it("adds and reads private V2 issue notes with the global agent key", async () => {
    const createIssue = await requestApp(
      `/api/v1/projects/${projectSlug}/bugs`,
      authed("POST", { title: "Detection", description: "Wrong card.", screenshotKeys: [] }),
      env,
    );
    const issue = (await createIssue.json()) as { id: string };
    const createNote = await requestApp(
      `/api/v2/projects/${projectSlug}/issues/${issue.id}/notes`,
      authed("POST", { body: "Reproduce with the Japanese card database." }),
      env,
    );
    expect(createNote.status).toBe(201);

    const list = await requestApp(
      `/api/v2/projects/${projectSlug}/issues/${issue.id}/notes`,
      authed("GET"),
      env,
    );
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown).toMatchObject({
      list: [{ body: "Reproduce with the Japanese card database." }],
    });
  });

  it("404s an unknown project", async () => {
    const response = await requestApp("/api/v1/projects/missing/wishes", authed("GET"), env);
    expect(response.status).toBe(404);
  });
});
