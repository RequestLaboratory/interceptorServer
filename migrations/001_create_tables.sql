-- ============================================================
-- RequestLab Interceptor Server — Database Migration
-- Run this in the Supabase SQL Editor if the setup script fails
-- Dashboard: https://supabase.com/dashboard/project/scaykggszuqlpryalqkn/sql/new
-- ============================================================

-- ------------------------------------------------------------
-- 1. sessions
--    Custom session table used by the interceptor server to
--    verify Bearer tokens sent from the frontend.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id            TEXT        PRIMARY KEY,
    user_id       TEXT,
    user_data     JSONB,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on sessions" ON sessions;
CREATE POLICY "Service role full access on sessions"
    ON sessions FOR ALL
    USING (true)
    WITH CHECK (true);

-- ------------------------------------------------------------
-- 2. interceptors
--    One row per user-created interceptor (max 3 per user).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interceptors (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    base_url    TEXT        NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    user_id     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS interceptors_user_id_idx    ON interceptors(user_id);
CREATE INDEX IF NOT EXISTS interceptors_created_at_idx ON interceptors(created_at DESC);

ALTER TABLE interceptors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on interceptors" ON interceptors;
CREATE POLICY "Service role full access on interceptors"
    ON interceptors FOR ALL
    USING (true)
    WITH CHECK (true);

-- ------------------------------------------------------------
-- 3. logs
--    One row per proxied request captured by an interceptor.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logs (
    id               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    interceptor_id   TEXT        NOT NULL REFERENCES interceptors(id) ON DELETE CASCADE,
    original_url     TEXT        NOT NULL,
    proxy_url        TEXT        NOT NULL,
    method           TEXT        NOT NULL,
    headers          JSONB       NOT NULL DEFAULT '{}',
    body             TEXT,
    response_status  INTEGER     NOT NULL,
    response_headers JSONB       NOT NULL DEFAULT '{}',
    response_body    TEXT,
    duration         INTEGER     NOT NULL,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS logs_interceptor_id_idx ON logs(interceptor_id);
CREATE INDEX IF NOT EXISTS logs_timestamp_idx      ON logs(timestamp DESC);

ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on logs" ON logs;
CREATE POLICY "Service role full access on logs"
    ON logs FOR ALL
    USING (true)
    WITH CHECK (true);
