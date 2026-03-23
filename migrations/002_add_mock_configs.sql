-- ============================================================
-- RequestLab Interceptor Server — Migration 002
-- Mock API Manager: add mock_configs table + is_mock column
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/scaykggszuqlpryalqkn/sql/new
-- ============================================================

-- ------------------------------------------------------------
-- 1. mock_configs
--    One row per user-created mock configuration.
--    Keyed on (user_id, method, url) — one mock per endpoint per user.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mock_configs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT        NOT NULL,
    method        TEXT        NOT NULL,
    url           TEXT        NOT NULL,
    status_code   INTEGER     NOT NULL DEFAULT 200,
    response_body JSONB       NOT NULL DEFAULT '{}',
    is_active     BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT mock_configs_user_method_url_unique UNIQUE (user_id, method, url)
);

CREATE INDEX IF NOT EXISTS mock_configs_user_id_idx    ON mock_configs(user_id);
CREATE INDEX IF NOT EXISTS mock_configs_is_active_idx  ON mock_configs(is_active) WHERE is_active = true;

ALTER TABLE mock_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on mock_configs" ON mock_configs;
CREATE POLICY "Service role full access on mock_configs"
    ON mock_configs FOR ALL
    USING (true)
    WITH CHECK (true);

-- ------------------------------------------------------------
-- 2. logs — add is_mock column
--    Tracks whether a log entry was served from a mock config.
-- ------------------------------------------------------------
ALTER TABLE logs
    ADD COLUMN IF NOT EXISTS is_mock BOOLEAN NOT NULL DEFAULT false;
