-- Migration v4: Add sort_order column for drag-and-drop reordering
-- Run this in the Supabase SQL Editor

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(user_id, sort_order);

-- Backfill existing tasks: assign sort_order based on creation date (newest first)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM tasks
)
UPDATE tasks SET sort_order = ordered.rn FROM ordered WHERE tasks.id = ordered.id;
