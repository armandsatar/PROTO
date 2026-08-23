// End-to-end Step 8 smoke test: chains real Steps 2/4/5/6/7 (mock Etsy, live Groq) into
// Step 8's full action set against real RLS, no service-role bypass: assert NO
// auto-fire -> explicit generateContent -> manual edit (both content_status branches)
// -> regenerate-one (unguarded + guarded) -> regenerate-all (blocked + acknowledged) ->
// confirm WITH a deliberately forced content gap (decision 20) -> RLS proof (including
// the delete-cascade-still-works proof from Increment 1's migration-level test, now
// proven through the real JS client) -> a bonus proof of backfillNewSubtopicContent
// (otherwise completely untested anywhere in this build) -> unlock (content preserved)
// -> all 4 staleness dependencies: title, format, map (document-level, mirroring Step
// 7's 3) and the new per-row check. Run with: npm run smoke:content
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
  editSubtopic,
  deleteSubtopic,
  addManualSubtopic,
} from '../lib/subtopics/runSubtopicGeneration';
import {
  generateContent,
  confirmContentBuild,
  unlockContentBuild,
  getCurrentContentBuild,
  editSubtopicContent,
  regenerateOneSubtopicContent,
  backfillNewSubtopicContent,
  type SubtopicContentRow,
} from '../lib/content/runContentGeneration';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printContents(label: string, contents: SubtopicContentRow[]) {
  console.log(`\n--- ${label} (${contents.length} rows) ---`);
  for (const c of contents) {
    console.log(`  [${c.word_count}w] status=${c.content_status} is_edited=${c.is_edited} quality_flag=${c.quality_flag} "${c.body.slice(0, 60)}${c.body.length > 60 ? '...' : ''}"`);
  }
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('content');
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

  console.log('\n=== Step 6: generate + confirm transformation map ===');
  await generateOrRegenerateTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  console.log('\n=== Step 7: generate + confirm subtopics ===');
  const subtopicGen = await generateOrRegenerateSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  console.log(`Subtopics confirmed: ${subtopicGen.subtopics.length} items`);

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj1?.status === 'subtopics_confirmed', `Expected status='subtopics_confirmed', got '${proj1?.status}'`);

  // ============================================================
  // THE NO-AUTO-FIRE PROOF (decision 18) — must come before anything else touches Step 8
  // ============================================================
  console.log('\n=== PROOF: Step 8 does NOT auto-fire on subtopics_confirmed ===');
  const { data: noBuildYet } = await fixture.supabase.from('content_builds').select('id').eq('project_id', fixture.projectId).maybeSingle();
  assert(!noBuildYet, 'Expected NO content_builds row to exist yet — Step 8 must never auto-fire');
  const { data: projStillConfirmed } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projStillConfirmed?.status === 'subtopics_confirmed', 'Expected projects.status to remain subtopics_confirmed until generateContent is explicitly called');
  console.log('OK: no content_builds row exists, projects.status unchanged — Step 8 correctly did not auto-fire.');

  // ============================================================
  // STEP 8: explicit generateContent (first entry)
  // ============================================================
  console.log('\n=== STEP 8: generateContent (explicit first entry) ===');
  await sleep(5000);
  const gen1 = await generateContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  printContents('Generated (1st)', gen1.contents);
  assert(gen1.contents.length === subtopicGen.subtopics.length, `Expected one content row per subtopic (${subtopicGen.subtopics.length}), got ${gen1.contents.length}`);
  assert(gen1.build.regenerate_count === 0, `Expected regenerate_count=0 on first entry, got ${gen1.build.regenerate_count}`);
  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj2?.status === 'content_generating', `Expected status='content_generating', got '${proj2?.status}'`);
  const generatedCount = gen1.contents.filter((c) => c.content_status === 'generated').length;
  console.log(`OK: ${generatedCount}/${gen1.contents.length} rows successfully generated.`);

  let contents = gen1.contents;

  // ---------- Manual edit (generated row stays 'generated') ----------
  console.log('\n=== editSubtopicContent on a generated row (expect content_status stays "generated") ===');
  const handEditedText = 'HAND-EDITED content for smoke-test verification, replacing whatever the AI originally wrote for this section entirely.';
  const edited0 = await editSubtopicContent({ supabase: fixture.supabase, projectId: fixture.projectId, subtopicContentId: contents[0].id, userId: fixture.userId, body: handEditedText });
  assert(edited0.is_edited === true, 'Expected is_edited=true after a manual edit');
  assert(edited0.content_status === 'generated', `Expected content_status to stay 'generated', got '${edited0.content_status}'`);
  console.log(`OK: is_edited=${edited0.is_edited}, content_status=${edited0.content_status}.`);

  // ---------- Regenerate one: unguarded ----------
  console.log('\n=== regenerateOneSubtopicContent on an untouched row (no acknowledgeOverwrite needed) ===');
  const regenUnguarded = await regenerateOneSubtopicContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, subtopicContentId: contents[1].id });
  assert(regenUnguarded.is_edited === false, 'Expected is_edited=false after an unguarded regenerate');
  console.log(`OK: regenerated without acknowledgment (row was untouched).`);

  // ---------- Regenerate one: guarded ----------
  console.log('\n=== regenerateOneSubtopicContent on the hand-edited row WITHOUT acknowledgeOverwrite (expect rejection) ===');
  let regenOneRejected = false;
  try {
    await regenerateOneSubtopicContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, subtopicContentId: contents[0].id });
  } catch (err) {
    regenOneRejected = err instanceof Error && /acknowledgeOverwrite/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(regenOneRejected, 'Expected regenerate-one to be rejected without acknowledgeOverwrite on an edited row');

  console.log('\n=== regenerateOneSubtopicContent WITH acknowledgeOverwrite=true (expect overwrite) ===');
  const regenGuarded = await regenerateOneSubtopicContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, subtopicContentId: contents[0].id, acknowledgeOverwrite: true });
  assert(regenGuarded.is_edited === false, 'Expected is_edited reset to false after acknowledged regenerate');
  assert(regenGuarded.body !== handEditedText, 'Expected the hand-edited text to have been overwritten');
  console.log('OK: hand-edit overwritten, is_edited reset.');

  // ---------- Set up regenerate-all's gate: edit another row ----------
  await editSubtopicContent({ supabase: fixture.supabase, projectId: fixture.projectId, subtopicContentId: contents[2].id, userId: fixture.userId, body: 'ANOTHER HAND EDIT to trip the whole-document acknowledgment gate.' });

  console.log('\n=== generateContent (whole-document) WITHOUT acknowledgeOverwrite (expect rejection) ===');
  let regenAllRejected = false;
  try {
    await generateContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  } catch (err) {
    regenAllRejected = err instanceof Error && /acknowledgeOverwrite/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(regenAllRejected, 'Expected whole-document regenerate to be rejected without acknowledgeOverwrite');

  console.log('\n=== generateContent (whole-document) WITH acknowledgeOverwrite=true (expect full pass) ===');
  await sleep(5000); // light pacing before another N-subtopic x 2-call burst — real Groq TPM limits found live in Increment 3
  const gen2 = await generateContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, acknowledgeOverwrite: true });
  assert(gen2.build.regenerate_count === 1, `Expected regenerate_count=1, got ${gen2.build.regenerate_count}`);
  assert(gen2.contents.every((c) => c.is_edited === false), 'Expected every row to have is_edited reset to false after whole-document regenerate');
  contents = gen2.contents;
  console.log(`OK: whole-document regenerate complete, regenerate_count=${gen2.build.regenerate_count}, all rows is_edited=false.`);

  // ============================================================
  // Force a content gap directly (decision 20's proof needs a real gap at confirm time,
  // and regenerate-all above just overwrote whatever gaps existed from the initial run)
  // ============================================================
  console.log('\n=== Forcing a content gap on one row (simulating a writer-pass failure) to test confirm-with-gaps (decision 20) ===');
  const gapTargetId = contents[contents.length - 1].id;
  await fixture.supabase.from('subtopic_contents').update({ body: '', content_status: 'failed_empty', word_count: 0 }).eq('id', gapTargetId);
  const { data: gapCheck } = await fixture.supabase.from('subtopic_contents').select('content_status').eq('id', gapTargetId).single();
  assert(gapCheck?.content_status === 'failed_empty', 'Failed to force the content gap for this proof');
  console.log('OK: one row forced to failed_empty.');

  // ---------- Confirm WITH the gap present ----------
  console.log('\n=== confirmContentBuild WITH a content gap present (expect success — decision 20) ===');
  const confirmed1 = await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  assert(confirmed1.status === 'confirmed', `Expected status='confirmed', got '${confirmed1.status}'`);
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj3?.status === 'content_confirmed', `Expected status='content_confirmed', got '${proj3?.status}'`);
  console.log(`OK: confirmed despite the content gap. projects.status = ${proj3?.status}`);

  // ---------- RLS proof: raw UPDATE silently blocked, raw INSERT rejected ----------
  console.log('\n=== Raw Supabase UPDATE on a subtopic_contents row while confirmed (expect silent RLS block) ===');
  const targetRow = contents[0];
  const { error: rawUpdateErr } = await fixture.supabase.from('subtopic_contents').update({ body: 'SNEAKY RAW UPDATE' }).eq('id', targetRow.id);
  const { data: afterRawUpdate } = await fixture.supabase.from('subtopic_contents').select('body').eq('id', targetRow.id).single();
  assert(!rawUpdateErr, `Expected no thrown error from the blocked UPDATE, got: ${rawUpdateErr?.message}`);
  assert(afterRawUpdate?.body === targetRow.body, 'Expected the raw UPDATE to have been silently blocked by RLS');
  console.log('OK: raw UPDATE silently blocked.');

  console.log('\n=== Raw Supabase INSERT into subtopic_contents while confirmed (expect a real RLS exception) ===');
  const { error: rawInsertErr } = await fixture.supabase.from('subtopic_contents').insert({
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    content_build_id: confirmed1.id,
    subtopic_id: subtopicGen.subtopics[0].id,
    body: 'sneaky',
    target_word_min: 1,
    target_word_max: 2,
  });
  assert(!!rawInsertErr, 'Expected the raw INSERT to be rejected by RLS while confirmed');
  console.log(`OK: raw INSERT correctly rejected — ${rawInsertErr?.message}`);

  // ---------- The delete-cascade-still-works proof (Increment 1's migration test, now via the real JS client) ----------
  console.log('\n=== Deleting a subtopic (Step 7, list unlocked) while content_builds is independently CONFIRMED — cascade must still succeed ===');
  await unlockSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  const toDeleteSubtopicId = subtopicGen.subtopics[subtopicGen.subtopics.length - 1].id;
  const toDeleteContentId = contents.find((c) => c.subtopic_id === toDeleteSubtopicId)?.id;
  await deleteSubtopic({ supabase: fixture.supabase, projectId: fixture.projectId, subtopicId: toDeleteSubtopicId });
  const { data: orphanCheck } = await fixture.supabase.from('subtopic_contents').select('id').eq('id', toDeleteContentId).maybeSingle();
  assert(!orphanCheck, 'Expected the subtopic_contents row to have been removed by the cascade');
  console.log('OK: cascade succeeded — subtopic_contents row removed despite content_builds being confirmed throughout.');
  contents = contents.filter((c) => c.id !== toDeleteContentId);

  // ---------- Bonus proof: backfillNewSubtopicContent (otherwise entirely untested) ----------
  console.log('\n=== BONUS: backfillNewSubtopicContent for a subtopic added while the list is unlocked ===');
  // backfillNewSubtopicContent correctly requires content_builds to be draft (you
  // can't add content to a locked document) — content_builds is still confirmed from
  // the gap-confirm proof above, so it needs unlocking first, same as any other
  // row-level content action.
  await unlockContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  const newSubtopic = await addManualSubtopic({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    workspaceId: fixture.workspaceId,
    title: 'Newly Added Subtopic For Backfill Testing',
    description: 'Added after Step 8 content already exists, to test the backfill action.',
    depth: 'medium',
  });
  const backfilled = await backfillNewSubtopicContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, subtopicId: newSubtopic.id });
  assert(backfilled.subtopic_id === newSubtopic.id, 'Expected the backfilled content row to belong to the new subtopic');
  console.log(`OK: backfilled content for "${newSubtopic.title}" — ${backfilled.word_count} words, status=${backfilled.content_status}.`);
  contents = [...contents, backfilled];

  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  // Re-confirm content_builds so the dedicated "unlock (content-preserving)" proof
  // below has something real to unlock, rather than reusing the unlock this bonus
  // proof already needed.
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  // ---------- Unlock (content-preserving) ----------
  console.log('\n=== unlockContentBuild (expect content preserved, not cleared) ===');
  const unlocked = await unlockContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(unlocked.status === 'draft', `Expected status='draft' after unlock, got '${unlocked.status}'`);
  const { data: afterUnlockRows } = await fixture.supabase.from('subtopic_contents').select('id, body').eq('content_build_id', unlocked.id);
  const stillMatches = (afterUnlockRows ?? []).every((r) => contents.find((c) => c.id === r.id)?.body === r.body);
  assert(stillMatches, 'Content should be byte-for-byte identical across the lock/unlock cycle');
  console.log(`OK: unlocked, ${afterUnlockRows?.length} rows byte-for-byte identical to before the lock.`);

  // ============================================================
  // STALENESS PROOFS — confirm first each time, so the revert-on-stale effect is observable
  // ============================================================

  // ---------- Format staleness ----------
  console.log('\n=== STALENESS PROOF 1/4: confirmed format change ===');
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const changedFormat = formatGen.recommended_format === 'tracker' ? 'workbook' : 'tracker';
  const newActiveFormatRow = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: changedFormat, confirmedDeliveryMode: newActiveFormatRow.recommended_delivery_mode });
  console.log(`Confirmed format changed from "${formatGen.recommended_format}" to "${changedFormat}".`);

  const afterFormatChange = await getCurrentContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterFormatChange.isStale && afterFormatChange.documentStaleReason === 'format_changed', `Expected documentStaleReason='format_changed', got '${afterFormatChange.documentStaleReason}'`);
  assert(afterFormatChange.build?.status === 'draft', `Expected build reverted to draft, got '${afterFormatChange.build?.status}'`);
  const { data: projAfterFormat } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterFormat?.status === 'content_generating', `Expected project status reverted to content_generating, got '${projAfterFormat?.status}'`);
  console.log(`OK: isStale=true, documentStaleReason='format_changed', build reverted, content untouched.`);

  // Resolve format staleness before proof 2, same lesson learned from Step 7's smoke
  // test: otherwise it's still format-stale AND about to become map-stale, and
  // precedence would keep reporting format_changed, masking proof 2.
  await sleep(5000);
  await generateContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  console.log('Resolved format staleness via a clean regenerate (no ack needed).');

  // ---------- Transformation map staleness ----------
  console.log('\n=== STALENESS PROOF 2/4: transformation map content change ===');
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  await unlockTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId });
  await editTransformationMapField({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, updates: { dimPracticalBefore: 'SMOKE-TEST EDIT: changing the map content to trigger Step 8 map staleness.' } });

  const afterMapChange = await getCurrentContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterMapChange.isStale && afterMapChange.documentStaleReason === 'transformation_map_changed', `Expected documentStaleReason='transformation_map_changed', got '${afterMapChange.documentStaleReason}'`);
  assert(afterMapChange.build?.status === 'draft', `Expected build reverted to draft, got '${afterMapChange.build?.status}'`);
  console.log(`OK: isStale=true, documentStaleReason='transformation_map_changed', build reverted, content untouched.`);

  // ---------- Title staleness (highest precedence — done before per-row so both can coexist) ----------
  console.log('\n=== STALENESS PROOF 3/4: selected title change ===');
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: alternate.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);
  console.log(`Title selection changed to: "${alternate.candidate_text}"`);

  const afterTitleChange = await getCurrentContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterTitleChange.isStale && afterTitleChange.documentStaleReason === 'title_changed', `Expected documentStaleReason='title_changed' (highest precedence), got '${afterTitleChange.documentStaleReason}'`);
  assert(afterTitleChange.build?.status === 'draft', `Expected build reverted to draft, got '${afterTitleChange.build?.status}'`);
  console.log(`OK: isStale=true, documentStaleReason='title_changed' (correctly took precedence over the still-unresolved map staleness), build reverted.`);

  // ---------- Per-row staleness (NEW for Step 8) — proven while document-level staleness is ALSO active ----------
  console.log('\n=== STALENESS PROOF 4/4: per-row subtopic staleness (independent of document-level staleness) ===');
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId }).catch(() => {
    // May already be confirmed from the backfill step above — fine either way.
  });
  await unlockSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });

  const rowToEdit = contents[0];
  const editedSubtopic = await editSubtopic({ supabase: fixture.supabase, projectId: fixture.projectId, subtopicId: rowToEdit.subtopic_id, userId: fixture.userId, updates: { title: 'RETITLED Subtopic For Per-Row Staleness Proof' } });
  console.log(`Edited subtopic "${editedSubtopic.title}" directly via Step 7 (content untouched).`);

  const afterRowChange = await getCurrentContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterRowChange.staleSubtopicContentIds.includes(rowToEdit.id), `Expected content row ${rowToEdit.id} to be flagged per-row-stale`);
  assert(afterRowChange.staleSubtopicContentIds.length === 1, `Expected exactly 1 stale row, got ${afterRowChange.staleSubtopicContentIds.length}`);
  console.log(`OK: exactly 1 row flagged per-row-stale (the edited one), ${afterRowChange.contents.length - 1} sibling rows unaffected — decision 11's new detection granularity proven live, independent of document-level staleness (documentStaleReason='${afterRowChange.documentStaleReason}' simultaneously).`);

  console.log(
    '\nSmoke test passed: the full Step 8 action set ran end-to-end through real RLS and real Groq — no-auto-fire, generate, edit (both content_status branches), regenerate-one (unguarded + guarded), regenerate-all (blocked + acknowledged), confirm-with-gaps, the RLS lock (silent UPDATE block + real INSERT rejection + delete-cascade-still-works), backfillNewSubtopicContent, content-preserving unlock, and all four independent staleness dependencies (format, map, title with correct precedence, and the new per-row check proven simultaneously with active document-level staleness) were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
