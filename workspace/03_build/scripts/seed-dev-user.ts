/**
 * Seed script for local development: creates a Supabase auth user, workspace,
 * and workspace_member row with the hardcoded IDs from lib/db/serverClient.ts.
 * Idempotent — safe to run multiple times.
 *
 * Run with: npx tsx --env-file=.env scripts/seed-dev-user.ts
 */
import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const DEV_EMAIL = 'dev@proto.local';
const DEV_PASSWORD = 'devpassword123';

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  }

  const supabase = createClient(url, serviceKey);

  // 1. Create auth user (or skip if exists)
  console.log('Creating auth user...');
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.id === USER_ID);

  if (existing) {
    console.log(`  Auth user already exists: ${existing.email}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEV_EMAIL,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Dev User' },
      id: USER_ID,
    });
    if (error) throw new Error(`Failed to create auth user: ${error.message}`);
    console.log(`  Created auth user: ${data.user.email} (${data.user.id})`);
  }

  // 2. Create workspace (or skip if exists)
  console.log('Creating workspace...');
  const { data: ws } = await supabase
    .from('workspaces')
    .select('id')
    .eq('id', WORKSPACE_ID)
    .single();

  if (ws) {
    console.log(`  Workspace already exists: ${WORKSPACE_ID}`);
  } else {
    const { error } = await supabase.from('workspaces').insert({
      id: WORKSPACE_ID,
      owner_user_id: USER_ID,
      name: 'Dev Workspace',
    });
    if (error) throw new Error(`Failed to create workspace: ${error.message}`);
    console.log(`  Created workspace: ${WORKSPACE_ID}`);
  }

  // 3. Create workspace_member (or skip if exists)
  console.log('Creating workspace member...');
  const { data: member } = await supabase
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('user_id', USER_ID)
    .single();

  if (member) {
    console.log(`  Workspace member already exists.`);
  } else {
    const { error } = await supabase.from('workspace_members').insert({
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      role: 'owner',
    });
    if (error) throw new Error(`Failed to create workspace member: ${error.message}`);
    console.log(`  Created workspace member.`);
  }

  console.log('\nDone. Hardcoded IDs:');
  console.log(`  WORKSPACE_ID: ${WORKSPACE_ID}`);
  console.log(`  USER_ID:      ${USER_ID}`);
}

main().catch((err) => {
  console.error('Seed script FAILED:', err);
  process.exit(1);
});
