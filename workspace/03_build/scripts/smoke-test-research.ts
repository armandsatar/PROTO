// End-to-end Step 2 smoke test: real Supabase Auth user (via local GoTrue), real
// workspace/project through RLS (no service-role bypass — this exercises the exact
// same access path the real app will use), mock Etsy data, live Groq calls, real
// persistence. Run with: npm run smoke:research (requires `supabase start` running
// and GROQ_API_KEY set in .env).
import { createClient } from '@supabase/supabase-js';
import { runResearch } from '../lib/research/runResearch';

interface CandidateRow {
  display_order: number;
  is_original: boolean;
  generation_axis: string;
  candidate_text: string;
  demand_score: number;
  demand_color: string;
  competition_score: number;
  competition_color: string;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY must be set in .env (see `supabase status` output)');
  }

  const authClient = createClient(url, anonKey);
  const email = `smoke-test-${Date.now()}@test.local`;
  const password = 'SmokeTest123!';

  console.log('=== Signing up test user (local GoTrue) ===');
  const { data: signUpData, error: signUpErr } = await authClient.auth.signUp({ email, password });
  if (signUpErr) throw new Error(`Sign-up failed: ${signUpErr.message}`);

  let accessToken = signUpData.session?.access_token;
  if (!accessToken) {
    console.log('No session from signUp — signing in explicitly...');
    const { data: signInData, error: signInErr } = await authClient.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) throw new Error(`Sign-in failed: ${signInErr?.message}`);
    accessToken = signInData.session.access_token;
  }
  const userId = signUpData.user?.id;
  if (!userId) throw new Error('Sign-up did not return a user id');
  console.log(`Test user created: ${userId}`);

  // Scoped to this user's token — RLS applies exactly as it would for a real request,
  // not bypassed via a service-role key (lib/db/client.ts's whole point).
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  console.log('\n=== Creating workspace + membership (through RLS) ===');
  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .insert({ owner_user_id: userId, name: 'Smoke Test Workspace' })
    .select()
    .single();
  if (wsErr || !workspace) throw new Error(`Workspace creation failed: ${wsErr?.message}`);

  const { error: memberErr } = await supabase
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, user_id: userId, role: 'owner' });
  if (memberErr) throw new Error(`Membership creation failed: ${memberErr.message}`);
  console.log(`Workspace created: ${workspace.id}`);

  console.log('\n=== Creating project + title idea ===');
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .insert({ workspace_id: workspace.id, created_by: userId, status: 'draft' })
    .select()
    .single();
  if (projErr || !project) throw new Error(`Project creation failed: ${projErr?.message}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale =
    'Seeing rising interest in freelancer-specific finance tools, and existing Etsy budget templates are generic — not tailored to irregular freelance income.';

  const { error: ideaErr } = await supabase.from('title_ideas').insert({
    project_id: project.id,
    workspace_id: workspace.id,
    original_title: originalTitle,
    rationale,
    created_by: userId,
  });
  if (ideaErr) throw new Error(`Title idea creation failed: ${ideaErr.message}`);
  console.log(`Project created: ${project.id}`);

  console.log('\n=== Running research (mock Etsy + live Groq) ===');
  const result = await runResearch({
    supabase,
    projectId: project.id,
    workspaceId: workspace.id,
    originalTitle,
    rationale,
  });

  const candidates = result.candidates as unknown as CandidateRow[];
  console.log(`\nResearch run ${result.runId} produced ${candidates.length} candidates:\n`);
  for (const c of [...candidates].sort((a, b) => a.display_order - b.display_order)) {
    const tag = c.is_original ? '[original]' : `[${c.generation_axis}]`;
    console.log(
      `${c.display_order}. ${tag.padEnd(20)} "${c.candidate_text}"` +
        `  Demand ${c.demand_score}/10 (${c.demand_color})  Competition ${c.competition_score}/10 (${c.competition_color})`,
    );
  }

  console.log('\n=== Verifying decision-7 invariant: exactly 4 candidates, exactly 1 original ===');
  if (candidates.length !== 4) throw new Error(`Expected 4 candidates, got ${candidates.length}`);
  const originalCount = candidates.filter((c) => c.is_original).length;
  if (originalCount !== 1) throw new Error(`Expected exactly 1 original candidate, got ${originalCount}`);
  console.log('OK: exactly 4 candidates, exactly 1 flagged is_original.');

  console.log('\n=== Verifying research_runs row reflects completion ===');
  const { data: runRow, error: runFetchErr } = await supabase
    .from('research_runs')
    .select('status, completed_at')
    .eq('id', result.runId)
    .single();
  if (runFetchErr || !runRow) throw new Error(`Could not fetch research_run: ${runFetchErr?.message}`);
  console.log('research_runs row:', runRow);
  if (runRow.status !== 'completed') throw new Error(`Expected status='completed', got '${runRow.status}'`);

  console.log('\nSmoke test passed: full Step 2 pipeline ran end-to-end through real RLS.');
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
