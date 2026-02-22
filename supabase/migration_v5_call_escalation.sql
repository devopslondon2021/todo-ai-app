-- Migration V5: Call escalation for reminders
-- Adds fields to track whether a reminder was acknowledged and whether a call was made.
-- Run this in the Supabase SQL Editor.

ALTER TABLE reminders ADD COLUMN call_escalated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reminders ADD COLUMN acknowledged BOOLEAN NOT NULL DEFAULT FALSE;
