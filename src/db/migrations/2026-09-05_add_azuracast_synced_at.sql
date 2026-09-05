-- Adds voicemails.azuracast_synced_at, used to make the AzuraCast media
-- handoff independently retryable on a replayed /recording-complete webhook
-- (see src/routes/recording.ts) without re-running streak/SMS side effects.
--
-- Safe to run more than once: ADD COLUMN IF NOT EXISTS is a no-op if the
-- column already exists. No data is modified; existing rows get NULL
-- (treated by the application as "not yet synced").
--
-- Run against production with:
--   psql "$DATABASE_URL" -f src/db/migrations/2026-09-05_add_azuracast_synced_at.sql

ALTER TABLE voicemails
    ADD COLUMN IF NOT EXISTS azuracast_synced_at TIMESTAMPTZ;
