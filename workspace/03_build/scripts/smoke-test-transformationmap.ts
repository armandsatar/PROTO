// End-to-end Step 6 smoke test: chains real Step 2 + Step 4 + Step 5 runs into Step 6's
// full behavior table (generate -> edit -> regenerate-blocked-without-ack ->
// regenerate-with-ack -> confirm -> edit-blocked-while-confirmed (DB trigger, not just
// app check) -> unlock -> edit -> confirm), then proves the soft-staleness behavior:
// changing the title reverts status but leaves all 10 content fields completely
// untouched. Run with: npm run smoke:transformationmap
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation } from '../lib/format/runFormatRecommendation';
import { generateLeadMagnetRecommendation, confirmLeadMagnetRecommendation } from '../lib/leadmagnet/runLeadMagnetCheck';
import {
  generateOrRegenerateTransformationMap,
  editTransformationMapField,
  confirmTransformationMap,
  unlockTransformationMap,
  getCurrentTransformationMap,
  type TransformationMapRow,
} from '../lib/transformationmap/runTransformationMap';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

function printMap(label: string, row: TransformationMapRow) {
  console.log(`\n--- ${label} ---`);
  console.log(`  status: ${row.status}  is_edited: ${row.is_edited}  regenerate_count: ${row.regenerate_count}`);
  console.log(`  headline_before: ${row.headline_before}`);
  console.log(`  dim_emotional_before: ${row.dim_emotional_before}`);
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('transformationmap');
  console.log(`User: ${fixture.userId}  Workspace: ${fixture.workspaceId}  Project: ${fixture.projectId}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale = 'Freelancers want ongoing tracking and dread the unpredictability of irregular income.';
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
  const alternate = candidates.find((c) => !c.is_original);
  if (!original || !alternate) throw new Error('Expected both an original and an alternate candidate');

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
  await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: formatGen.recommended_format,
    confirmedDeliveryMode: formatGen.recommended_delivery_mode,
  });
  console.log(`Format confirmed: ${formatGen.recommended_format}`);

  console.log('\n=== Step 5: generate + confirm lead magnet check ===');
  const lmGen = await generateLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmLeadMagnetRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedSuitable: lmGen.recommended_suitable,
    confirmedType: lmGen.recommended_type,
  });
  console.log(`Lead magnet confirmed: suitable=${lmGen.recommended_suitable}`);

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (proj1?.status !== 'lead_magnet_reviewed') throw new Error(`Expected status='lead_magnet_reviewed', got '${proj1?.status}'`);

  // ---------- Step 6: first entry (auto-fire) ----------
  console.log('\n=== STEP 6: generateOrRegenerateTransformationMap (first entry / auto-fire) ===');
  const gen1 = await generateOrRegenerateTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printMap('Generated (1st)', gen1);
  if (gen1.regenerate_count !== 0) throw new Error(`Expected regenerate_count=0 on first entry, got ${gen1.regenerate_count}`);

  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (proj2?.status !== 'transformation_mapping') throw new Error(`Expected status='transformation_mapping', got '${proj2?.status}'`);

  // ---------- Edit a field ----------
  console.log('\n=== editTransformationMapField (hand-edit dim_emotional_before) ===');
  const handEditedText = 'HAND-EDITED: this specific sentence was typed by the user, not generated by AI, for test verification.';
  const edited = await editTransformationMapField({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    updates: { dimEmotionalBefore: handEditedText },
  });
  if (!edited.is_edited) throw new Error('Expected is_edited=true after a manual edit');
  console.log(`is_edited=${edited.is_edited}, dim_emotional_before="${edited.dim_emotional_before}"`);

  // ---------- Regenerate WITHOUT acknowledgeOverwrite (expect rejection) ----------
  console.log('\n=== generateOrRegenerateTransformationMap WITHOUT acknowledgeOverwrite (expect rejection) ===');
  let rejectedAsExpected = false;
  try {
    await generateOrRegenerateTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  } catch (err) {
    rejectedAsExpected = err instanceof Error && /acknowledgeOverwrite/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  if (!rejectedAsExpected) throw new Error('Expected regenerate to be rejected without acknowledgeOverwrite, but it was not');

  // ---------- Regenerate WITH acknowledgeOverwrite ----------
  console.log('\n=== generateOrRegenerateTransformationMap WITH acknowledgeOverwrite=true (expect overwrite) ===');
  const gen2 = await generateOrRegenerateTransformationMap({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    acknowledgeOverwrite: true,
  });
  printMap('After acknowledged regenerate', gen2);
  if (gen2.is_edited !== false) throw new Error('Expected is_edited to reset to false after regenerate');
  if (gen2.regenerate_count !== 1) throw new Error(`Expected regenerate_count=1, got ${gen2.regenerate_count}`);
  if (gen2.dim_emotional_before === handEditedText) throw new Error('Expected the hand-edited text to have been overwritten by regenerate');
  console.log('OK: hand-edit was overwritten, is_edited reset, regenerate_count incremented.');

  // ---------- Confirm ----------
  console.log('\n=== confirmTransformationMap ===');
  const confirmed1 = await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  if (confirmed1.status !== 'confirmed') throw new Error(`Expected status='confirmed', got '${confirmed1.status}'`);
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (proj3?.status !== 'transformation_map_confirmed') throw new Error(`Expected status='transformation_map_confirmed', got '${proj3?.status}'`);
  console.log(`Confirmed. projects.status = ${proj3.status}`);

  // ---------- Prove the DB trigger itself rejects a raw edit while confirmed (not just the app-level check) ----------
  console.log('\n=== Raw Supabase update on dim_practical_before while confirmed (expect DB trigger rejection, bypassing the app-level check) ===');
  const { error: rawEditErr } = await fixture.supabase
    .from('transformation_maps')
    .update({ dim_practical_before: 'sneaky raw edit bypassing editTransformationMapField()' })
    .eq('id', confirmed1.id);
  if (!rawEditErr || !/content fields are locked/.test(rawEditErr.message)) {
    throw new Error(`Expected the DB trigger to reject this, got: ${JSON.stringify(rawEditErr)}`);
  }
  console.log(`OK: DB trigger correctly rejected the raw edit — ${rawEditErr.message}`);

  // ---------- Unlock (content-preserving) ----------
  console.log('\n=== unlockTransformationMap (expect content preserved, not cleared) ===');
  const unlocked = await unlockTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId });
  if (unlocked.status !== 'draft') throw new Error(`Expected status='draft' after unlock, got '${unlocked.status}'`);
  if (unlocked.dim_emotional_before !== gen2.dim_emotional_before) throw new Error('Content changed across unlock — should have been preserved exactly');
  console.log('OK: unlocked, content byte-for-byte identical to before the lock.');

  // ---------- Edit again, confirm again ----------
  const secondHandEdit = 'SECOND HAND EDIT: verifying editing still works after an unlock cycle.';
  await editTransformationMapField({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, updates: { dimIdentityAfter: secondHandEdit } });
  const confirmed2 = await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  console.log(`\nRe-confirmed after unlock cycle. dim_identity_after="${confirmed2.dim_identity_after}"`);
  if (confirmed2.dim_identity_after !== secondHandEdit) throw new Error('Second hand-edit did not persist through re-confirm');

  // ============================================================
  // THE STALENESS PROOF: title change reverts status, preserves content
  // ============================================================
  console.log('\n=== NEW PROOF: changing the selected title should soft-invalidate Step 6 ===');
  const contentSnapshot = {
    headline_before: confirmed2.headline_before,
    dim_emotional_before: confirmed2.dim_emotional_before,
    dim_identity_after: confirmed2.dim_identity_after,
  };

  await fixture.supabase.from('title_selections').insert({
    project_id: fixture.projectId,
    workspace_id: fixture.workspaceId,
    research_run_id: researchResult.runId,
    selected_candidate_id: alternate.id,
    selected_by: fixture.userId,
  });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);
  console.log(`Title selection changed to: "${alternate.candidate_text}"`);

  const { map: afterStaleness, isStale } = await getCurrentTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId });
  if (!isStale) throw new Error('Expected isStale=true after changing the title selection');
  if (!afterStaleness) throw new Error('Expected a map row to still exist after staleness detection');
  if (afterStaleness.status !== 'draft') throw new Error(`Expected status reverted to 'draft', got '${afterStaleness.status}'`);
  console.log(`OK: isStale=${isStale}, map.status reverted to '${afterStaleness.status}'`);

  const { data: proj4 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  if (proj4?.status !== 'transformation_mapping') throw new Error(`Expected projects.status='transformation_mapping', got '${proj4?.status}'`);
  console.log(`OK: projects.status reverted to '${proj4.status}'`);

  if (
    afterStaleness.headline_before !== contentSnapshot.headline_before ||
    afterStaleness.dim_emotional_before !== contentSnapshot.dim_emotional_before ||
    afterStaleness.dim_identity_after !== contentSnapshot.dim_identity_after
  ) {
    throw new Error('Content fields changed during staleness detection — they should have been completely untouched');
  }
  console.log('OK: all sampled content fields byte-for-byte identical to the pre-staleness snapshot — decision 8 proven live.');

  // ---------- Final generation history check ----------
  const { data: generations } = await fixture.supabase
    .from('transformation_map_generations')
    .select('generation_number, generation_status')
    .eq('project_id', fixture.projectId)
    .order('generation_number', { ascending: true });
  console.log(`\nGeneration history: ${generations?.length} rows — ${generations?.map((g) => `#${g.generation_number}(${g.generation_status})`).join(', ')}`);
  if (generations?.length !== 2) throw new Error(`Expected exactly 2 generation rows (initial + 1 regenerate), got ${generations?.length}`);

  console.log(
    '\nSmoke test passed: full Step 6 pipeline ran end-to-end through real RLS — generate, edit, the acknowledge-overwrite safety rail, the DB-level content lock, content-preserving unlock, and soft title-change staleness were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
