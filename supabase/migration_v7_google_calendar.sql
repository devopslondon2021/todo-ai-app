-- Migration V7: Google Calendar integration
-- Adds OAuth token storage to users and event tracking to tasks.
-- Run this in the Supabase SQL Editor.

-- Google Calendar OAuth fields on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_token_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_calendar_connected BOOLEAN NOT NULL DEFAULT FALSE;

-- Track which tasks came from Google Calendar
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_google_event_id ON tasks(google_event_id) WHERE google_event_id IS NOT NULL;
