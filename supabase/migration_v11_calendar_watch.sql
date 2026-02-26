-- Migration v11: Add Google Calendar watch (push notification) columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_watch_channel_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_watch_resource_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_watch_expiry TIMESTAMPTZ;
