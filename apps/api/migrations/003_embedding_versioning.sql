-- TKRP migration 003: embedding model versioning + ANN (HNSW) indexes.
-- Idempotent: safe to re-run. Requires pgvector >= 0.7 for CREATE INDEX IF NOT EXISTS.

ALTER TABLE publications ADD COLUMN IF NOT EXISTS embedding_model_version VARCHAR(64);
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS embedding_model_version VARCHAR(64);

-- ANN candidate retrieval: ORDER BY embedding <-> query resolves to cosine ops.
-- Column dim (1024) must match EMBEDDING_VECTOR_DIM; HNSW build is blocking but
-- fine at current dataset scale.
CREATE INDEX IF NOT EXISTS idx_publications_embedding_hnsw ON publications USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_content_plans_embedding_hnsw ON content_plans USING hnsw (embedding vector_cosine_ops);
