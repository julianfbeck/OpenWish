import { beforeEach, describe, expect, it } from "vitest";

import { readSetCookie, requestApp } from "./support/app";
import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";

const projectId = "project-openwish";
const analyticsProjectId = "project-analytics";

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

async function login(env: ReturnType<typeof createEnv>) {
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

  return readSetCookie(response) ?? "";
}

describe("admin routes", () => {
  let db: MockD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: "openwish",
          name: "OpenWish",
          api_key: "ow_api_openwish",
          admin_token: "ow_admin_openwish",
          watermark_enabled: 1,
          notification_email: null,
          public_form_enabled: 0,
          created_at: "2026-04-01T09:00:00.000Z",
          updated_at: "2026-04-01T09:00:00.000Z",
        },
        {
          id: analyticsProjectId,
          slug: "roadmap",
          name: "Roadmap",
          api_key: "ow_api_roadmap",
          admin_token: "ow_admin_roadmap",
          watermark_enabled: 0,
          notification_email: null,
          public_form_enabled: 0,
          created_at: "2026-04-02T09:00:00.000Z",
          updated_at: "2026-04-02T09:00:00.000Z",
        },
      ],
      wishes: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          project_id: analyticsProjectId,
          user_uuid: "88888888-8888-4888-8888-888888888888",
          title: "Server filters",
          description: "Filter feedback by source.",
          state: "pending",
          created_at: "2026-04-03T09:00:00.000Z",
          updated_at: "2026-04-03T09:00:00.000Z",
        },
        {
          id: "99999999-9999-4999-8999-999999999999",
          project_id: analyticsProjectId,
          user_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Saved views",
          description: "Keep triage filters around.",
          state: "planned",
          created_at: "2026-04-04T09:00:00.000Z",
          updated_at: "2026-04-04T09:00:00.000Z",
        },
      ],
      comments: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          project_id: analyticsProjectId,
          wish_id: "77777777-7777-4777-8777-777777777777",
          user_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          description: "Need better filtering.",
          created_at: "2026-04-05T09:30:00.000Z",
          is_admin: 0,
        },
      ],
      votes: [
        {
          project_id: analyticsProjectId,
          wish_id: "77777777-7777-4777-8777-777777777777",
          user_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          created_at: "2026-04-05T09:00:00.000Z",
        },
        {
          project_id: analyticsProjectId,
          wish_id: "99999999-9999-4999-8999-999999999999",
          user_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          created_at: "2026-04-06T09:00:00.000Z",
        },
      ],
      analyticsEvents: [
        {
          id: crypto.randomUUID(),
          project_id: analyticsProjectId,
          kind: "view",
          created_at: "2026-04-06T09:00:00.000Z",
        },
        {
          id: crypto.randomUUID(),
          project_id: analyticsProjectId,
          kind: "view",
          created_at: "2026-04-06T18:00:00.000Z",
        },
        {
          id: crypto.randomUUID(),
          project_id: analyticsProjectId,
          kind: "view",
          created_at: "2026-04-07T11:00:00.000Z",
        },
      ],
    });
    env = createEnv(db);
  });

  it("lists project metadata for the admin shell", async () => {
    const token = await login(env);
    const response = await requestApp(
      "/api/admin/projects",
      {
        headers: {
          Cookie: token,
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      projects: Array<{ slug: string; apiKey: string; createdAt: string }>;
    };
    expect(payload.projects[0]).toMatchObject({
      slug: "roadmap",
      apiKey: "ow_api_roadmap",
      createdAt: "2026-04-02T09:00:00.000Z",
    });
  });

  it("exposes analytics totals for votes and feature requests", async () => {
    const token = await login(env);
    const analyticsResponse = await requestApp(
      "/api/admin/projects/roadmap/analytics",
      {
        headers: {
          Cookie: token,
        },
      },
      env,
    );

    expect(analyticsResponse.status).toBe(200);
    const payload = (await analyticsResponse.json()) as {
      totals: {
        views: number;
        votes: number;
        featureRequests: number;
        engagementRate: number;
      };
      series: Array<{ date: string; views: number }>;
    };

    expect(payload.totals).toMatchObject({
      votes: 2,
      featureRequests: 2,
    });
  });

  it("updates request copy through the admin patch route", async () => {
    const token = await login(env);
    const response = await requestApp(
      "/api/admin/projects/roadmap/wishes/77777777-7777-4777-8777-777777777777",
      {
        method: "PATCH",
        headers: {
          Cookie: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Advanced filters",
          description: "Filter feedback by source and product area.",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      list: Array<{ id: string; title: string; description: string }>;
    };
    const updatedWish = payload.list.find(
      (wish) => wish.id === "77777777-7777-4777-8777-777777777777",
    );

    expect(updatedWish).toMatchObject({
      title: "Advanced filters",
      description: "Filter feedback by source and product area.",
    });
  });

  it("merges one request into another and preserves comments plus unique voters", async () => {
    const token = await login(env);
    const response = await requestApp(
      "/api/admin/projects/roadmap/wishes/77777777-7777-4777-8777-777777777777/merge",
      {
        method: "POST",
        headers: {
          Cookie: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          targetWishId: "99999999-9999-4999-8999-999999999999",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      list: Array<{
        id: string;
        votingUsers: Array<{ uuid: string }>;
        commentList: Array<{ id: string }>;
      }>;
    };

    expect(payload.list).toHaveLength(1);
    expect(payload.list[0]).toMatchObject({
      id: "99999999-9999-4999-8999-999999999999",
    });
    expect(payload.list[0].votingUsers).toHaveLength(2);
    expect(payload.list[0].commentList).toHaveLength(1);
    expect(db.state.wishes.some((wish) => wish.id === "77777777-7777-4777-8777-777777777777")).toBe(false);
  });

  it("deletes a single request from the board", async () => {
    const token = await login(env);
    const response = await requestApp(
      "/api/admin/projects/roadmap/wishes/77777777-7777-4777-8777-777777777777",
      {
        method: "DELETE",
        headers: {
          Cookie: token,
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      list: Array<{ id: string }>;
    };

    expect(payload.list.map((wish) => wish.id)).toEqual([
      "99999999-9999-4999-8999-999999999999",
    ]);
    expect(db.state.comments).toHaveLength(0);
    expect(db.state.votes).toHaveLength(1);
  });

  it("deletes a project and its derived admin listing", async () => {
    const token = await login(env);
    const response = await requestApp(
      "/api/admin/projects/openwish",
      {
        method: "DELETE",
        headers: {
          Cookie: token,
        },
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(db.state.projects.some((project) => project.slug === "openwish")).toBe(false);
  });
});
