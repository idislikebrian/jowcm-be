-- Voicemails table to store incoming voice messages
CREATE TABLE IF NOT EXISTS voicemails (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20),
    recording_sid TEXT,
    recording_url TEXT,
    local_path TEXT,
    duration INTEGER,
    voice_number INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE voicemails
    ALTER COLUMN phone_number DROP NOT NULL;

ALTER TABLE voicemails
    ADD COLUMN IF NOT EXISTS recording_sid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS voicemails_recording_sid_idx
    ON voicemails (recording_sid)
    WHERE recording_sid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS voicemails_voice_number_idx
    ON voicemails (voice_number);

CREATE TABLE IF NOT EXISTS users (
    phone_number VARCHAR(20) PRIMARY KEY,
    streak_count INTEGER NOT NULL DEFAULT 1,
    last_streak_qualified_at TIMESTAMPTZ,
    total_calls INTEGER NOT NULL DEFAULT 0,
    first_call_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Meta table for global counters and settings
CREATE TABLE IF NOT EXISTS meta (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
);

-- Initialize global voice count
INSERT INTO meta (key, value) VALUES ('global_voice_count', '0')
ON CONFLICT (key) DO NOTHING;
