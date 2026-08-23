ALTER TABLE bugs ADD COLUMN issue_kind TEXT NOT NULL DEFAULT 'bug';
ALTER TABLE bugs ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE bugs ADD COLUMN card_json TEXT;

CREATE INDEX IF NOT EXISTS idx_bugs_project_kind
  ON bugs(project_id, issue_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS issue_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (issue_id) REFERENCES bugs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_notes_project_issue
  ON issue_notes(project_id, issue_id, created_at DESC);
