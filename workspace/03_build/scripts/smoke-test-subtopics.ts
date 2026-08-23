// End-to-end Step 7 smoke test: chains real Steps 2/4/5/6 output (mock Etsy, live Groq)
// into Step 7's full action set (generate -> reorder -> delete -> manual-add -> edit
// (both source branches) -> regenerate-one (unguarded + guarded) -> regenerate-all
// (blocked-without-ack, then with-ack) -> confirm -> RLS proof (blocks direct writes
// while confirmed, WITHOUT the trigger Step 6 needed) -> unlock (content preserved)),
// then all three staleness proofs (format, transformation map, title), each confirmed
// first so the revert-on-stale behavior is actually observable. Run with:
// npm run smoke:subtopics
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation, changeFormat } from '../lib/format/runFormatRecommendation';
import { generateLeadMagnetRecommendation, confirmLeadMagnetRecommendation } from '../lib/leadmagnet/runLeadMagnetCheck';
import {
  generateOrRegenerateTransformationMap,
  confirmTransformationMap,
  unlockTransformationMap,
  editTransformationMapField,
} from '../lib/transformationmap/runTransformationMap';
import {
  generateOrRegenerateSubtopicList,
  confirmSubtopicList,
  unlockSubtopicList,
  getCurrentSubtopicList,
  reorderSubtopics,
  deleteSubtopic,
  addManualSubtopic,
  editSubtopic,
  regenerateOneSubtopic,
  type SubtopicRow,
} from '../lib/subtopics/runSubtopicGeneration';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function printList(label: string, subtopics: SubtopicRow[]) {
  console.log(`\n--- ${label} (${subtopics.length} items) ---`);
  for (const s of subtopics) {
    console.log(`  [${s.display_order}] "${s.title}" (${s.source}, is_edited=${s.is_edited}, depth=${s.depth})`);
  }
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('subtopics');
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

  console.log('\n=== Step 6: generate + confirm transformation map ===');
  await generateOrRegenerateTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj1?.status === 'transformation_map_confirmed', `Expected status='transformation_map_confirmed', got '${proj1?.status}'`);
  console.log(`Transformation map confirmed. projects.status = ${proj1?.status}`);

  // ============================================================
  // STEP 7: first entry (auto-fire)
  // ============================================================
  console.log('\n=== STEP 7: generateOrRegenerateSubtopicList (first entry / auto-fire) ===');
  const gen1 = await generateOrRegenerateSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printList('Generated (1st)', gen1.subtopics);
  assert(gen1.list.regenerate_count === 0, `Expected regenerate_count=0 on first entry, got ${gen1.list.regenerate_count}`);
  assert(
    gen1.subtopics.length >= gen1.list.target_count_min && gen1.subtopics.length <= gen1.list.target_count_max,
    `Expected count within [${gen1.list.target_count_min}, ${gen1.list.target_count_max}], got ${gen1.subtopics.length}`,
  );
  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj2?.status === 'subtopic_generating', `Expected status='subtopic_generating', got '${proj2?.status}'`);
  console.log(`OK: ${gen1.subtopics.length} subtopics within target range [${gen1.list.target_count_min}, ${gen1.list.target_count_max}].`);

  // ---------- Reorder ----------
  console.log('\n=== reorderSubtopics (swap the first two items) ===');
  const [first, second, ...rest] = gen1.subtopics;
  const swappedOrder = [second.id, first.id, ...rest.map((s) => s.id)];
  const reordered = await reorderSubtopics({ supabase: fixture.supabase, projectId: fixture.projectId, orderedSubtopicIds: swappedOrder });
  assert(reordered[0].id === second.id && reordered[0].display_order === 1, 'Expected the former 2nd item to now be display_order=1');
  assert(reordered[1].id === first.id && reordered[1].display_order === 2, 'Expected the former 1st item to now be display_order=2');
  assert(reordered[0].is_edited === false && reordered[1].is_edited === false, 'Reordering must not set is_edited');
  console.log(`OK: swapped "${reordered[0].title}" <-> "${reordered[1].title}", is_edited untouched by reorder.`);

  // ---------- Delete ----------
  console.log('\n=== deleteSubtopic (remove the last item) ===');
  const beforeDeleteCount = reordered.length;
  const toDelete = reordered[reordered.length - 1];
  const afterDelete = await deleteSubtopic({ supabase: fixture.supabase, projectId: fixture.projectId, subtopicId: toDelete.id });
  assert(afterDelete.length === beforeDeleteCount - 1, `Expected ${beforeDeleteCount - 1} rows after delete, got ${afterDelete.length}`);
  assert(!afterDelete.some((s) => s.id === toDelete.id), 'Deleted row should no longer be present');
  assert(
    afterDelete.every((s, i) => s.display_order === i + 1),
    'display_order should be resequenced 1..N with no gaps after delete',
  );
  console.log(`OK: deleted "${toDelete.title}", ${afterDelete.length} rows remain, display_order resequenced with no gaps.`);

  // ---------- Manual add ----------
  console.log('\n=== addManualSubtopic ===');
  const manualDescription = 'Hand-added subtopic for smoke-test verification, well over the twenty character minimum.';
  const manualRow = await addManualSubtopic({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    title: 'Manually Added Subtopic For Testing',
    description: manualDescription,
    depth: 'medium',
  });
  assert(manualRow.source === 'manual', `Expected source='manual', got '${manualRow.source}'`);
  assert(manualRow.is_edited === false, 'Manual row should start is_edited=false');
  assert(manualRow.display_order === afterDelete.length + 1, 'Manual row should be appended at the end');
  console.log(`OK: added "${manualRow.title}" at display_order=${manualRow.display_order}, source=${manualRow.source}.`);

  // ---------- Edit: manual row stays is_edited=false ----------
  console.log('\n=== editSubtopic on the manual row (expect is_edited stays false) ===');
  const editedManual = await editSubtopic({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    subtopicId: manualRow.id,
    userId: fixture.userId,
    updates: { title: 'Manually Added Subtopic, Then Edited' },
  });
  assert(editedManual.is_edited === false, `Expected is_edited=false for an edited manual row, got ${editedManual.is_edited}`);
  console.log(`OK: title updated to "${editedManual.title}", is_edited=${editedManual.is_edited} as expected for source='manual'.`);

  // ---------- Edit: ai_generated row flips is_edited=true ----------
  console.log('\n=== editSubtopic on an ai_generated row (expect is_edited flips true) ===');
  const aiRowToEdit = afterDelete.find((s) => s.source === 'ai_generated');
  if (!aiRowToEdit) throw new Error('Expected at least one ai_generated row to remain after delete');
  const handEditedText = 'HAND-EDITED description for smoke-test verification, well over twenty characters.';
  const editedAi = await editSubtopic({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    subtopicId: aiRowToEdit.id,
    userId: fixture.userId,
    updates: { description: handEditedText },
  });
  assert(editedAi.is_edited === true, `Expected is_edited=true for an edited ai_generated row, got ${editedAi.is_edited}`);
  console.log(`OK: description updated, is_edited=${editedAi.is_edited} as expected for source='ai_generated'.`);

  // ---------- Regenerate one: unguarded (unedited ai_generated row, no ack needed) ----------
  console.log('\n=== regenerateOneSubtopic on an untouched ai_generated row (no acknowledgeOverwrite needed) ===');
  const listAfterEdits = await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  const untouchedAiRow = listAfterEdits.subtopics.find((s) => s.source === 'ai_generated' && !s.is_edited && s.id !== aiRowToEdit.id);
  if (!untouchedAiRow) throw new Error('Expected at least one untouched ai_generated row for the unguarded regenerate-one proof');
  const regenUnguarded = await regenerateOneSubtopic({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    subtopicId: untouchedAiRow.id,
  });
  assert(regenUnguarded.source === 'ai_regenerated', `Expected source='ai_regenerated', got '${regenUnguarded.source}'`);
  assert(regenUnguarded.is_edited === false, 'Expected is_edited reset to false after regenerate');
  console.log(`OK: "${untouchedAiRow.title}" -> "${regenUnguarded.title}" (${regenUnguarded.source}), no acknowledgment required.`);

  // ---------- Regenerate one: guarded (the hand-edited row) ----------
  console.log('\n=== regenerateOneSubtopic on the hand-edited row WITHOUT acknowledgeOverwrite (expect rejection) ===');
  let regenOneRejected = false;
  try {
    await regenerateOneSubtopic({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, subtopicId: editedAi.id });
  } catch (err) {
    regenOneRejected = err instanceof Error && /acknowledgeOverwrite/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(regenOneRejected, 'Expected regenerate-one to be rejected without acknowledgeOverwrite on an edited row');

  console.log('\n=== regenerateOneSubtopic on the hand-edited row WITH acknowledgeOverwrite=true (expect overwrite) ===');
  const regenGuarded = await regenerateOneSubtopic({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    subtopicId: editedAi.id,
    acknowledgeOverwrite: true,
  });
  assert(regenGuarded.is_edited === false, 'Expected is_edited reset to false after acknowledged regenerate');
  assert(regenGuarded.description !== handEditedText, 'Expected the hand-edited description to be overwritten');
  console.log(`OK: hand-edit overwritten -> "${regenGuarded.title}", is_edited reset, source=${regenGuarded.source}.`);

  // ============================================================
  // Regenerate WHOLE LIST — blocked without ack (hand-curation present), then with ack
  // ============================================================
  console.log('\n=== generateOrRegenerateSubtopicList (whole-list) WITHOUT acknowledgeOverwrite (expect rejection) ===');
  let regenAllRejected = false;
  try {
    await generateOrRegenerateSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  } catch (err) {
    regenAllRejected = err instanceof Error && /acknowledgeOverwrite/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(regenAllRejected, 'Expected whole-list regenerate to be rejected without acknowledgeOverwrite');

  console.log('\n=== generateOrRegenerateSubtopicList (whole-list) WITH acknowledgeOverwrite=true (expect full replacement) ===');
  const beforeRegenAllIds = new Set(listAfterEdits.subtopics.map((s) => s.id));
  const gen2 = await generateOrRegenerateSubtopicList({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    acknowledgeOverwrite: true,
  });
  printList('Generated (regenerate-all)', gen2.subtopics);
  assert(gen2.list.regenerate_count === 1, `Expected regenerate_count=1, got ${gen2.list.regenerate_count}`);
  assert(
    gen2.subtopics.every((s) => !beforeRegenAllIds.has(s.id)) && gen2.subtopics.every((s) => s.source === 'ai_generated'),
    'Expected every row to be a brand-new ai_generated row after whole-list regenerate',
  );
  console.log(`OK: full replacement — ${gen2.subtopics.length} brand-new rows, regenerate_count=${gen2.list.regenerate_count}.`);

  // ---------- Confirm ----------
  console.log('\n=== confirmSubtopicList ===');
  const confirmed1 = await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  assert(confirmed1.status === 'confirmed', `Expected status='confirmed', got '${confirmed1.status}'`);
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj3?.status === 'subtopics_confirmed', `Expected status='subtopics_confirmed', got '${proj3?.status}'`);
  console.log(`Confirmed. projects.status = ${proj3?.status}`);

  // ---------- Prove RLS itself blocks direct writes while confirmed (no trigger needed — migration 0005's core bet) ----------
  console.log('\n=== Raw Supabase UPDATE on a subtopics row while confirmed (expect RLS to silently filter it out, not throw) ===');
  const targetRow = gen2.subtopics[0];
  const { error: rawUpdateErr } = await fixture.supabase
    .from('subtopics')
    .update({ title: 'SNEAKY RAW UPDATE BYPASSING editSubtopic()' })
    .eq('id', targetRow.id);
  // Blocked UPDATE is silent (RLS filters the row out of the match), not an exception —
  // same distinction the migration-level SQL test had to be corrected for in Increment 1.
  const { data: afterRawUpdate } = await fixture.supabase.from('subtopics').select('title').eq('id', targetRow.id).single();
  assert(!rawUpdateErr, `Expected no thrown error from the blocked UPDATE, got: ${rawUpdateErr?.message}`);
  assert(afterRawUpdate?.title === targetRow.title, 'Expected the raw UPDATE to have been silently blocked by RLS — title should be unchanged');
  console.log(`OK: raw UPDATE silently blocked by RLS — title still "${afterRawUpdate?.title}".`);

  console.log('\n=== Raw Supabase INSERT into subtopics while confirmed (expect a real RLS exception) ===');
  const { error: rawInsertErr } = await fixture.supabase.from('subtopics').insert({
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    subtopic_list_id: confirmed1.id,
    title: 'Sneaky raw insert',
    description: 'This insert should be rejected by RLS since the list is confirmed, not draft.',
    display_order: 999,
    depth: 'shallow',
    source: 'manual',
    is_edited: false,
  });
  assert(!!rawInsertErr, 'Expected the raw INSERT to be rejected by RLS while confirmed');
  console.log(`OK: raw INSERT correctly rejected — ${rawInsertErr?.message}`);

  // ---------- Unlock (content-preserving) ----------
  console.log('\n=== unlockSubtopicList (expect content preserved, not cleared) ===');
  const unlocked = await unlockSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(unlocked.status === 'draft', `Expected status='draft' after unlock, got '${unlocked.status}'`);
  const { data: afterUnlockRows } = await fixture.supabase
    .from('subtopics')
    .select('id, title')
    .eq('subtopic_list_id', unlocked.id)
    .order('display_order', { ascending: true });
  assert(
    afterUnlockRows?.length === gen2.subtopics.length && afterUnlockRows.every((r, i) => r.title === gen2.subtopics[i].title),
    'Content should be byte-for-byte identical across the lock/unlock cycle',
  );
  console.log(`OK: unlocked, all ${afterUnlockRows?.length} rows byte-for-byte identical to before the lock.`);

  // ============================================================
  // STALENESS PROOFS — confirm first each time, so the revert-on-stale effect is observable
  // ============================================================

  // ---------- Format staleness ----------
  console.log('\n=== STALENESS PROOF 1/3: confirmed format change ===');
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  const preFormatChangeTitles = (await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId })).subtopics.map((s) => s.title);

  const changedFormat = formatGen.recommended_format === 'tracker' ? 'workbook' : 'tracker';
  const newActiveFormatRow = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedFormat: changedFormat,
    confirmedDeliveryMode: newActiveFormatRow.recommended_delivery_mode,
  });
  console.log(`Confirmed format changed from "${formatGen.recommended_format}" to "${changedFormat}" (new format_recommendations row).`);

  const afterFormatChange = await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterFormatChange.isStale && afterFormatChange.staleReason === 'format_changed', `Expected staleReason='format_changed', got '${afterFormatChange.staleReason}'`);
  assert(afterFormatChange.list?.status === 'draft', `Expected list reverted to draft, got '${afterFormatChange.list?.status}'`);
  const { data: projAfterFormat } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterFormat?.status === 'subtopic_generating', `Expected project status reverted to subtopic_generating, got '${projAfterFormat?.status}'`);
  assert(
    JSON.stringify(afterFormatChange.subtopics.map((s) => s.title)) === JSON.stringify(preFormatChangeTitles),
    'Content should be completely untouched by format staleness detection',
  );
  console.log(`OK: isStale=true, staleReason='format_changed', list reverted to draft, all ${afterFormatChange.subtopics.length} titles untouched.`);

  // Resolve the format staleness before proof 2 — otherwise it's still format-stale
  // AND about to become map-stale, and detectStalenessReason's precedence (title >
  // format > map, proven in rules unit tests) would correctly keep reporting
  // 'format_changed', masking proof 2's map change rather than a code defect. No
  // acknowledgeOverwrite needed here: every row is still untouched ai_generated
  // content from the whole-list regenerate above.
  const resolvedFormat = await generateOrRegenerateSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(resolvedFormat.list.confirmed_format === changedFormat, 'Expected the resolution regenerate to re-snapshot against the new confirmed format');
  console.log(`Resolved format staleness via a clean regenerate (no ack needed) — confirmed_format now '${resolvedFormat.list.confirmed_format}', target range [${resolvedFormat.list.target_count_min}, ${resolvedFormat.list.target_count_max}].`);

  // ---------- Transformation map staleness ----------
  console.log('\n=== STALENESS PROOF 2/3: transformation map content change ===');
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  const preMapChangeTitles = (await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId })).subtopics.map((s) => s.title);

  await unlockTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId });
  await editTransformationMapField({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    updates: { dimPracticalBefore: 'SMOKE-TEST EDIT: changing the map content to trigger Step 7 map staleness.' },
  });
  console.log('Transformation map hand-edited (dim_practical_before).');

  const afterMapChange = await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterMapChange.isStale && afterMapChange.staleReason === 'transformation_map_changed', `Expected staleReason='transformation_map_changed', got '${afterMapChange.staleReason}'`);
  assert(afterMapChange.list?.status === 'draft', `Expected list reverted to draft, got '${afterMapChange.list?.status}'`);
  assert(
    JSON.stringify(afterMapChange.subtopics.map((s) => s.title)) === JSON.stringify(preMapChangeTitles),
    'Content should be completely untouched by map staleness detection',
  );
  console.log(`OK: isStale=true, staleReason='transformation_map_changed', list reverted to draft, content untouched.`);

  // ---------- Title staleness (the biggest cascade — done last) ----------
  console.log('\n=== STALENESS PROOF 3/3: selected title change ===');
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  const preTitleChangeTitles = (await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId })).subtopics.map((s) => s.title);

  await fixture.supabase.from('title_selections').insert({
    project_id: fixture.projectId,
    workspace_id: fixture.workspaceId,
    research_run_id: researchResult.runId,
    selected_candidate_id: alternate.id,
    selected_by: fixture.userId,
  });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);
  console.log(`Title selection changed to: "${alternate.candidate_text}"`);

  const afterTitleChange = await getCurrentSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterTitleChange.isStale && afterTitleChange.staleReason === 'title_changed', `Expected staleReason='title_changed' (highest precedence), got '${afterTitleChange.staleReason}'`);
  assert(afterTitleChange.list?.status === 'draft', `Expected list reverted to draft, got '${afterTitleChange.list?.status}'`);
  const { data: projAfterTitle } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterTitle?.status === 'subtopic_generating', `Expected project status reverted to subtopic_generating, got '${projAfterTitle?.status}'`);
  assert(
    JSON.stringify(afterTitleChange.subtopics.map((s) => s.title)) === JSON.stringify(preTitleChangeTitles),
    'Content should be completely untouched by title staleness detection',
  );
  console.log(`OK: isStale=true, staleReason='title_changed' (correctly took precedence), list reverted to draft, content untouched.`);

  // ---------- Final generation history sanity check ----------
  const { data: generations } = await fixture.supabase
    .from('subtopic_generations')
    .select('generation_number, generation_type, generation_status')
    .eq('project_id', fixture.projectId)
    .order('generation_number', { ascending: true });
  console.log(`\nGeneration history: ${generations?.length} rows — ${generations?.map((g) => `#${g.generation_number}(${g.generation_type}/${g.generation_status})`).join(', ')}`);

  console.log(
    '\nSmoke test passed: the full Step 7 action set ran end-to-end through real RLS and real Groq — generate, reorder, delete, manual-add, edit (both is_edited branches), single-item regenerate (unguarded + guarded), whole-list regenerate (blocked + acknowledged), confirm, the no-trigger RLS lock (silent UPDATE block + real INSERT rejection), content-preserving unlock, and all three independent staleness dependencies (format, transformation map, title with correct precedence) were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
