// Shared bootstrap for live smoke tests: a real Supabase Auth user (via local GoTrue),
// a real workspace/project through actual RLS — no service-role bypass, same access
// path the real app uses. Extracted here so scripts/smoke-test-research.ts and
// scripts/smoke-test-format.ts don't duplicate it.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface TestFixture {
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
  projectId: string;
}

export async function bootstrapTestFixture(label: string): Promise<TestFixture> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY must be set in .env (see `supabase status` output)');
  }

  const authClient = createClient(url, anonKey);
  const email = `smoke-test-${label}-${Date.now()}@test.local`;
  const password = 'SmokeTest123!';

  const { data: signUpData, error: signUpErr } = await authClient.auth.signUp({ email, password });
  if (signUpErr) throw new Error(`Sign-up failed: ${signUpErr.message}`);

  let accessToken = signUpData.session?.access_token;
  if (!accessToken) {
    const { data: signInData, error: signInErr } = await authClient.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) throw new Error(`Sign-in failed: ${signInErr?.message}`);
    accessToken = signInData.session.access_token;
  }
  const userId = signUpData.user?.id;
  if (!userId) throw new Error('Sign-up did not return a user id');

  // Scoped to this user's token — RLS applies exactly as it would for a real request.
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .insert({ owner_user_id: userId, name: `${label} Workspace` })
    .select()
    .single();
  if (wsErr || !workspace) throw new Error(`Workspace creation failed: ${wsErr?.message}`);

  const { error: memberErr } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, user_id: userId, role: 'owner' });
  if (memberErr) throw new Error(`Membership creation failed: ${memberErr.message}`);

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({ workspace_id: workspace.id, created_by: userId, status: 'draft' })
    .select()
    .single();
  if (projErr || !project) throw new Error(`Project creation failed: ${projErr?.message}`);

  return { supabase, userId, workspaceId: workspace.id, projectId: project.id };
}

export async function createTitleIdea(fixture: TestFixture, originalTitle: string, rationale: string): Promise<void> {
  const { error } = await fixture.supabase.from('title_ideas').insert({
    project_id: fixture.projectId,
    workspace_id: fixture.workspaceId,
    original_title: originalTitle,
    rationale,
    created_by: fixture.userId,
  });
  if (error) throw new Error(`Title idea creation failed: ${error.message}`);
}
