import { createClient } from '@supabase/supabase-js';

/**
 * Hardcoded IDs for v1 (single-user, no auth). These must match
 * the rows created by scripts/seed-dev-user.ts.
 */
export const HARDCODED_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
export const HARDCODED_USER_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Creates a Supabase client using the service-role key, bypassing RLS.
 * Used in API routes where auth is skipped for v1.
 */
export function createServerSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  }
  return createClient(url, serviceKey);
}
