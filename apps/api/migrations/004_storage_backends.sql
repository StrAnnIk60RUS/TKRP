-- TKRP DB backends for draftStore.js (wizard drafts) and planSnapshotStore.js (plan snapshots).
-- Keys mirror the JSON storage layout 1:1 (draft key = userId or 'global'; snapshot key = token).
CREATE TABLE IF NOT EXISTS wizard_drafts (
  draft_key  VARCHAR(128) PRIMARY KEY,
  draft      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_snapshots (
  token      VARCHAR(128) PRIMARY KEY,
  owner      VARCHAR(256),
  saved_at   TIMESTAMPTZ DEFAULT NOW(),
  snapshot   JSONB NOT NULL,
  summary    JSONB
);

CREATE INDEX IF NOT EXISTS idx_plan_snapshots_saved ON plan_snapshots(saved_at DESC);
