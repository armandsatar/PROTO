// End-to-end Step 4 smoke test: chains a real Step 2 run (mock Etsy + live Groq) into
// a manual title selection (Step 3's state, no dedicated function exists yet — set
// directly per phase1-requirements.md §1.4), then exercises Step 4's full trigger table
// from section 1.6: generate (first entry) -> confirm (accept) -> changeFormat ->
// confirm (override) -> changeFormat -> generate (reconsider) -> confirm, against live
// Groq and local Supabase through real RLS. Run with: npm run smoke:format
import { runResearch } from '../lib/research/runResearch';
import {
  generateFormatRecommendation,
  confirmFormatRecommendation,
  changeFormat,
  getActiveFormatRecommendation,
  type FormatRecommendationRow,
} from '../lib/format/runFormatRecommendation';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

function printRecommendation(label: string, row: FormatRecommendationRow) {
  console.log(`\n--- ${label} ---`);
  console.log(`  id: ${row.id}`);
  console.log(`  recommended: ${row.recommended_format} / ${row.recommended_delivery_mode ?? 'n/a'} (${row.confidence})`);
  console.log(`  reasoning: ${row.reasoning_summary}`);
  console.log(`  confirmed: ${row.confirmed_format ?? '(not yet)'} / ${row.confirmed_delivery_mode ?? 'n/a'}`);
  console.log(`  is_override: ${row.is_override}  status: ${row.recommendation_status}`);
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('format');
  console.log(`User: ${fixture.userId}  Workspace: ${fixture.workspaceId}  Project: ${fixture.projectId}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale =
    'Freelancers want to log irregular income daily and see rolling totals — this needs to be something they update constantly, not read once.';
  await createTitleIdea(fixture, originalTitle, rationale);

  console.log('\n=== Running Step 2 research (mock Etsy + live Groq) to get real candidates ===');
  const researchResult = await runResearch({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    originalTitle,
    rationale,
  });
  const candidates = researchResult.candidates as unknown as CandidateRow[];
  const original = candidates.find((c) => c.is_original);
  if (!original) throw new Error('No original candidate found in research result');
  console.log(`Selecting the original candidate: "${original.candidate_text}"`);

  console.log('\n=== Selecting the title (Step 3 state — no dedicated function yet, set directly) ===');
  const { error: selErr } = await fixture.supabase.from('title_selections').insert({
    project_id: fixture.projectId,
    workspace_id: fixture.workspaceId,
    research_run_id: researchResult.runId,
    selected_candidate_id: original.id,
    selected_by: fixture.userId,
  });
  if (selErr) throw new Error(`Title selection insert failed: ${selErr.message}`);
  const { error: lockErr } = await fixture.supabase
    .from('projects')
    .update({ selected_candidate_id: original.id, status: 'title_selected' })
    .eq('id', fixture.projectId);
  if (lockErr) throw new Error(`Title lock failed: ${lockErr.message}`);
  console.log('Title locked, project.status = title_selected');

  // ---------- Step 4: first entry (auto-fire) ----------
  console.log('\n=== STEP 4: generateFormatRecommendation (first entry / auto-fire) ===');
  const gen1 = await generateFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
  });
  printRecommendation('Generated (1st)', gen1);
  if (gen1.recommendation_status !== 'active') throw new Error('Expected first generation to be active');

  // ---------- Confirm as-is (accept, no override) ----------
  console.log('\n=== confirmFormatRecommendation (accept as recommended) ===');
  const confirm1 = await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: gen1.recommended_format,
    confirmedDeliveryMode: gen1.recommended_delivery_mode,
  });
  printRecommendation('Confirmed (accept)', confirm1);
  if (confirm1.is_override !== false) throw new Error(`Expected is_override=false, got ${confirm1.is_override}`);

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  console.log(`  projects.status = ${proj1?.status}`);
  if (proj1?.status !== 'format_selected') throw new Error(`Expected status='format_selected', got '${proj1?.status}'`);

  // ---------- Change Format -> new unconfirmed active row, old one superseded ----------
  console.log('\n=== changeFormat (post-confirm) ===');
  const changed1 = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printRecommendation('After Change Format', changed1);
  if (changed1.confirmed_at !== null) throw new Error('Expected the new row after Change Format to be unconfirmed');
  if (changed1.id === confirm1.id) throw new Error('Change Format should have created a new row, not reused the old one');

  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  console.log(`  projects.status = ${proj2?.status}`);
  if (proj2?.status !== 'format_recommending') throw new Error(`Expected status='format_recommending', got '${proj2?.status}'`);

  // ---------- Confirm with an override this time ----------
  // Toggle between tracker/workbook regardless of what was recommended — both always
  // take a delivery mode, so no ebook edge case to handle here (that's already covered
  // live by smoke-test-format-ai.ts and unit-tested in formatGuardrail.test.ts).
  const overrideFormat = changed1.recommended_format === 'workbook' ? 'tracker' : 'workbook';
  const overrideDeliveryMode = 'fillable';
  console.log(`\n=== confirmFormatRecommendation (override to ${overrideFormat}/${overrideDeliveryMode}) ===`);
  const confirm2 = await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: overrideFormat,
    confirmedDeliveryMode: overrideDeliveryMode,
  });
  printRecommendation('Confirmed (override)', confirm2);
  if (confirm2.is_override !== true) throw new Error(`Expected is_override=true, got ${confirm2.is_override}`);

  // ---------- Change Format again, then Reconsider (fresh AI call) ----------
  console.log('\n=== changeFormat again, then generateFormatRecommendation (reconsider) ===');
  const changed2 = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printRecommendation('After 2nd Change Format', changed2);

  const reconsidered = await generateFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
  });
  printRecommendation('Reconsidered (fresh AI call)', reconsidered);
  if (reconsidered.id === changed2.id) throw new Error('Reconsider should have superseded the pre-reconsider row and created a new one');

  const finalConfirm = await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: reconsidered.recommended_format,
    confirmedDeliveryMode: reconsidered.recommended_delivery_mode,
  });
  printRecommendation('Final confirm', finalConfirm);

  // ---------- Verify final state + full row history ----------
  console.log('\n=== Verifying final state ===');
  const active = await getActiveFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId });
  if (!active || active.id !== finalConfirm.id) throw new Error('getActiveFormatRecommendation did not return the final confirmed row');
  console.log('getActiveFormatRecommendation() correctly returns the final confirmed row.');

  const { data: allRows, error: historyErr } = await fixture.supabase
    .from('format_recommendations')
    .select('id, recommendation_status, superseded_reason, confirmed_at')
    .eq('project_id', fixture.projectId)
    .order('created_at', { ascending: true });
  if (historyErr || !allRows) throw new Error(`Failed to fetch history: ${historyErr?.message}`);

  console.log(`\nFull row history (${allRows.length} rows):`);
  for (const [i, r] of allRows.entries()) {
    console.log(`  ${i + 1}. ${r.recommendation_status.padEnd(10)} superseded_reason=${r.superseded_reason ?? '-'}  confirmed=${!!r.confirmed_at}`);
  }
  const activeCount = allRows.filter((r) => r.recommendation_status === 'active').length;
  if (activeCount !== 1) throw new Error(`Expected exactly 1 active row, found ${activeCount}`);
  if (allRows.length !== 4) throw new Error(`Expected 4 rows total (generate, changeFormat x2, reconsider), got ${allRows.length}`);

  const { data: finalProject } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (finalProject?.status !== 'format_selected') throw new Error(`Expected final status='format_selected', got '${finalProject?.status}'`);

  console.log(
    '\nSmoke test passed: full Step 4 pipeline ran end-to-end through real RLS — generate, confirm, changeFormat, override, reconsider all verified live, with correct row history.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
