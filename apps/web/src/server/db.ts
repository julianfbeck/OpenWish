import {
  type AdminAnalyticsResponse,
  type AdminProjectResponse,
  type BugResponse,
  type BugState,
  type CommentResponse,
  type CreateBugRequest,
  type CreateBugResponse,
  type CreateWishRequest,
  type CreateWishResponse,
  type ListWishResponse,
  type UserRequest,
  type UserResponse,
  type VoteWishResponse,
  type WishResponse,
  type ProjectSummary,
} from "@openwish/shared";

import type {
  BugCommentRow,
  BugRow,
  CommentRow,
  ProjectRow,
  UserRow,
  VoteRow,
  WishRow,
} from "./types";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    api_key TEXT NOT NULL UNIQUE,
    admin_token TEXT NOT NULL,
    watermark_enabled INTEGER NOT NULL DEFAULT 0,
    notification_email TEXT,
    public_form_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    uuid TEXT NOT NULL,
    custom_id TEXT,
    email TEXT,
    name TEXT,
    payment_per_month INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, uuid),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS wishes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_uuid TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS votes (
    project_id TEXT NOT NULL,
    wish_id TEXT NOT NULL,
    user_uuid TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, wish_id, user_uuid),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    wish_id TEXT NOT NULL,
    user_uuid TEXT NOT NULL,
    description TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS bugs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_uuid TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    screenshot_keys TEXT NOT NULL DEFAULT '[]',
    reporter_email TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS bug_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    bug_id TEXT NOT NULL,
    user_uuid TEXT NOT NULL,
    description TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS auth_passkeys (
    credential_id TEXT PRIMARY KEY,
    user_subject TEXT NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    user_subject TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_passkeys_user ON auth_passkeys(user_subject, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_users_project_uuid ON users(project_id, uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_wishes_project ON wishes(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_votes_project_wish ON votes(project_id, wish_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_project_wish ON comments(project_id, wish_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_project_kind ON analytics_events(project_id, kind, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bug_comments_project_bug ON bug_comments(project_id, bug_id, created_at DESC)`,
] as const;

const schemaInitPromises = new WeakMap<D1Database, Promise<void>>();

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

export async function ensureDatabaseInitialized(db: D1Database) {
  const existingPromise = schemaInitPromises.get(db);
  if (existingPromise) {
    return existingPromise;
  }

  const initPromise = (async () => {
    const statements = schemaStatements.map((statement) => db.prepare(statement));
    if (typeof db.batch === "function") {
      await db.batch(statements);
      return;
    }

    for (const statement of statements) {
      await statement.run();
    }
  })();

  schemaInitPromises.set(db, initPromise);
  await initPromise;
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

export async function loadProjectSummaries(db: D1Database): Promise<ProjectSummary[]> {
  const result = await db
    .prepare(
      `SELECT slug, name, watermark_enabled, api_key, created_at
       FROM projects
       ORDER BY datetime(created_at) DESC, name ASC`,
    )
    .all<{ slug: string; name: string; watermark_enabled: number; api_key: string; created_at: string }>();

  return (result.results ?? []).map((project) => ({
    slug: project.slug,
    name: project.name,
    watermarkEnabled: project.watermark_enabled === 1,
    apiKey: project.api_key,
    createdAt: project.created_at,
  }));
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

export async function ensureUserExists(
  db: D1Database,
  projectId: string,
  uuid: string,
) {
  return upsertUser(db, projectId, uuid, {});
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
  await ensureUserExists(db, project.id, userUuid);

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO wishes (id, project_id, user_uuid, title, description, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
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
    id,
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
  await ensureUserExists(db, projectId, userUuid);

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
  await ensureUserExists(db, projectId, userUuid);

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

export async function updateWish(
  db: D1Database,
  projectId: string,
  wishId: string,
  input: {
    title?: string;
    description?: string;
    state?: string;
  },
) {
  await db
    .prepare(
      `UPDATE wishes
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           state = COALESCE(?, state),
           updated_at = ?
       WHERE project_id = ? AND id = ?`,
    )
    .bind(
      input.title ?? null,
      input.description ?? null,
      input.state ?? null,
      nowIso(),
      projectId,
      wishId,
    )
    .run();
}

export async function deleteWish(
  db: D1Database,
  projectId: string,
  wishId: string,
) {
  const exists = await wishExists(db, projectId, wishId);
  if (!exists) {
    return false;
  }

  await Promise.all([
    db
      .prepare(`DELETE FROM comments WHERE project_id = ? AND wish_id = ?`)
      .bind(projectId, wishId)
      .run(),
    db
      .prepare(`DELETE FROM votes WHERE project_id = ? AND wish_id = ?`)
      .bind(projectId, wishId)
      .run(),
  ]);

  await db
    .prepare(`DELETE FROM wishes WHERE project_id = ? AND id = ?`)
    .bind(projectId, wishId)
    .run();

  return true;
}

export async function mergeWish(
  db: D1Database,
  projectId: string,
  sourceWishId: string,
  targetWishId: string,
) {
  if (sourceWishId === targetWishId) {
    return false;
  }

  const [sourceExists, targetExists] = await Promise.all([
    wishExists(db, projectId, sourceWishId),
    wishExists(db, projectId, targetWishId),
  ]);

  if (!sourceExists || !targetExists) {
    return false;
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO votes (project_id, wish_id, user_uuid, created_at)
       SELECT project_id, ?, user_uuid, created_at
       FROM votes
       WHERE project_id = ? AND wish_id = ?`,
    )
    .bind(targetWishId, projectId, sourceWishId)
    .run();

  await Promise.all([
    db
      .prepare(`UPDATE comments SET wish_id = ? WHERE project_id = ? AND wish_id = ?`)
      .bind(targetWishId, projectId, sourceWishId)
      .run(),
    db
      .prepare(`DELETE FROM votes WHERE project_id = ? AND wish_id = ?`)
      .bind(projectId, sourceWishId)
      .run(),
  ]);

  await Promise.all([
    db
      .prepare(`DELETE FROM wishes WHERE project_id = ? AND id = ?`)
      .bind(projectId, sourceWishId)
      .run(),
    db
      .prepare(`UPDATE wishes SET updated_at = ? WHERE project_id = ? AND id = ?`)
      .bind(nowIso(), projectId, targetWishId)
      .run(),
  ]);

  return true;
}

export async function updateProjectSettings(
  db: D1Database,
  projectId: string,
  patch: {
    watermarkEnabled?: boolean;
    notificationEmail?: string | null;
    publicFormEnabled?: boolean;
  },
) {
  if (patch.watermarkEnabled !== undefined) {
    await db
      .prepare(`UPDATE projects SET watermark_enabled = ?, updated_at = ? WHERE id = ?`)
      .bind(patch.watermarkEnabled ? 1 : 0, nowIso(), projectId)
      .run();
  }

  if (patch.notificationEmail !== undefined) {
    await db
      .prepare(`UPDATE projects SET notification_email = ?, updated_at = ? WHERE id = ?`)
      .bind(patch.notificationEmail, nowIso(), projectId)
      .run();
  }

  if (patch.publicFormEnabled !== undefined) {
    await db
      .prepare(`UPDATE projects SET public_form_enabled = ?, updated_at = ? WHERE id = ?`)
      .bind(patch.publicFormEnabled ? 1 : 0, nowIso(), projectId)
      .run();
  }
}

export async function loadProjectById(
  db: D1Database,
  projectId: string,
): Promise<ProjectRow | null> {
  const result = await db
    .prepare(`SELECT * FROM projects WHERE id = ? LIMIT 1`)
    .bind(projectId)
    .first<ProjectRow>();
  return result ?? null;
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
      notificationEmail: project.notification_email ?? null,
      publicFormEnabled: project.public_form_enabled === 1,
      createdAt: project.created_at,
      totalUsers: userCount?.count ?? 0,
      totalWishes: listWishResponse.list.length,
      totalVotes: voteCount?.count ?? 0,
    },
    list: listWishResponse.list,
  };
}

export async function deleteProject(
  db: D1Database,
  slug: string,
) {
  await db.prepare(`DELETE FROM projects WHERE slug = ?`).bind(slug).run();
}

export async function recordAnalyticsEvent(
  db: D1Database,
  projectId: string,
  kind: string,
) {
  await db
    .prepare(
      `INSERT INTO analytics_events (id, project_id, kind, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), projectId, kind, nowIso())
    .run();
}

export async function loadProjectAnalytics(
  db: D1Database,
  project: ProjectRow,
): Promise<AdminAnalyticsResponse> {
  const [viewCount, voteCount, wishCount, seriesResult] = await Promise.all([
    db
      .prepare(`SELECT COUNT(*) AS count FROM analytics_events WHERE project_id = ? AND kind = ?`)
      .bind(project.id, "view")
      .first<{ count: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM votes WHERE project_id = ?`)
      .bind(project.id)
      .first<{ count: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS count FROM wishes WHERE project_id = ?`)
      .bind(project.id)
      .first<{ count: number }>(),
    db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
         FROM analytics_events
         WHERE project_id = ? AND kind = ?
         GROUP BY day
         ORDER BY day ASC`,
      )
      .bind(project.id, "view")
      .all<{ day: string; count: number }>(),
  ]);

  const views = viewCount?.count ?? 0;
  const votes = voteCount?.count ?? 0;
  const featureRequests = wishCount?.count ?? 0;
  const engagementRate = views > 0 ? Number((((votes + featureRequests) / views) * 100).toFixed(2)) : 0;

  return {
    project: {
      slug: project.slug,
      name: project.name,
    },
    totals: {
      views,
      votes,
      featureRequests,
      engagementRate,
    },
    series: (seriesResult.results ?? []).map((point) => ({
      date: point.day,
      views: point.count,
    })),
  };
}

// ── Bugs ────────────────────────────────────────────────────────────────

function parseScreenshotKeys(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // fall through
  }
  return [];
}

function toBugCommentResponse(row: BugCommentRow): CommentResponse {
  return {
    id: row.id,
    userId: row.user_uuid,
    description: row.description,
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
  };
}

function toBugResponse(row: BugRow, comments: BugCommentRow[]): BugResponse {
  return {
    id: row.id,
    userUUID: row.user_uuid,
    title: row.title,
    description: row.description,
    state: row.state as BugState,
    screenshotKeys: parseScreenshotKeys(row.screenshot_keys),
    reporterEmail: row.reporter_email ?? null,
    commentList: comments
      .filter((comment) => comment.bug_id === row.id)
      .map(toBugCommentResponse),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createBug(
  db: D1Database,
  project: ProjectRow,
  userUuid: string,
  input: CreateBugRequest,
): Promise<CreateBugResponse> {
  await ensureUserExists(db, project.id, userUuid);

  if (input.email) {
    await upsertUser(db, project.id, userUuid, { email: input.email });
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const state: BugState = "open";

  await db
    .prepare(
      `INSERT INTO bugs (id, project_id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      project.id,
      userUuid,
      input.title,
      input.description,
      state,
      JSON.stringify(input.screenshotKeys ?? []),
      input.email ?? null,
      timestamp,
      timestamp,
    )
    .run();

  return { id, state, createdAt: timestamp };
}

export async function loadUserBugs(
  db: D1Database,
  project: ProjectRow,
  userUuid: string,
): Promise<BugResponse[]> {
  const [bugsResult, commentsResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at
         FROM bugs
         WHERE project_id = ? AND user_uuid = ?
         ORDER BY datetime(created_at) DESC`,
      )
      .bind(project.id, userUuid)
      .all<BugRow>(),
    db
      .prepare(
        `SELECT id, bug_id, user_uuid, description, is_admin, created_at
         FROM bug_comments
         WHERE project_id = ?
           AND bug_id IN (SELECT id FROM bugs WHERE project_id = ? AND user_uuid = ?)
         ORDER BY datetime(created_at) ASC`,
      )
      .bind(project.id, project.id, userUuid)
      .all<BugCommentRow>(),
  ]);

  const bugs = bugsResult.results ?? [];
  const comments = commentsResult.results ?? [];

  return bugs.map((bug) => toBugResponse(bug, comments));
}

export async function loadAdminBugs(
  db: D1Database,
  project: ProjectRow,
): Promise<BugResponse[]> {
  const [bugsResult, commentsResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at
         FROM bugs
         WHERE project_id = ?
         ORDER BY datetime(created_at) DESC`,
      )
      .bind(project.id)
      .all<BugRow>(),
    db
      .prepare(
        `SELECT id, bug_id, user_uuid, description, is_admin, created_at
         FROM bug_comments
         WHERE project_id = ?
         ORDER BY datetime(created_at) ASC`,
      )
      .bind(project.id)
      .all<BugCommentRow>(),
  ]);

  const bugs = bugsResult.results ?? [];
  const comments = commentsResult.results ?? [];

  return bugs.map((bug) => toBugResponse(bug, comments));
}

export async function loadBug(
  db: D1Database,
  project: ProjectRow,
  bugId: string,
): Promise<BugResponse | null> {
  const row = await db
    .prepare(
      `SELECT id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at
       FROM bugs
       WHERE project_id = ? AND id = ?
       LIMIT 1`,
    )
    .bind(project.id, bugId)
    .first<BugRow>();

  if (!row) {
    return null;
  }

  const commentsResult = await db
    .prepare(
      `SELECT id, bug_id, user_uuid, description, is_admin, created_at
       FROM bug_comments
       WHERE project_id = ? AND bug_id = ?
       ORDER BY datetime(created_at) ASC`,
    )
    .bind(project.id, bugId)
    .all<BugCommentRow>();

  return toBugResponse(row, commentsResult.results ?? []);
}

async function bugExists(db: D1Database, projectId: string, bugId: string) {
  const row = await db
    .prepare(`SELECT id FROM bugs WHERE project_id = ? AND id = ? LIMIT 1`)
    .bind(projectId, bugId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function updateBug(
  db: D1Database,
  project: ProjectRow,
  bugId: string,
  input: { title?: string; description?: string; state?: BugState },
): Promise<BugResponse | null> {
  if (!(await bugExists(db, project.id, bugId))) {
    return null;
  }

  await db
    .prepare(
      `UPDATE bugs
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           state = COALESCE(?, state),
           updated_at = ?
       WHERE project_id = ? AND id = ?`,
    )
    .bind(
      input.title ?? null,
      input.description ?? null,
      input.state ?? null,
      nowIso(),
      project.id,
      bugId,
    )
    .run();

  return loadBug(db, project, bugId);
}

export async function deleteBug(
  db: D1Database,
  bucket: R2Bucket,
  project: ProjectRow,
  bugId: string,
): Promise<{ deleted: boolean; screenshotKeys: string[] }> {
  const row = await db
    .prepare(`SELECT screenshot_keys FROM bugs WHERE project_id = ? AND id = ? LIMIT 1`)
    .bind(project.id, bugId)
    .first<{ screenshot_keys: string }>();

  if (!row) {
    return { deleted: false, screenshotKeys: [] };
  }

  const keys = parseScreenshotKeys(row.screenshot_keys);

  await db
    .prepare(`DELETE FROM bug_comments WHERE project_id = ? AND bug_id = ?`)
    .bind(project.id, bugId)
    .run();

  await db
    .prepare(`DELETE FROM bugs WHERE project_id = ? AND id = ?`)
    .bind(project.id, bugId)
    .run();

  await Promise.all(keys.map((key) => bucket.delete(key).catch(() => undefined)));

  return { deleted: true, screenshotKeys: keys };
}

export async function createBugComment(
  db: D1Database,
  project: ProjectRow,
  bugId: string,
  userUuid: string,
  description: string,
  isAdmin: boolean,
): Promise<BugResponse | null> {
  if (!(await bugExists(db, project.id, bugId))) {
    return null;
  }

  await ensureUserExists(db, project.id, userUuid);

  await db
    .prepare(
      `INSERT INTO bug_comments (id, project_id, bug_id, user_uuid, description, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      project.id,
      bugId,
      userUuid,
      description,
      isAdmin ? 1 : 0,
      nowIso(),
    )
    .run();

  await db
    .prepare(`UPDATE bugs SET updated_at = ? WHERE project_id = ? AND id = ?`)
    .bind(nowIso(), project.id, bugId)
    .run();

  return loadBug(db, project, bugId);
}
