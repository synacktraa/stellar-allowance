import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Server-only Supabase client.
 *
 * Uses the service role key, which bypasses row level security. Every table has RLS enabled
 * with no policies, so this is the only way in — and it must never reach the browser. Import
 * this from route handlers and server components only.
 */

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
