-- Migration v9: Baileys auth state storage
-- Stores WhatsApp session credentials in Supabase instead of filesystem.
-- Required for ephemeral containers (Railway, Fly.io, etc.)

CREATE TABLE IF NOT EXISTS baileys_auth (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
