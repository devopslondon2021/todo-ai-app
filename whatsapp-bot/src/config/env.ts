import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from monorepo root or current dir (Railway injects env vars directly)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3.2',
  AI_PROVIDER: (process.env.AI_PROVIDER || 'openai') as 'openai' | 'ollama',

  // Twilio (optional — enables call escalation for reminders)
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
  CALL_ESCALATION_DELAY_MIN: parseInt(process.env.CALL_ESCALATION_DELAY_MIN || '5', 10),
  BACKEND_URL: (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/+$/, ''),
  BOT_API_PORT: parseInt(process.env.PORT || process.env.BOT_API_PORT || '3002', 10),
};
