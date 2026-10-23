-- Platform (ios/android) of the app that submitted a feature request or issue.
-- New rows take it from the SDK's x-wishkit-sdk-kind header; existing rows are
-- backfilled below from what the SDKs left behind.
ALTER TABLE wishes ADD COLUMN platform TEXT;
ALTER TABLE bugs ADD COLUMN platform TEXT;

-- V2 issues carry SDK context: the Android SDK reports sdk.name
-- "openwish-android" and device.androidVersion, the Swift SDK sdk.name
-- "OpenWish" and app.bundleId.
UPDATE bugs SET platform = 'android'
WHERE platform IS NULL
  AND CASE WHEN json_valid(context_json) THEN
        json_extract(context_json, '$.sdk.name') = 'openwish-android'
        OR json_extract(context_json, '$.device.androidVersion') IS NOT NULL
      ELSE 0 END;

UPDATE bugs SET platform = 'ios'
WHERE platform IS NULL
  AND CASE WHEN json_valid(context_json) THEN
        json_extract(context_json, '$.sdk.name') = 'OpenWish'
        OR json_extract(context_json, '$.app.bundleId') IS NOT NULL
      ELSE 0 END;

-- The Swift SDK sends Foundation's uppercase UUID strings; every other client
-- (Android SDK, web form, MCP, CLI) uses lowercase UUIDs.
UPDATE bugs SET platform = 'ios'
WHERE platform IS NULL AND user_uuid GLOB '*[A-F]*';

UPDATE wishes SET platform = 'ios'
WHERE platform IS NULL AND user_uuid GLOB '*[A-F]*';

-- A lowercase reporter is an Android SDK user when the same device filed an
-- Android issue, or when its user row predates the submission: SDK users load
-- the list before submitting, while web-form, MCP and CLI submissions create
-- their user row in the same request.
UPDATE wishes SET platform = 'android'
WHERE platform IS NULL
  AND EXISTS (
    SELECT 1 FROM bugs
    WHERE bugs.project_id = wishes.project_id
      AND bugs.user_uuid = wishes.user_uuid
      AND bugs.platform = 'android'
  );

UPDATE bugs SET platform = 'android'
WHERE platform IS NULL
  AND EXISTS (
    SELECT 1 FROM bugs AS sibling
    WHERE sibling.project_id = bugs.project_id
      AND sibling.user_uuid = bugs.user_uuid
      AND sibling.platform = 'android'
  );

UPDATE wishes SET platform = 'android'
WHERE platform IS NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.project_id = wishes.project_id
      AND users.uuid = wishes.user_uuid
      AND julianday(wishes.created_at) - julianday(users.created_at) > 10.0 / 86400
  );

UPDATE bugs SET platform = 'android'
WHERE platform IS NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.project_id = bugs.project_id
      AND users.uuid = bugs.user_uuid
      AND julianday(bugs.created_at) - julianday(users.created_at) > 10.0 / 86400
  );

CREATE TABLE IF NOT EXISTS github_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL,
  repository TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, target_type, target_id, url),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_github_links_project_target
  ON github_links(project_id, target_type, target_id, created_at);
