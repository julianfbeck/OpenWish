CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  admin_token TEXT NOT NULL,
  watermark_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
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
);

CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS votes (
  project_id TEXT NOT NULL,
  wish_id TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, wish_id, user_uuid),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  wish_id TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  description TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (wish_id) REFERENCES wishes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_project_uuid ON users(project_id, uuid);
CREATE INDEX IF NOT EXISTS idx_wishes_project ON wishes(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_project_wish ON votes(project_id, wish_id);
CREATE INDEX IF NOT EXISTS idx_comments_project_wish ON comments(project_id, wish_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_project_kind ON analytics_events(project_id, kind, created_at DESC);
