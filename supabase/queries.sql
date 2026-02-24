-- =============================================================
-- Todo AI — Supabase Query Reference
-- Copy-paste these into the Supabase SQL Editor as needed.
-- =============================================================


-- #############################################################
-- USERS
-- #############################################################

-- All users
SELECT * FROM users ORDER BY created_at DESC;

-- Find user by WhatsApp JID
SELECT * FROM users WHERE whatsapp_jid = '919876543210@s.whatsapp.net';

-- Find user by phone number
SELECT * FROM users WHERE phone_number = '+919876543210';

-- Find user by API key (Siri Shortcuts auth)
SELECT * FROM users WHERE api_key = 'todoai_...';

-- User count
SELECT COUNT(*) FROM users;

-- Users with Google Calendar connected
SELECT id, name, phone_number, google_calendar_connected
FROM users WHERE google_calendar_connected = TRUE;

-- Users with Google OAuth credentials stored
SELECT id, name, phone_number,
  google_client_id IS NOT NULL AS has_client_id,
  google_refresh_token IS NOT NULL AS has_refresh_token,
  google_token_expiry
FROM users WHERE google_refresh_token IS NOT NULL;


-- #############################################################
-- TASKS
-- #############################################################

-- All tasks for a user (most recent first)
SELECT t.*, c.name AS category_name
FROM tasks t
LEFT JOIN categories c ON t.category_id = c.id
WHERE t.user_id = '<USER_UUID>'
ORDER BY t.created_at DESC;

-- Pending tasks for a user
SELECT id, title, priority, due_date, sort_order
FROM tasks
WHERE user_id = '<USER_UUID>' AND status = 'pending'
ORDER BY sort_order, created_at DESC;

-- Overdue tasks (due date passed, still not completed)
SELECT t.id, t.title, t.due_date, t.priority, u.name AS user_name, u.phone_number
FROM tasks t
JOIN users u ON t.user_id = u.id
WHERE t.status != 'completed' AND t.due_date < NOW()
ORDER BY t.due_date;

-- Tasks due today
SELECT id, title, priority, due_date
FROM tasks
WHERE status != 'completed'
  AND due_date::date = CURRENT_DATE
ORDER BY due_date;

-- Task counts by status (per user)
SELECT u.name, u.phone_number,
  COUNT(*) FILTER (WHERE t.status = 'pending') AS pending,
  COUNT(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
  COUNT(*) FILTER (WHERE t.status = 'completed') AS completed
FROM users u
LEFT JOIN tasks t ON t.user_id = u.id
GROUP BY u.id, u.name, u.phone_number
ORDER BY u.name;

-- Task counts by priority
SELECT priority, COUNT(*) FROM tasks GROUP BY priority;

-- Recurring tasks
SELECT id, title, recurrence_rule, due_date
FROM tasks
WHERE is_recurring = TRUE
ORDER BY created_at DESC;

-- Tasks synced from Google Calendar
SELECT id, title, google_event_id, due_date, status
FROM tasks
WHERE google_event_id IS NOT NULL
ORDER BY due_date;

-- Recently completed tasks (last 7 days)
SELECT id, title, updated_at
FROM tasks
WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '7 days'
ORDER BY updated_at DESC;


-- #############################################################
-- CATEGORIES
-- #############################################################

-- All categories for a user
SELECT * FROM categories WHERE user_id = '<USER_UUID>' ORDER BY name;

-- Categories with task counts
SELECT c.id, c.name, c.color, c.icon, COUNT(t.id) AS task_count
FROM categories c
LEFT JOIN tasks t ON t.category_id = c.id
WHERE c.user_id = '<USER_UUID>'
GROUP BY c.id
ORDER BY task_count DESC;


-- #############################################################
-- REMINDERS
-- #############################################################

-- Pending reminders (not yet sent)
SELECT r.id, r.reminder_time, t.title, u.phone_number, u.whatsapp_jid
FROM reminders r
JOIN tasks t ON r.task_id = t.id
JOIN users u ON r.user_id = u.id
WHERE r.is_sent = FALSE
ORDER BY r.reminder_time;

-- Reminders due in the next hour
SELECT r.id, r.reminder_time, t.title, u.phone_number
FROM reminders r
JOIN tasks t ON r.task_id = t.id
JOIN users u ON r.user_id = u.id
WHERE r.is_sent = FALSE AND r.reminder_time <= NOW() + INTERVAL '1 hour'
ORDER BY r.reminder_time;

-- Sent reminders (most recent)
SELECT r.id, r.reminder_time, r.sent_at, r.call_escalated, r.acknowledged, t.title
FROM reminders r
JOIN tasks t ON r.task_id = t.id
WHERE r.is_sent = TRUE
ORDER BY r.sent_at DESC
LIMIT 20;

-- Unacknowledged reminders that escalated to calls
SELECT r.id, r.reminder_time, r.sent_at, t.title, u.phone_number
FROM reminders r
JOIN tasks t ON r.task_id = t.id
JOIN users u ON r.user_id = u.id
WHERE r.call_escalated = TRUE AND r.acknowledged = FALSE
ORDER BY r.sent_at DESC;


-- #############################################################
-- WHATSAPP / BAILEYS AUTH
-- #############################################################

-- Check if bot has stored credentials (should have a "creds" row)
SELECT key, updated_at FROM baileys_auth WHERE key = 'creds';

-- Total auth keys stored (creds + signal keys)
SELECT COUNT(*) AS total_keys FROM baileys_auth;

-- Auth keys by type (pre-key, session, sender-key, etc.)
SELECT
  split_part(key, '-', 1) AS key_type,
  COUNT(*) AS count
FROM baileys_auth
GROUP BY key_type
ORDER BY count DESC;

-- Most recently updated auth keys
SELECT key, updated_at FROM baileys_auth ORDER BY updated_at DESC LIMIT 10;

-- Nuke all auth state (forces QR re-scan on next bot start)
-- DELETE FROM baileys_auth;


-- #############################################################
-- ADMIN / DIAGNOSTICS
-- #############################################################

-- Table sizes (row counts)
SELECT 'users' AS t, COUNT(*) FROM users
UNION ALL SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL SELECT 'categories', COUNT(*) FROM categories
UNION ALL SELECT 'reminders', COUNT(*) FROM reminders
UNION ALL SELECT 'baileys_auth', COUNT(*) FROM baileys_auth;

-- Database size
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;

-- Table sizes on disk
SELECT relname AS table_name, pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- Active Realtime subscriptions (tables publishing changes)
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Check RLS policies
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
