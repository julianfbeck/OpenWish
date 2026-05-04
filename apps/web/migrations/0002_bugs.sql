CREATE TABLE IF NOT EXISTS bugs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  screenshot_keys TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bug_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  bug_id TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  description TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_comments_project_bug ON bug_comments(project_id, bug_id, created_at DESC);
