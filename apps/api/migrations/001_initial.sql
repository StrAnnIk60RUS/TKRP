-- TKRP initial schema: PostgreSQL + pgvector
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS publications (
  id              BIGSERIAL PRIMARY KEY,
  publication_id  VARCHAR(512) UNIQUE NOT NULL,
  competitor_id   VARCHAR(256),
  competitor_name VARCHAR(256),
  platform        VARCHAR(64),
  source_url      TEXT,
  parsed_at       TIMESTAMPTZ,
  collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  publication_model JSONB NOT NULL,
  raw_content     TEXT,
  raw_metrics     JSONB,
  engagement_rate REAL,
  content_strategy_snapshot JSONB,
  embedding       vector(1024),
  embedding_model VARCHAR(128),
  embedded_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publications_platform ON publications(platform);
CREATE INDEX IF NOT EXISTS idx_publications_collected ON publications(collected_at DESC);

CREATE TABLE IF NOT EXISTS content_plans (
  id                  BIGSERIAL PRIMARY KEY,
  plan_id             VARCHAR(512) UNIQUE NOT NULL,
  competitor_id       VARCHAR(256),
  competitor_name     VARCHAR(256),
  platform            VARCHAR(64),
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_plan_model  JSONB NOT NULL,
  content_strategy_snapshot JSONB,
  ontology_support    JSONB,
  embedding           vector(1024),
  embedding_model     VARCHAR(128),
  embedded_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_plans_platform ON content_plans(platform);
CREATE INDEX IF NOT EXISTS idx_content_plans_collected ON content_plans(collected_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id                      BIGSERIAL PRIMARY KEY,
  run_id                  VARCHAR(64) UNIQUE NOT NULL,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  source                  VARCHAR(64),
  competitors_count       INT,
  publications_processed  INT,
  content_plans_processed INT,
  inserted_publications   INT,
  updated_publications    INT,
  inserted_content_plans  INT,
  updated_content_plans   INT,
  dedup_stats             JSONB,
  embedding_stats         JSONB
);

CREATE TABLE IF NOT EXISTS user_plans (
  id              BIGSERIAL PRIMARY KEY,
  plan_id         VARCHAR(128) UNIQUE NOT NULL,
  plan_json       JSONB NOT NULL,
  optimization    JSONB,
  form_input      JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_history (
  id           BIGSERIAL PRIMARY KEY,
  plan_id      VARCHAR(128) NOT NULL REFERENCES user_plans(plan_id),
  saved_at     TIMESTAMPTZ DEFAULT NOW(),
  type         VARCHAR(32) DEFAULT 'draft',
  plan         JSONB NOT NULL,
  optimization JSONB,
  summary      JSONB
);

CREATE INDEX IF NOT EXISTS idx_plan_history_plan ON plan_history(plan_id);

CREATE TABLE IF NOT EXISTS precedents_metadata (
  key           VARCHAR(64) PRIMARY KEY,
  value         JSONB,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO precedents_metadata (key, value) VALUES
  ('schema_version', '2'),
  ('embedding_schema_version', '2')
ON CONFLICT (key) DO NOTHING;
