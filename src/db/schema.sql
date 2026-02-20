-- Voicemails table to store incoming voice messages
CREATE TABLE IF NOT EXISTS voicemails (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(20) NOT NULL,
    recording_url TEXT,
    local_path TEXT,
    duration INTEGER,
    voice_number INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Meta table for global counters and settings
CREATE TABLE IF NOT EXISTS meta (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL
);

-- Initialize global voice count
INSERT INTO meta (key, value) VALUES ('global_voice_count', '0')
ON CONFLICT (key) DO NOTHING;
