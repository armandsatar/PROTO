// End-to-end Step 5 smoke test: chains real Step 2 + Step 4 runs into Step 5's full
// trigger table (generate -> confirm -> change -> override -> reconsider -> confirm),
// then proves the genuinely new behavior vs Step 4: a format-only change (title
// unchanged) invalidates Step 5's recommendation while Step 4's own state stays
// intact — decision 13, live, not just unit-tested. Run with: npm run smoke:leadmagnet
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation, changeFormat } from '../lib/format/runFormatRecommendation';
import {
  generateLeadMagnetRecommendation,
  confirmLeadMagnetRecommendation,
  changeLeadMagnetRecommendation,
  getActiveLeadMagnetRecommendation,
  type LeadMagnetRecommendationRow,
} from '../lib/leadmagnet/runLeadMagnetCheck';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

function printLM(label: string, row: LeadMagnetRecommendationRow) {
  console.log(`\n--- ${label} ---`);
  console.log(`  id: ${row.id}`);
  console.log(`  recommended: suitable=${row.recommended_suitable} type=${row.recommended_type ?? 'n/a'} (${row.confidence})`);
  console.log(`  reasoning: ${row.reasoning_summary}`);
  console.log(`  confirmed: suitable=${row.confirmed_suitable ?? '(not yet)'} type=${row.confirmed_type ?? 'n/a'}`);
  console.log(`  is_override: ${row.is_override}  status: ${row.recommendation_status}  superseded_reason: ${row.superseded_reason ?? '-'}`);
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('leadmagnet');
  console.log(`User: ${fixture.userId}  Workspace: ${fixture.workspaceId}  Project: ${fixture.projectId}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale = 'Freelancers want to log irregular income daily — this needs ongoing use, not a one-time read.';
  await createTitleIdea(fixture, originalTitle, rationale);

  console.log('\n=== Step 2: research + select title ===');
  const researchResult = await runResearch({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    originalTitle,
    rationale,
  });
  const candidates = researchResult.candidates as unknown as CandidateRow[];
  const original = candidates.find((c) => c.is_original);
  if (!original) throw new Error('No original candidate found');

  await fixture.supabase.from('title_selections').insert({
    project_id: fixture.projectId,
    workspace_id: fixture.workspaceId,
    research_run_id: researchResult.runId,
    selected_candidate_id: original.id,
    selected_by: fixture.userId,
  });
  await fixture.supabase.from('projects').update({ selected_candidate_id: original.id, status: 'title_selected' }).eq('id', fixture.projectId);
  console.log(`Title selected: "${original.candidate_text}"`);

  console.log('\n=== Step 4: generate + confirm format ===');
  const formatGen = await generateFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  const formatConfirm1 = await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: formatGen.recommended_format,
    confirmedDeliveryMode: formatGen.recommended_delivery_mode,
  });
  console.log(`Format confirmed: ${formatConfirm1.confirmed_format}/${formatConfirm1.confirmed_delivery_mode ?? 'n/a'}`);

  // ---------- Step 5: first entry (auto-fire) ----------
  console.log('\n=== STEP 5: generateLeadMagnetRecommendation (first entry / auto-fire) ===');
  const gen1 = await generateLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printLM('Generated (1st)', gen1);

  // ---------- Confirm as-is ----------
  console.log('\n=== confirmLeadMagnetRecommendation (accept as recommended) ===');
  const confirm1 = await confirmLeadMagnetRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedSuitable: gen1.recommended_suitable,
    confirmedType: gen1.recommended_type,
  });
  printLM('Confirmed (accept)', confirm1);
  if (confirm1.is_override !== false) throw new Error(`Expected is_override=false, got ${confirm1.is_override}`);

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (proj1?.status !== 'lead_magnet_reviewed') throw new Error(`Expected status='lead_magnet_reviewed', got '${proj1?.status}'`);
  console.log(`  projects.status = ${proj1?.status}`);

  // ---------- Change -> new unconfirmed row ----------
  console.log('\n=== changeLeadMagnetRecommendation (post-confirm) ===');
  const changed1 = await changeLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printLM('After Change', changed1);
  if (changed1.confirmed_at !== null) throw new Error('Expected the new row after Change to be unconfirmed');

  // ---------- Confirm with an override (flip suitability) ----------
  const overrideSuitable = !changed1.recommended_suitable;
  const overrideType = overrideSuitable ? 'standalone_funnel' : null;
  console.log(`\n=== confirmLeadMagnetRecommendation (override: suitable=${overrideSuitable}) ===`);
  const confirm2 = await confirmLeadMagnetRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedSuitable: overrideSuitable,
    confirmedType: overrideType,
  });
  printLM('Confirmed (override)', confirm2);
  if (confirm2.is_override !== true) throw new Error(`Expected is_override=true, got ${confirm2.is_override}`);

  // ---------- Change again, then Reconsider ----------
  console.log('\n=== changeLeadMagnetRecommendation again, then generateLeadMagnetRecommendation (reconsider) ===');
  const changed2 = await changeLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  const reconsidered = await generateLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printLM('Reconsidered (fresh AI call)', reconsidered);
  if (reconsidered.id === changed2.id) throw new Error('Reconsider should have created a new row');

  const finalLmConfirm = await confirmLeadMagnetRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedSuitable: reconsidered.recommended_suitable,
    confirmedType: reconsidered.recommended_type,
  });
  printLM('Final confirm', finalLmConfirm);

  console.log('\n=== Verifying Step 5 row history before the format-change test ===');
  const { data: lmHistoryBefore } = await fixture.supabase
    .from('lead_magnet_recommendations')
    .select('recommendation_status, superseded_reason')
    .eq('project_id', fixture.projectId)
    .order('created_at', { ascending: true });
  console.log(`  ${lmHistoryBefore?.length} rows: ${lmHistoryBefore?.map((r) => `${r.recommendation_status}${r.superseded_reason ? `(${r.superseded_reason})` : ''}`).join(', ')}`);
  if (lmHistoryBefore?.length !== 4) throw new Error(`Expected 4 rows so far, got ${lmHistoryBefore?.length}`);

  // ============================================================
  // THE NEW PROOF: format-only change invalidates Step 5, Step 4 stays intact
  // ============================================================
  console.log('\n=== NEW PROOF: changing Step 4 format (title unchanged) should invalidate Step 5 ===');
  const changedFormat = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  const newFormat = changedFormat.recommended_format === 'workbook' ? 'tracker' : 'workbook';
  const formatConfirm2 = await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: newFormat,
    confirmedDeliveryMode: 'fillable',
  });
  console.log(`Format re-confirmed as: ${formatConfirm2.confirmed_format}/${formatConfirm2.confirmed_delivery_mode} (was ${formatConfirm1.confirmed_format}/${formatConfirm1.confirmed_delivery_mode})`);
  if (formatConfirm2.id === formatConfirm1.id) throw new Error('Expected a new format_recommendations row after Change Format + re-confirm');

  console.log('\nChecking getActiveLeadMagnetRecommendation() WITHOUT calling generate — lazy staleness should fire on this read alone...');
  const activeAfterFormatChange = await getActiveLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId });
  if (activeAfterFormatChange !== null) {
    throw new Error(`Expected null (invalidated) after format change, got an active row: ${activeAfterFormatChange.id}`);
  }
  console.log('OK: getActiveLeadMagnetRecommendation() returned null — Step 5 correctly self-invalidated on read alone, no explicit trigger needed.');

  const { data: staleRow } = await fixture.supabase
    .from('lead_magnet_recommendations')
    .select('id, recommendation_status, superseded_reason')
    .eq('id', finalLmConfirm.id)
    .single();
  console.log(`Previously-active row ${staleRow?.id}: status=${staleRow?.recommendation_status} superseded_reason=${staleRow?.superseded_reason}`);
  if (staleRow?.recommendation_status !== 'superseded' || staleRow?.superseded_reason !== 'format_changed') {
    throw new Error(`Expected superseded/format_changed, got ${staleRow?.recommendation_status}/${staleRow?.superseded_reason}`);
  }
  console.log("OK: decision 13 proven live — format-only change (title unchanged) correctly invalidated Step 5's recommendation.");

  console.log("\nVerifying Step 4's own state stayed intact (decoupling — Step 5 invalidating itself never touches format_recommendations)...");
  const { data: step4Check } = await fixture.supabase
    .from('format_recommendations')
    .select('id, recommendation_status, confirmed_format')
    .eq('id', formatConfirm2.id)
    .single();
  if (step4Check?.recommendation_status !== 'active' || step4Check?.confirmed_format !== newFormat) {
    throw new Error(`Step 4's state was unexpectedly affected: ${JSON.stringify(step4Check)}`);
  }
  console.log(`OK: format_recommendations row ${step4Check.id} is still active/confirmed=${step4Check.confirmed_format}, untouched by Step 5's invalidation.`);

  // ---------- Regenerate Step 5 fresh against the new format, confirm, final check ----------
  console.log('\n=== Regenerating Step 5 fresh against the new format ===');
  const gen2 = await generateLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printLM('Fresh generation after format change', gen2);
  const finalConfirm2 = await confirmLeadMagnetRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedSuitable: gen2.recommended_suitable,
    confirmedType: gen2.recommended_type,
  });

  console.log('\n=== Final full row history ===');
  const { data: finalHistory } = await fixture.supabase
    .from('lead_magnet_recommendations')
    .select('recommendation_status, superseded_reason, confirmed_at')
    .eq('project_id', fixture.projectId)
    .order('created_at', { ascending: true });
  for (const [i, r] of (finalHistory ?? []).entries()) {
    console.log(`  ${i + 1}. ${r.recommendation_status.padEnd(10)} superseded_reason=${r.superseded_reason ?? '-'}  confirmed=${!!r.confirmed_at}`);
  }
  const activeCount = (finalHistory ?? []).filter((r) => r.recommendation_status === 'active').length;
  if (activeCount !== 1) throw new Error(`Expected exactly 1 active row, found ${activeCount}`);
  if (finalHistory?.length !== 5) throw new Error(`Expected 5 rows total, got ${finalHistory?.length}`);

  const { data: finalProject } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (finalProject?.status !== 'lead_magnet_reviewed') throw new Error(`Expected final status='lead_magnet_reviewed', got '${finalProject?.status}'`);

  console.log(
    `\nSmoke test passed: full Step 5 pipeline ran end-to-end through real RLS, and the new format-only staleness invalidation (decision 13) was proven live — final confirmed: suitable=${finalConfirm2.confirmed_suitable} type=${finalConfirm2.confirmed_type ?? 'n/a'}.`,
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
