import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    // Return a dummy client that won't crash during build
    // Real-time features just won't work until env vars are set
    return createClient("https://placeholder.supabase.co", "placeholder");
  }

  client = createClient(url, key);
  return client;
}
