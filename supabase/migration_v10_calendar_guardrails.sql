-- v10: Add flag to distinguish app-created calendar events from synced ones.
-- Only app-created events should be deleted from Google Calendar when the task is deleted.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_created_by_app BOOLEAN DEFAULT FALSE;

-- Backfill: mark all existing synced events as NOT created by app (safe default)
UPDATE tasks SET google_event_created_by_app = FALSE WHERE google_event_id IS NOT NULL AND google_event_created_by_app IS NULL;
