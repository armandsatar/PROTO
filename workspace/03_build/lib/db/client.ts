import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Constructs a Supabase client scoped to a specific user's access token, so RLS applies
 * naturally as that user. Deliberately never constructs a service-role client here —
 * spec §2's architecture principle is RLS as the access-control mechanism, not
 * hand-written authorization checks in app code, so backend code should act as the
 * user it's working on behalf of rather than bypassing RLS and re-deriving the same
 * checks manually.
 */
export function createSupabaseClientForUser(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set');
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
