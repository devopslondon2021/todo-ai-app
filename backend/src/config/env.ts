import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from monorepo root (config/ -> src/ -> backend/ -> root)
const rootEnv = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnv });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const envSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.2'),
  AI_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default('http://localhost:3000/auth/google/callback'),
  WHATSAPP_BOT_URL: z.string().default('http://localhost:3002'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Warn about missing credentials at startup
const missing: string[] = [];
if (!env.SUPABASE_URL) missing.push('SUPABASE_URL');
if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (!env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
if (missing.length > 0) {
  console.warn(`⚠️  Missing env vars: ${missing.join(', ')} — API routes requiring these will return 503`);
}
