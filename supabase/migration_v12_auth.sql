-- Migration v12: Auth + Multi-User Support
-- Run after migration_v11_calendar_watch.sql

-- Add auth_id and email to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_id TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN DEFAULT FALSE NOT NULL;

-- Add unique constraint on auth_id (only one user per Supabase auth identity)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_id_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_auth_id_key UNIQUE (auth_id);
  END IF;
END $$;

-- Add user_id column to baileys_auth
ALTER TABLE baileys_auth
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Migrate existing baileys_auth rows: assign to oldest existing user (if any)
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM users ORDER BY created_at ASC LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    UPDATE baileys_auth SET user_id = v_user_id WHERE user_id IS NULL;
  END IF;
END $$;

-- Drop old PK and create composite PK (user_id, key)
-- First drop the old primary key constraint
DO $$
BEGIN
  -- Drop existing primary key if it's just on 'key'
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'baileys_auth_pkey' AND conrelid = 'baileys_auth'::regclass
  ) THEN
    -- Check if current PK only covers 'key' column
    IF (
      SELECT COUNT(*) FROM pg_attribute a
      JOIN pg_index i ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      JOIN pg_constraint c ON c.conindid = i.indexrelid
      WHERE c.conname = 'baileys_auth_pkey'
        AND c.conrelid = 'baileys_auth'::regclass
    ) = 1 THEN
      ALTER TABLE baileys_auth DROP CONSTRAINT baileys_auth_pkey;
      -- Make user_id NOT NULL before adding composite PK
      -- (rows with null user_id were handled above)
      -- If no users exist, user_id may still be null; only add PK if all rows have user_id
      IF NOT EXISTS (SELECT 1 FROM baileys_auth WHERE user_id IS NULL) THEN
        ALTER TABLE baileys_auth ADD PRIMARY KEY (user_id, key);
      ELSE
        -- No existing data, just add the composite PK
        ALTER TABLE baileys_auth ADD PRIMARY KEY (user_id, key);
      END IF;
    END IF;
  ELSE
    -- No existing PK, just add composite PK
    ALTER TABLE baileys_auth ADD PRIMARY KEY (user_id, key);
  END IF;
END $$;
