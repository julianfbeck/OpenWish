import { beforeEach, describe, expect, it } from "vitest";

import {
  apiErrorSchema,
  commentResponseSchema,
  createWishResponseSchema,
  listWishResponseSchema,
  userResponseSchema,
  voteWishResponseSchema,
} from "@openwish/shared";

import { MockD1Database } from "./support/mock-d1";
import { MockR2Bucket } from "./support/mock-r2";
import { MockSendEmail } from "./support/mock-email";
import { MockKV } from "./support/mock-kv";
import { requestApp } from "./support/app";

const projectId = "project-openwish";
const apiKey = "ow_api_demo";
const projectSlug = "openwish";
const ownerUuid = "11111111-1111-4111-8111-111111111111";
const voterUuid = "22222222-2222-4222-8222-222222222222";
const commenterUuid = "33333333-3333-4333-8333-333333333333";
const existingWishId = "44444444-4444-4444-8444-444444444444";
const existingCommentId = "55555555-5555-4555-8555-555555555555";

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

function sdkHeaders(uuid: string, extras?: HeadersInit) {
  return {
    "Content-Type": "application/json",
    "x-wishkit-api-key": apiKey,
    "x-wishkit-uuid": uuid,
    ...(extras ?? {}),
  };
}

describe("Swift SDK routes", () => {
  let db: MockD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    db = new MockD1Database({
      projects: [
        {
          id: projectId,
          slug: projectSlug,
          name: "OpenWish",
          api_key: apiKey,
          admin_token: "ow_admin_demo",
          watermark_enabled: 1,
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
    env = createEnv(db);
  });

  it("lists wishes using the exact Swift SDK response contract", async () => {
    db.state.wishes.push({
      id: existingWishId,
      project_id: projectId,
      user_uuid: ownerUuid,
      title: "Offline sync support",
      description: "Cache the latest board state for planes and trains.",
      state: "planned",
      created_at: "2026-04-09T08:00:00.000Z",
      updated_at: "2026-04-09T08:00:00.000Z",
    });
    db.state.votes.push({
      project_id: projectId,
      wish_id: existingWishId,
      user_uuid: voterUuid,
      created_at: "2026-04-09T08:01:00.000Z",
    });
    db.state.comments.push({
      id: existingCommentId,
      project_id: projectId,
      wish_id: existingWishId,
      user_uuid: commenterUuid,
      description: "Would use this on every trip.",
      is_admin: 0,
      created_at: "2026-04-09T08:02:00.000Z",
    });

    const response = await requestApp(
      "/api/wish/list",
      {
        headers: sdkHeaders(ownerUuid),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = listWishResponseSchema.parse(await response.json());
    expect(payload.shouldShowWatermark).toBe(true);
    expect(payload.list).toHaveLength(1);
    expect(payload.list[0]).toMatchObject({
      id: existingWishId,
      userUUID: ownerUuid,
      title: "Offline sync support",
      state: "planned",
    });
    expect(payload.list[0]?.votingUsers).toEqual([{ uuid: voterUuid }]);
    expect(payload.list[0]?.commentList[0]).toMatchObject({
      id: existingCommentId,
      userId: commenterUuid,
      isAdmin: false,
    });
  });

  it("creates wishes and makes them visible on the next list fetch", async () => {
    const createResponse = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid),
        body: JSON.stringify({
          title: "Transparent export history",
          description: "Show every CSV export with a timestamp and actor.",
          email: "owner@example.com",
          state: "pending",
        }),
      },
      env,
    );

    expect(createResponse.status).toBe(200);
    const createPayload = createWishResponseSchema.parse(await createResponse.json());
    expect(createPayload).toMatchObject({
      title: "Transparent export history",
      description: "Show every CSV export with a timestamp and actor.",
      state: "pending",
    });
    expect(createPayload.id).toMatch(/[0-9a-f-]{36}/);

    expect(db.state.users).toHaveLength(1);
    expect(db.state.users[0]?.uuid).toBe(ownerUuid);
    expect(db.state.users[0]?.email).toBe("owner@example.com");

    const listResponse = await requestApp(
      "/api/wish/list",
      {
        headers: sdkHeaders(ownerUuid),
      },
      env,
    );

    const listPayload = listWishResponseSchema.parse(await listResponse.json());
    expect(listPayload.list).toHaveLength(1);
    expect(listPayload.list[0]?.title).toBe("Transparent export history");
    expect(listPayload.list[0]?.userUUID).toBe(ownerUuid);
  });

  it("toggles votes with the same shape the Swift vote action expects", async () => {
    db.state.wishes.push({
      id: existingWishId,
      project_id: projectId,
      user_uuid: ownerUuid,
      title: "Keyboard shortcuts",
      description: "Ship slash commands for triage.",
      state: "inReview",
      created_at: "2026-04-09T08:00:00.000Z",
      updated_at: "2026-04-09T08:00:00.000Z",
    });

    const firstVote = await requestApp(
      "/api/wish/vote",
      {
        method: "POST",
        headers: sdkHeaders(voterUuid),
        body: JSON.stringify({
          wishId: existingWishId,
        }),
      },
      env,
    );

    expect(firstVote.status).toBe(200);
    const firstPayload = voteWishResponseSchema.parse(await firstVote.json());
    expect(firstPayload.votingUsers).toEqual([{ uuid: voterUuid }]);
    expect(db.state.users.some((user) => user.uuid === voterUuid)).toBe(true);

    const secondVote = await requestApp(
      "/api/wish/vote",
      {
        method: "POST",
        headers: sdkHeaders(voterUuid),
        body: JSON.stringify({
          wishId: existingWishId,
        }),
      },
      env,
    );

    expect(secondVote.status).toBe(200);
    const secondPayload = voteWishResponseSchema.parse(await secondVote.json());
    expect(secondPayload.votingUsers).toEqual([]);
  });

  it("creates comments with ISO timestamps and keeps them attached to the wish list", async () => {
    db.state.wishes.push({
      id: existingWishId,
      project_id: projectId,
      user_uuid: ownerUuid,
      title: "Bulk actions",
      description: "Moderate multiple wishes at once.",
      state: "pending",
      created_at: "2026-04-09T08:00:00.000Z",
      updated_at: "2026-04-09T08:00:00.000Z",
    });

    const commentResponse = await requestApp(
      "/api/comment/create",
      {
        method: "POST",
        headers: sdkHeaders(commenterUuid),
        body: JSON.stringify({
          wishId: existingWishId,
          description: "This is the blocker for our support team.",
        }),
      },
      env,
    );

    expect(commentResponse.status).toBe(200);
    const commentPayload = commentResponseSchema.parse(await commentResponse.json());
    expect(commentPayload.userId).toBe(commenterUuid);
    expect(commentPayload.isAdmin).toBe(false);

    const listResponse = await requestApp(
      "/api/wish/list",
      {
        headers: sdkHeaders(commenterUuid),
      },
      env,
    );

    const listPayload = listWishResponseSchema.parse(await listResponse.json());
    expect(listPayload.list[0]?.commentList).toHaveLength(1);
    expect(listPayload.list[0]?.commentList[0]?.description).toBe(
      "This is the blocker for our support team.",
    );
  });

  it("updates user metadata using the Swift user contract", async () => {
    const response = await requestApp(
      "/api/user/update",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid),
        body: JSON.stringify({
          customID: "customer_42",
          email: "owner@example.com",
          name: "OpenWish Owner",
          paymentPerMonth: 2499,
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    const payload = userResponseSchema.parse(await response.json());
    expect(payload.uuid).toBe(ownerUuid);
    expect(db.state.users[0]).toMatchObject({
      uuid: ownerUuid,
      custom_id: "customer_42",
      email: "owner@example.com",
      name: "OpenWish Owner",
      payment_per_month: 2499,
    });
  });

  it("returns Swift-compatible ApiError payloads for SDK failures", async () => {
    const missingApiKey = await requestApp("/api/wish/list", undefined, env);
    expect(missingApiKey.status).toBe(401);
    expect(apiErrorSchema.parse(await missingApiKey.json())).toEqual({
      reason: "missingApiHeaderKey",
    });

    const missingUuid = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wishkit-api-key": apiKey,
        },
        body: JSON.stringify({
          title: "Broken request",
          description: "No UUID header.",
        }),
      },
      env,
    );
    expect(missingUuid.status).toBe(401);
    expect(apiErrorSchema.parse(await missingUuid.json())).toEqual({
      reason: "missingUUIDHeaderKey",
    });

    const malformedJson = await requestApp(
      "/api/wish/create",
      {
        method: "POST",
        headers: sdkHeaders(ownerUuid),
        body: "{",
      },
      env,
    );
    expect(malformedJson.status).toBe(400);
    const malformedPayload = apiErrorSchema.parse(await malformedJson.json());
    expect(malformedPayload.reason).toBe("unknown");
  });
});
