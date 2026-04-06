import {
  type AdminProjectResponse,
  type CommentResponse,
  type CreateWishRequest,
  type CreateWishResponse,
  type ListWishResponse,
  type UserRequest,
  type UserResponse,
  type VoteWishResponse,
  type WishResponse,
} from "@openwish/shared";

import type { CommentRow, ProjectRow, UserRow, VoteRow, WishRow } from "../types";

function nowIso() {
  return new Date().toISOString();
}

function newToken(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function toUserResponse(row: UserRow): UserResponse {
  return { uuid: row.uuid };
}

function toCommentResponse(row: CommentRow): CommentResponse {
  return {
    id: row.id,
    userId: row.user_uuid,
    description: row.description,
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
  };
}

function toWishResponse(
  row: WishRow,
  votes: VoteRow[],
  comments: CommentRow[],
): WishResponse {
  const votingUsers = votes
    .filter((vote) => vote.wish_id === row.id)
    .map((vote) => toUserResponse({ uuid: vote.user_uuid }));

  const commentList = comments
    .filter((comment) => comment.wish_id === row.id)
    .map(toCommentResponse);

  return {
    id: row.id,
    userUUID: row.user_uuid,
    title: row.title,
    description: row.description,
    state: row.state as WishResponse["state"],
    votingUsers,
    commentList,
  };
}

export async function bootstrapProject(
  db: D1Database,
  input: { name: string; slug: string; watermarkEnabled: boolean },
) {
  const id = crypto.randomUUID();
  const apiKey = newToken("ow_api");
  const adminToken = newToken("ow_admin");
  const timestamp = nowIso();

  await db
    .prepare(
      `INSERT INTO projects (id, slug, name, api_key, admin_token, watermark_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.slug,
      input.name,
      apiKey,
      adminToken,
      input.watermarkEnabled ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run();

  return {
    name: input.name,
    slug: input.slug,
    apiKey,
    adminToken,
    watermarkEnabled: input.watermarkEnabled,
  };
}

export async function upsertUser(
  db: D1Database,
  projectId: string,
  uuid: string,
  user: UserRequest,
) {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO users (id, project_id, uuid, custom_id, email, name, payment_per_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, uuid) DO UPDATE SET
         custom_id = excluded.custom_id,
         email = COALESCE(excluded.email, users.email),
         name = COALESCE(excluded.name, users.name),
         payment_per_month = COALESCE(excluded.payment_per_month, users.payment_per_month),
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      uuid,
      user.customID ?? null,
      user.email || null,
      user.name ?? null,
      user.paymentPerMonth ?? null,
      timestamp,
      timestamp,
    )
    .run();

  return { uuid };
}

export async function loadWishesForProject(
  db: D1Database,
  project: ProjectRow,
): Promise<ListWishResponse> {
  const [wishesResult, votesResult, commentsResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_uuid, title, description, state, created_at, updated_at
         FROM wishes
         WHERE project_id = ?
         ORDER BY datetime(created_at) DESC`,
      )
      .bind(project.id)
      .all<WishRow>(),
    db
      .prepare(
        `SELECT wish_id, user_uuid
         FROM votes
         WHERE project_id = ?`,
      )
      .bind(project.id)
      .all<VoteRow>(),
    db
      .prepare(
        `SELECT id, wish_id, user_uuid, description, created_at, is_admin
         FROM comments
         WHERE project_id = ?
         ORDER BY datetime(created_at) DESC`,
      )
      .bind(project.id)
      .all<CommentRow>(),
  ]);

  const wishes = wishesResult.results ?? [];
  const votes = votesResult.results ?? [];
  const comments = commentsResult.results ?? [];

  return {
    list: wishes.map((wish) => toWishResponse(wish, votes, comments)),
    shouldShowWatermark: project.watermark_enabled === 1,
  };
}

export async function createWish(
  db: D1Database,
  project: ProjectRow,
  userUuid: string,
  input: CreateWishRequest,
): Promise<CreateWishResponse> {
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO wishes (id, project_id, user_uuid, title, description, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      project.id,
      userUuid,
      input.title,
      input.description,
      input.state,
      timestamp,
      timestamp,
    )
    .run();

  return {
    title: input.title,
    description: input.description,
    state: input.state,
  };
}

export async function toggleVote(
  db: D1Database,
  projectId: string,
  wishId: string,
  userUuid: string,
): Promise<VoteWishResponse | null> {
  const wish = await db
    .prepare(`SELECT id FROM wishes WHERE project_id = ? AND id = ? LIMIT 1`)
    .bind(projectId, wishId)
    .first<{ id: string }>();

  if (!wish) {
    return null;
  }

  const existingVote = await db
    .prepare(`SELECT 1 FROM votes WHERE project_id = ? AND wish_id = ? AND user_uuid = ? LIMIT 1`)
    .bind(projectId, wishId, userUuid)
    .first();

  if (existingVote) {
    await db
      .prepare(`DELETE FROM votes WHERE project_id = ? AND wish_id = ? AND user_uuid = ?`)
      .bind(projectId, wishId, userUuid)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO votes (project_id, wish_id, user_uuid, created_at) VALUES (?, ?, ?, ?)`)
      .bind(projectId, wishId, userUuid, nowIso())
      .run();
  }

  const votingUsersResult = await db
    .prepare(`SELECT user_uuid FROM votes WHERE project_id = ? AND wish_id = ?`)
    .bind(projectId, wishId)
    .all<{ user_uuid: string }>();

  return {
    wishId,
    votingUsers: (votingUsersResult.results ?? []).map((row) => ({ uuid: row.user_uuid })),
  };
}

async function wishExists(db: D1Database, projectId: string, wishId: string) {
  const wish = await db
    .prepare(`SELECT id FROM wishes WHERE project_id = ? AND id = ? LIMIT 1`)
    .bind(projectId, wishId)
    .first<{ id: string }>();

  return Boolean(wish);
}

export async function createComment(
  db: D1Database,
  projectId: string,
  wishId: string,
  userUuid: string,
  description: string,
  isAdmin: boolean,
) {
  const exists = await wishExists(db, projectId, wishId);
  if (!exists) {
    return null;
  }

  const comment: CommentResponse = {
    id: crypto.randomUUID(),
    userId: userUuid,
    description,
    createdAt: nowIso(),
    isAdmin,
  };

  await db
    .prepare(
      `INSERT INTO comments (id, project_id, wish_id, user_uuid, description, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      comment.id,
      projectId,
      wishId,
      userUuid,
      comment.description,
      isAdmin ? 1 : 0,
      comment.createdAt,
    )
    .run();

  return comment;
}

export async function updateWishState(
  db: D1Database,
  projectId: string,
  wishId: string,
  state: string,
) {
  await db
    .prepare(`UPDATE wishes SET state = ?, updated_at = ? WHERE project_id = ? AND id = ?`)
    .bind(state, nowIso(), projectId, wishId)
    .run();
}

export async function updateProjectWatermark(
  db: D1Database,
  projectId: string,
  watermarkEnabled: boolean,
) {
  await db
    .prepare(`UPDATE projects SET watermark_enabled = ?, updated_at = ? WHERE id = ?`)
    .bind(watermarkEnabled ? 1 : 0, nowIso(), projectId)
    .run();
}

export async function loadAdminProject(
  db: D1Database,
  project: ProjectRow,
): Promise<AdminProjectResponse> {
  const [listWishResponse, userCount, voteCount] = await Promise.all([
    loadWishesForProject(db, project),
    db
      .prepare(`SELECT COUNT(*) AS count FROM users WHERE project_id = ?`)
      .bind(project.id)
      .first<{ count: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM votes WHERE project_id = ?`)
      .bind(project.id)
      .first<{ count: number }>(),
  ]);

  return {
    project: {
      name: project.name,
      slug: project.slug,
      watermarkEnabled: project.watermark_enabled === 1,
      createdAt: project.created_at,
      totalUsers: userCount?.count ?? 0,
      totalWishes: listWishResponse.list.length,
      totalVotes: voteCount?.count ?? 0,
    },
    list: listWishResponse.list,
  };
}
