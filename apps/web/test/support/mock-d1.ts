import type {
  AuthChallengeRow,
  BugCommentRow,
  BugRow,
  CommentRow,
  PasskeyRow,
  ProjectRow,
  VoteRow,
  WishRow,
} from "../../src/server/types";

type MockUserRow = {
  id: string;
  project_id: string;
  uuid: string;
  custom_id: string | null;
  email: string | null;
  name: string | null;
  payment_per_month: number | null;
  created_at: string;
  updated_at: string;
};

type MockWishRow = WishRow & {
  project_id: string;
};

type MockCommentRow = CommentRow & {
  project_id: string;
};

type MockVoteRow = VoteRow & {
  project_id: string;
  created_at: string;
};

type MockBugRow = BugRow & {
  project_id: string;
};

type MockBugCommentRow = BugCommentRow & {
  project_id: string;
};

type MockState = {
  projects: ProjectRow[];
  users: MockUserRow[];
  wishes: MockWishRow[];
  votes: MockVoteRow[];
  comments: MockCommentRow[];
  bugs: MockBugRow[];
  bugComments: MockBugCommentRow[];
  passkeys: PasskeyRow[];
  authChallenges: AuthChallengeRow[];
  analyticsEvents: Array<{
    id: string;
    project_id: string;
    kind: string;
    created_at: string;
  }>;
};

type QueryResult<Row> = {
  results?: Row[];
};

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, " ").trim();
}

function descDate(left: string, right: string) {
  return new Date(right).getTime() - new Date(left).getTime();
}

class MockPreparedStatement {
  private bindings: unknown[] = [];

  constructor(
    private readonly db: MockD1Database,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.bindings = values;
    return this;
  }

  async first<Row>() {
    return this.db.first<Row>(this.sql, this.bindings);
  }

  async all<Row>() {
    return this.db.all<Row>(this.sql, this.bindings);
  }

  async run() {
    return this.db.run(this.sql, this.bindings);
  }
}

export class MockD1Database {
  readonly state: MockState;

  constructor(initialState?: Partial<MockState>) {
    this.state = {
      projects: initialState?.projects ?? [],
      users: initialState?.users ?? [],
      wishes: initialState?.wishes ?? [],
      votes: initialState?.votes ?? [],
      comments: initialState?.comments ?? [],
      bugs: initialState?.bugs ?? [],
      bugComments: initialState?.bugComments ?? [],
      passkeys: initialState?.passkeys ?? [],
      authChallenges: initialState?.authChallenges ?? [],
      analyticsEvents: initialState?.analyticsEvents ?? [],
    };
  }

  prepare(sql: string) {
    return new MockPreparedStatement(this, sql);
  }

  async batch(statements: MockPreparedStatement[]) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async first<Row>(sql: string, bindings: unknown[]) {
    const normalized = normalizeSql(sql);

    if (normalized.includes("SELECT * FROM projects WHERE api_key = ? LIMIT 1")) {
      const apiKey = String(bindings[0] ?? "");
      return (this.state.projects.find((project) => project.api_key === apiKey) ?? null) as Row | null;
    }

    if (normalized.includes("SELECT * FROM projects WHERE slug = ? LIMIT 1")) {
      const slug = String(bindings[0] ?? "");
      return (this.state.projects.find((project) => project.slug === slug) ?? null) as Row | null;
    }

    if (normalized.includes("SELECT * FROM projects WHERE id = ? LIMIT 1")) {
      const id = String(bindings[0] ?? "");
      return (this.state.projects.find((project) => project.id === id) ?? null) as Row | null;
    }

    if (normalized.includes("SELECT id FROM wishes WHERE project_id = ? AND id = ? LIMIT 1")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      const wish = this.state.wishes.find(
        (entry) => entry.project_id === projectId && entry.id === wishId,
      );
      return (wish ? { id: wish.id } : null) as Row | null;
    }

    if (normalized.includes("SELECT 1 FROM votes WHERE project_id = ? AND wish_id = ? AND user_uuid = ? LIMIT 1")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      const userUuid = String(bindings[2] ?? "");
      const vote = this.state.votes.find(
        (entry) =>
          entry.project_id === projectId &&
          entry.wish_id === wishId &&
          entry.user_uuid === userUuid,
      );
      return (vote ? { 1: 1 } : null) as Row | null;
    }

    if (normalized.includes("SELECT COUNT(*) AS count FROM users WHERE project_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      return {
        count: this.state.users.filter((entry) => entry.project_id === projectId).length,
      } as Row;
    }

    if (normalized.includes("SELECT COUNT(*) AS count FROM votes WHERE project_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      return {
        count: this.state.votes.filter((entry) => entry.project_id === projectId).length,
      } as Row;
    }

    if (normalized.includes("SELECT COUNT(*) AS count FROM wishes WHERE project_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      return {
        count: this.state.wishes.filter((entry) => entry.project_id === projectId).length,
      } as Row;
    }

    if (normalized.includes("SELECT credential_id FROM auth_passkeys LIMIT 1")) {
      const row = this.state.passkeys[0];
      return (row ? { credential_id: row.credential_id } : null) as Row | null;
    }

    if (
      normalized.includes(
        "SELECT challenge, kind, user_subject, expires_at FROM auth_challenges WHERE challenge = ? AND kind = ? AND expires_at > ?",
      )
    ) {
      const challenge = String(bindings[0] ?? "");
      const kind = String(bindings[1] ?? "");
      const minExpires = Number(bindings[2] ?? 0);
      const row = this.state.authChallenges.find(
        (entry) =>
          entry.challenge === challenge &&
          entry.kind === kind &&
          entry.expires_at > minExpires,
      );
      return (row ?? null) as Row | null;
    }

    if (
      normalized.includes(
        "SELECT credential_id, user_subject, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at FROM auth_passkeys WHERE credential_id = ?",
      )
    ) {
      const credentialId = String(bindings[0] ?? "");
      const row = this.state.passkeys.find((entry) => entry.credential_id === credentialId);
      return (row ?? null) as Row | null;
    }

    if (normalized.includes("SELECT id FROM bugs WHERE project_id = ? AND id = ? LIMIT 1")) {
      const projectId = String(bindings[0] ?? "");
      const bugId = String(bindings[1] ?? "");
      const bug = this.state.bugs.find(
        (entry) => entry.project_id === projectId && entry.id === bugId,
      );
      return (bug ? { id: bug.id } : null) as Row | null;
    }

    if (
      normalized.includes(
        "SELECT screenshot_keys FROM bugs WHERE project_id = ? AND id = ? LIMIT 1",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const bugId = String(bindings[1] ?? "");
      const bug = this.state.bugs.find(
        (entry) => entry.project_id === projectId && entry.id === bugId,
      );
      return (bug ? { screenshot_keys: bug.screenshot_keys } : null) as Row | null;
    }

    if (
      normalized.includes(
        "SELECT id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at FROM bugs WHERE project_id = ? AND id = ? LIMIT 1",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const bugId = String(bindings[1] ?? "");
      const bug = this.state.bugs.find(
        (entry) => entry.project_id === projectId && entry.id === bugId,
      );
      if (!bug) {
        return null;
      }
      const { project_id: _projectId, ...rest } = bug;
      return rest as Row;
    }

    if (normalized.includes("SELECT COUNT(*) AS count FROM analytics_events WHERE project_id = ? AND kind = ?")) {
      const projectId = String(bindings[0] ?? "");
      const kind = String(bindings[1] ?? "");
      return {
        count: this.state.analyticsEvents.filter(
          (entry) => entry.project_id === projectId && entry.kind === kind,
        ).length,
      } as Row;
    }

    return null;
  }

  async all<Row>(sql: string, bindings: unknown[]): Promise<QueryResult<Row>> {
    const normalized = normalizeSql(sql);

    if (normalized.includes("SELECT slug, name, watermark_enabled, api_key, created_at FROM projects")) {
      const results = [...this.state.projects]
        .sort((left, right) => {
          const dateDiff = descDate(left.created_at, right.created_at);
          if (dateDiff !== 0) {
            return dateDiff;
          }

          return left.name.localeCompare(right.name);
        })
        .map(({ slug, name, watermark_enabled, api_key, created_at }) => ({
          slug,
          name,
          watermark_enabled,
          api_key,
          created_at,
        }));

      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, user_uuid, title, description, state, created_at, updated_at FROM wishes WHERE project_id = ? ORDER BY datetime(created_at) DESC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const results = this.state.wishes
        .filter((entry) => entry.project_id === projectId)
        .sort((left, right) => descDate(left.created_at, right.created_at))
        .map(({ id, user_uuid, title, description, state, created_at, updated_at }) => ({
          id,
          user_uuid,
          title,
          description,
          state,
          created_at,
          updated_at,
        }));

      return { results: results as Row[] };
    }

    if (normalized.includes("SELECT wish_id, user_uuid FROM votes WHERE project_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const results = this.state.votes
        .filter((entry) => entry.project_id === projectId)
        .map(({ wish_id, user_uuid }) => ({ wish_id, user_uuid }));

      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, wish_id, user_uuid, description, created_at, is_admin FROM comments WHERE project_id = ? ORDER BY datetime(created_at) DESC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const results = this.state.comments
        .filter((entry) => entry.project_id === projectId)
        .sort((left, right) => descDate(left.created_at, right.created_at))
        .map(({ id, wish_id, user_uuid, description, created_at, is_admin }) => ({
          id,
          wish_id,
          user_uuid,
          description,
          created_at,
          is_admin,
        }));

      return { results: results as Row[] };
    }

    if (normalized.includes("SELECT user_uuid FROM votes WHERE project_id = ? AND wish_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      const results = this.state.votes
        .filter((entry) => entry.project_id === projectId && entry.wish_id === wishId)
        .map(({ user_uuid }) => ({ user_uuid }));

      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT credential_id, user_subject, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at FROM auth_passkeys WHERE user_subject = ?",
      )
    ) {
      const userSubject = String(bindings[0] ?? "");
      const results = this.state.passkeys
        .filter((entry) => entry.user_subject === userSubject)
        .sort((left, right) => descDate(left.created_at, right.created_at));
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT credential_id, transports FROM auth_passkeys WHERE user_subject = ?",
      )
    ) {
      const userSubject = String(bindings[0] ?? "");
      const results = this.state.passkeys
        .filter((entry) => entry.user_subject === userSubject)
        .map((entry) => ({
          credential_id: entry.credential_id,
          transports: entry.transports,
        }));
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at FROM bugs WHERE project_id = ? AND user_uuid = ? ORDER BY datetime(created_at) DESC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const userUuid = String(bindings[1] ?? "");
      const results = this.state.bugs
        .filter((entry) => entry.project_id === projectId && entry.user_uuid === userUuid)
        .sort((left, right) => descDate(left.created_at, right.created_at))
        .map(({ project_id: _projectId, ...rest }) => rest);
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at FROM bugs WHERE project_id = ? ORDER BY datetime(created_at) DESC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const results = this.state.bugs
        .filter((entry) => entry.project_id === projectId)
        .sort((left, right) => descDate(left.created_at, right.created_at))
        .map(({ project_id: _projectId, ...rest }) => rest);
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, bug_id, user_uuid, description, is_admin, created_at FROM bug_comments WHERE project_id = ? AND bug_id IN (SELECT id FROM bugs WHERE project_id = ? AND user_uuid = ?) ORDER BY datetime(created_at) ASC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const userUuid = String(bindings[2] ?? "");
      const ownedBugIds = new Set(
        this.state.bugs
          .filter((entry) => entry.project_id === projectId && entry.user_uuid === userUuid)
          .map((entry) => entry.id),
      );
      const results = this.state.bugComments
        .filter((entry) => entry.project_id === projectId && ownedBugIds.has(entry.bug_id))
        .sort((left, right) => -descDate(left.created_at, right.created_at))
        .map(({ project_id: _projectId, ...rest }) => rest);
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, bug_id, user_uuid, description, is_admin, created_at FROM bug_comments WHERE project_id = ? AND bug_id = ? ORDER BY datetime(created_at) ASC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const bugId = String(bindings[1] ?? "");
      const results = this.state.bugComments
        .filter((entry) => entry.project_id === projectId && entry.bug_id === bugId)
        .sort((left, right) => -descDate(left.created_at, right.created_at))
        .map(({ project_id: _projectId, ...rest }) => rest);
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT id, bug_id, user_uuid, description, is_admin, created_at FROM bug_comments WHERE project_id = ? ORDER BY datetime(created_at) ASC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const results = this.state.bugComments
        .filter((entry) => entry.project_id === projectId)
        .sort((left, right) => -descDate(left.created_at, right.created_at))
        .map(({ project_id: _projectId, ...rest }) => rest);
      return { results: results as Row[] };
    }

    if (
      normalized.includes(
        "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM analytics_events WHERE project_id = ? AND kind = ? GROUP BY day ORDER BY day ASC",
      )
    ) {
      const projectId = String(bindings[0] ?? "");
      const kind = String(bindings[1] ?? "");
      const byDay = new Map<string, number>();

      for (const event of this.state.analyticsEvents) {
        if (event.project_id !== projectId || event.kind !== kind) {
          continue;
        }

        const day = event.created_at.slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + 1);
      }

      const results = [...byDay.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([day, count]) => ({ day, count }));

      return { results: results as Row[] };
    }

    return { results: [] };
  }

  async run(sql: string, bindings: unknown[]) {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith("CREATE TABLE IF NOT EXISTS") || normalized.startsWith("CREATE INDEX IF NOT EXISTS")) {
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO projects (id, slug, name, api_key, admin_token, watermark_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
    ) {
      this.state.projects.push({
        id: String(bindings[0]),
        slug: String(bindings[1]),
        name: String(bindings[2]),
        api_key: String(bindings[3]),
        admin_token: String(bindings[4]),
        watermark_enabled: Number(bindings[5]),
        notification_email: null,
        created_at: String(bindings[6]),
        updated_at: String(bindings[7]),
      });
      return { success: true };
    }

    if (
      normalized.includes(
        "UPDATE projects SET notification_email = ?, updated_at = ? WHERE id = ?",
      )
    ) {
      const [email, updatedAt, projectId] = bindings;
      const project = this.state.projects.find((entry) => entry.id === projectId);
      if (project) {
        project.notification_email = email === null || email === undefined ? null : String(email);
        project.updated_at = String(updatedAt);
      }
      return { success: true };
    }


    if (
      normalized.includes(
        "INSERT INTO users (id, project_id, uuid, custom_id, email, name, payment_per_month, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, uuid) DO UPDATE SET custom_id = excluded.custom_id, email = COALESCE(excluded.email, users.email), name = COALESCE(excluded.name, users.name), payment_per_month = COALESCE(excluded.payment_per_month, users.payment_per_month), updated_at = excluded.updated_at",
      )
    ) {
      const [id, projectId, uuid, customId, email, name, paymentPerMonth, createdAt, updatedAt] = bindings;
      const existing = this.state.users.find(
        (entry) => entry.project_id === projectId && entry.uuid === uuid,
      );

      if (existing) {
        existing.custom_id = (customId as string | null) ?? null;
        existing.email = (email as string | null) ?? existing.email;
        existing.name = (name as string | null) ?? existing.name;
        existing.payment_per_month = (paymentPerMonth as number | null) ?? existing.payment_per_month;
        existing.updated_at = String(updatedAt);
        return { success: true };
      }

      this.state.users.push({
        id: String(id),
        project_id: String(projectId),
        uuid: String(uuid),
        custom_id: (customId as string | null) ?? null,
        email: (email as string | null) ?? null,
        name: (name as string | null) ?? null,
        payment_per_month: (paymentPerMonth as number | null) ?? null,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO wishes (id, project_id, user_uuid, title, description, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
    ) {
      this.state.wishes.push({
        id: String(bindings[0]),
        project_id: String(bindings[1]),
        user_uuid: String(bindings[2]),
        title: String(bindings[3]),
        description: String(bindings[4]),
        state: String(bindings[5]),
        created_at: String(bindings[6]),
        updated_at: String(bindings[7]),
      });
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO votes (project_id, wish_id, user_uuid, created_at) VALUES (?, ?, ?, ?)",
      )
    ) {
      this.state.votes.push({
        project_id: String(bindings[0]),
        wish_id: String(bindings[1]),
        user_uuid: String(bindings[2]),
        created_at: String(bindings[3]),
      });
      return { success: true };
    }

    if (normalized.includes("DELETE FROM votes WHERE project_id = ? AND wish_id = ? AND user_uuid = ?")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      const userUuid = String(bindings[2] ?? "");
      this.state.votes = this.state.votes.filter(
        (entry) =>
          !(
            entry.project_id === projectId &&
            entry.wish_id === wishId &&
            entry.user_uuid === userUuid
          ),
      );
      return { success: true };
    }

    if (normalized.includes("DELETE FROM votes WHERE project_id = ? AND wish_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      this.state.votes = this.state.votes.filter(
        (entry) => !(entry.project_id === projectId && entry.wish_id === wishId),
      );
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO comments (id, project_id, wish_id, user_uuid, description, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
    ) {
      this.state.comments.push({
        id: String(bindings[0]),
        project_id: String(bindings[1]),
        wish_id: String(bindings[2]),
        user_uuid: String(bindings[3]),
        description: String(bindings[4]),
        is_admin: Number(bindings[5]),
        created_at: String(bindings[6]),
      });
      return { success: true };
    }

    if (normalized.includes("UPDATE comments SET wish_id = ? WHERE project_id = ? AND wish_id = ?")) {
      const [targetWishId, projectId, sourceWishId] = bindings;
      for (const comment of this.state.comments) {
        if (comment.project_id === projectId && comment.wish_id === sourceWishId) {
          comment.wish_id = String(targetWishId);
        }
      }
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT OR IGNORE INTO votes (project_id, wish_id, user_uuid, created_at) SELECT project_id, ?, user_uuid, created_at FROM votes WHERE project_id = ? AND wish_id = ?",
      )
    ) {
      const [targetWishId, projectId, sourceWishId] = bindings;
      const sourceVotes = this.state.votes.filter(
        (entry) => entry.project_id === projectId && entry.wish_id === sourceWishId,
      );

      for (const vote of sourceVotes) {
        const exists = this.state.votes.some(
          (entry) =>
            entry.project_id === projectId &&
            entry.wish_id === targetWishId &&
            entry.user_uuid === vote.user_uuid,
        );

        if (!exists) {
          this.state.votes.push({
            ...vote,
            wish_id: String(targetWishId),
          });
        }
      }

      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO analytics_events (id, project_id, kind, created_at) VALUES (?, ?, ?, ?)",
      )
    ) {
      this.state.analyticsEvents.push({
        id: String(bindings[0]),
        project_id: String(bindings[1]),
        kind: String(bindings[2]),
        created_at: String(bindings[3]),
      });
      return { success: true };
    }

    if (
      normalized.includes(
        "UPDATE wishes SET title = COALESCE(?, title), description = COALESCE(?, description), state = COALESCE(?, state), updated_at = ? WHERE project_id = ? AND id = ?",
      )
    ) {
      const [title, description, state, updatedAt, projectId, wishId] = bindings;
      const wish = this.state.wishes.find(
        (entry) => entry.project_id === projectId && entry.id === wishId,
      );
      if (wish) {
        if (title !== null && title !== undefined) {
          wish.title = String(title);
        }
        if (description !== null && description !== undefined) {
          wish.description = String(description);
        }
        if (state !== null && state !== undefined) {
          wish.state = String(state);
        }
        wish.updated_at = String(updatedAt);
      }
      return { success: true };
    }

    if (normalized.includes("UPDATE wishes SET updated_at = ? WHERE project_id = ? AND id = ?")) {
      const [updatedAt, projectId, wishId] = bindings;
      const wish = this.state.wishes.find(
        (entry) => entry.project_id === projectId && entry.id === wishId,
      );
      if (wish) {
        wish.updated_at = String(updatedAt);
      }
      return { success: true };
    }

    if (normalized.includes("UPDATE projects SET watermark_enabled = ?, updated_at = ? WHERE id = ?")) {
      const [watermarkEnabled, updatedAt, projectId] = bindings;
      const project = this.state.projects.find((entry) => entry.id === projectId);
      if (project) {
        project.watermark_enabled = Number(watermarkEnabled);
        project.updated_at = String(updatedAt);
      }
      return { success: true };
    }

    if (normalized.includes("DELETE FROM comments WHERE project_id = ? AND wish_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      this.state.comments = this.state.comments.filter(
        (entry) => !(entry.project_id === projectId && entry.wish_id === wishId),
      );
      return { success: true };
    }

    if (normalized.includes("DELETE FROM wishes WHERE project_id = ? AND id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const wishId = String(bindings[1] ?? "");
      this.state.wishes = this.state.wishes.filter(
        (entry) => !(entry.project_id === projectId && entry.id === wishId),
      );
      return { success: true };
    }

    if (normalized.includes("DELETE FROM auth_challenges WHERE expires_at <= ?")) {
      const cutoff = Number(bindings[0] ?? 0);
      this.state.authChallenges = this.state.authChallenges.filter(
        (entry) => entry.expires_at > cutoff,
      );
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO auth_challenges (challenge, kind, user_subject, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(challenge) DO UPDATE SET expires_at = excluded.expires_at",
      )
    ) {
      const [challenge, kind, userSubject, expiresAt] = bindings;
      const existing = this.state.authChallenges.find(
        (entry) => entry.challenge === challenge,
      );
      if (existing) {
        existing.expires_at = Number(expiresAt);
      } else {
        this.state.authChallenges.push({
          challenge: String(challenge),
          kind: String(kind),
          user_subject: String(userSubject),
          expires_at: Number(expiresAt),
        });
      }
      return { success: true };
    }

    if (normalized.includes("DELETE FROM auth_challenges WHERE challenge = ?")) {
      const challenge = String(bindings[0] ?? "");
      this.state.authChallenges = this.state.authChallenges.filter(
        (entry) => entry.challenge !== challenge,
      );
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO auth_passkeys ( credential_id, user_subject, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
      )
    ) {
      this.state.passkeys.push({
        credential_id: String(bindings[0]),
        user_subject: String(bindings[1]),
        public_key: String(bindings[2]),
        counter: Number(bindings[3]),
        transports: bindings[4] === null || bindings[4] === undefined ? null : String(bindings[4]),
        device_type: bindings[5] === null || bindings[5] === undefined ? null : String(bindings[5]),
        backed_up: Number(bindings[6]),
        label: bindings[7] === null || bindings[7] === undefined ? null : String(bindings[7]),
        created_at: String(bindings[8]),
        last_used_at: null,
      });
      return { success: true };
    }

    if (
      normalized.includes(
        "UPDATE auth_passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?",
      )
    ) {
      const [counter, lastUsedAt, credentialId] = bindings;
      const passkey = this.state.passkeys.find(
        (entry) => entry.credential_id === credentialId,
      );
      if (passkey) {
        passkey.counter = Number(counter);
        passkey.last_used_at = String(lastUsedAt);
      }
      return { success: true };
    }

    if (
      normalized.includes(
        "DELETE FROM auth_passkeys WHERE user_subject = ? AND credential_id = ?",
      )
    ) {
      const userSubject = String(bindings[0] ?? "");
      const credentialId = String(bindings[1] ?? "");
      const before = this.state.passkeys.length;
      this.state.passkeys = this.state.passkeys.filter(
        (entry) =>
          !(entry.user_subject === userSubject && entry.credential_id === credentialId),
      );
      const changes = before - this.state.passkeys.length;
      return { success: true, meta: { changes } } as { success: true; meta: { changes: number } };
    }

    if (
      normalized.includes(
        "INSERT INTO bugs (id, project_id, user_uuid, title, description, state, screenshot_keys, reporter_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
    ) {
      this.state.bugs.push({
        id: String(bindings[0]),
        project_id: String(bindings[1]),
        user_uuid: String(bindings[2]),
        title: String(bindings[3]),
        description: String(bindings[4]),
        state: String(bindings[5]),
        screenshot_keys: String(bindings[6]),
        reporter_email:
          bindings[7] === null || bindings[7] === undefined ? null : String(bindings[7]),
        created_at: String(bindings[8]),
        updated_at: String(bindings[9]),
      });
      return { success: true };
    }

    if (
      normalized.includes(
        "UPDATE bugs SET title = COALESCE(?, title), description = COALESCE(?, description), state = COALESCE(?, state), updated_at = ? WHERE project_id = ? AND id = ?",
      )
    ) {
      const [title, description, state, updatedAt, projectId, bugId] = bindings;
      const bug = this.state.bugs.find(
        (entry) => entry.project_id === projectId && entry.id === bugId,
      );
      if (bug) {
        if (title !== null && title !== undefined) {
          bug.title = String(title);
        }
        if (description !== null && description !== undefined) {
          bug.description = String(description);
        }
        if (state !== null && state !== undefined) {
          bug.state = String(state);
        }
        bug.updated_at = String(updatedAt);
      }
      return { success: true };
    }

    if (normalized.includes("UPDATE bugs SET updated_at = ? WHERE project_id = ? AND id = ?")) {
      const [updatedAt, projectId, bugId] = bindings;
      const bug = this.state.bugs.find(
        (entry) => entry.project_id === projectId && entry.id === bugId,
      );
      if (bug) {
        bug.updated_at = String(updatedAt);
      }
      return { success: true };
    }

    if (normalized.includes("DELETE FROM bug_comments WHERE project_id = ? AND bug_id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const bugId = String(bindings[1] ?? "");
      this.state.bugComments = this.state.bugComments.filter(
        (entry) => !(entry.project_id === projectId && entry.bug_id === bugId),
      );
      return { success: true };
    }

    if (normalized.includes("DELETE FROM bugs WHERE project_id = ? AND id = ?")) {
      const projectId = String(bindings[0] ?? "");
      const bugId = String(bindings[1] ?? "");
      this.state.bugs = this.state.bugs.filter(
        (entry) => !(entry.project_id === projectId && entry.id === bugId),
      );
      return { success: true };
    }

    if (
      normalized.includes(
        "INSERT INTO bug_comments (id, project_id, bug_id, user_uuid, description, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
    ) {
      this.state.bugComments.push({
        id: String(bindings[0]),
        project_id: String(bindings[1]),
        bug_id: String(bindings[2]),
        user_uuid: String(bindings[3]),
        description: String(bindings[4]),
        is_admin: Number(bindings[5]),
        created_at: String(bindings[6]),
      });
      return { success: true };
    }

    if (normalized.includes("DELETE FROM projects WHERE slug = ?")) {
      const slug = String(bindings[0] ?? "");
      const project = this.state.projects.find((entry) => entry.slug === slug);
      if (!project) {
        return { success: true };
      }

      this.state.projects = this.state.projects.filter((entry) => entry.slug !== slug);
      this.state.users = this.state.users.filter((entry) => entry.project_id !== project.id);
      this.state.wishes = this.state.wishes.filter((entry) => entry.project_id !== project.id);
      this.state.votes = this.state.votes.filter((entry) => entry.project_id !== project.id);
      this.state.comments = this.state.comments.filter((entry) => entry.project_id !== project.id);
      this.state.bugs = this.state.bugs.filter((entry) => entry.project_id !== project.id);
      this.state.bugComments = this.state.bugComments.filter(
        (entry) => entry.project_id !== project.id,
      );
      this.state.analyticsEvents = this.state.analyticsEvents.filter(
        (entry) => entry.project_id !== project.id,
      );
      return { success: true };
    }

    return { success: true };
  }
}
