-- Migration V3: API Keys for Siri Shortcuts integration
-- Run this in Supabase SQL Editor

-- 1. Helper function to generate API keys
CREATE OR REPLACE FUNCTION generate_api_key()
RETURNS TEXT AS $$
BEGIN
  RETURN 'todoai_' || encode(gen_random_bytes(24), 'hex');
END;
$$ LANGUAGE plpgsql;

-- 2. Add api_key column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key TEXT UNIQUE;

-- 3. Backfill existing users with API keys
UPDATE users SET api_key = generate_api_key() WHERE api_key IS NULL;

-- 4. Set default for new users
ALTER TABLE users ALTER COLUMN api_key SET DEFAULT generate_api_key();
