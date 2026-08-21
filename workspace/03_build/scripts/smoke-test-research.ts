// End-to-end Step 2 smoke test: real Supabase Auth user (via local GoTrue), real
// workspace/project through RLS (no service-role bypass — this exercises the exact
// same access path the real app will use), mock Etsy data, live Groq calls, real
// persistence. Run with: npm run smoke:research (requires `supabase start` running
// and GROQ_API_KEY set in .env).
import { runResearch } from '../lib/research/runResearch';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

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
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('research');
  console.log(`User: ${fixture.userId}  Workspace: ${fixture.workspaceId}  Project: ${fixture.projectId}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale =
    'Seeing rising interest in freelancer-specific finance tools, and existing Etsy budget templates are generic — not tailored to irregular freelance income.';
  await createTitleIdea(fixture, originalTitle, rationale);

  console.log('\n=== Running research (mock Etsy + live Groq) ===');
  const result = await runResearch({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
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
  const { data: runRow, error: runFetchErr } = await fixture.supabase
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
