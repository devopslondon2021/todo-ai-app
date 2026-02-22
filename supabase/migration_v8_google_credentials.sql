-- Migration V8: Store Google OAuth credentials per user (no .env needed)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_client_secret TEXT;
