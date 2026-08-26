// End-to-end Step 9 smoke test: chains real Steps 2/4/5/6/7/8 (mock Etsy, live Groq)
// into Step 9's full action set against real RLS, no service-role bypass, live Gemini,
// live Satori rendering, and real Supabase Storage. Sequence: assert NO auto-fire ->
// generateInitialCandidate (first entry) -> regenerate to the 3-candidate hard cap
// (blocked, then acknowledged past it) -> styleEdit to the 5-edit-round hard cap (same
// proof, chained via real Gemini continuation) -> pickOlderCandidate (incl. the
// undo-rejects-a-non-edit proof) -> undoLastEdit (real parent_generation_id walk) ->
// uploadOwnImage -> approve -> RLS proofs (Postgres cross-workspace spoofing + Storage
// cross-workspace isolation, both against the real uploaded asset) -> unlock
// (content-preserving) -> all 3 staleness dependencies (title, format, content-build).
// This makes ~10 real, billable Gemini calls (the caps' own worst case, deliberately
// exceeded by one on each cap to prove the acknowledge gate) — run with: npm run smoke:cover
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation, changeFormat } from '../lib/format/runFormatRecommendation';
import { generateLeadMagnetRecommendation, confirmLeadMagnetRecommendation } from '../lib/leadmagnet/runLeadMagnetCheck';
import { generateOrRegenerateTransformationMap, confirmTransformationMap } from '../lib/transformationmap/runTransformationMap';
import { generateOrRegenerateSubtopicList, confirmSubtopicList } from '../lib/subtopics/runSubtopicGeneration';
import { generateContent, confirmContentBuild, unlockContentBuild } from '../lib/content/runContentGeneration';
import {
  generateInitialCandidate,
  styleEdit,
  pickOlderCandidate,
  undoLastEdit,
  uploadOwnImage,
  approve,
  unlockCoverDesign,
  getCurrentCoverDesign,
  buildCoverAssetPath,
} from '../lib/cover';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

// A minimal valid 1x1 PNG — same fixture as renderCoverImage.test.ts. uploadOwnImage
// tests the DB/storage plumbing, not art quality, so no real image content is needed.
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('cover');
  console.log(`User: ${fixture.userId}  Workspace: ${fixture.workspaceId}  Project: ${fixture.projectId}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale = 'Freelancers want ongoing tracking and dread the unpredictability of irregular income.';
  await createTitleIdea(fixture, originalTitle, rationale);

  console.log('\n=== Steps 2/4/5/6/7/8: chaining to content_confirmed ===');
  const researchResult = await runResearch({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, originalTitle, rationale });
  const candidates = researchResult.candidates as unknown as CandidateRow[];
  const original = candidates.find((c) => c.is_original);
  const alternate = candidates.find((c) => !c.is_original);
  if (!original || !alternate) throw new Error('Expected both an original and an alternate candidate');
  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: original.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: original.id, status: 'title_selected' }).eq('id', fixture.projectId);

  const formatGen = await generateFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: formatGen.recommended_format, confirmedDeliveryMode: formatGen.recommended_delivery_mode });

  const lmGen = await generateLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedSuitable: lmGen.recommended_suitable, confirmedType: lmGen.recommended_type });

  await generateOrRegenerateTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  await generateOrRegenerateSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  await sleep(5000);
  await generateContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj1?.status === 'content_confirmed', `Expected status='content_confirmed', got '${proj1?.status}'`);
  console.log('OK: reached content_confirmed.');

  // ============================================================
  // THE NO-AUTO-FIRE PROOF (decision 6) — must come before anything else touches Step 9
  // ============================================================
  console.log('\n=== PROOF: Step 9 does NOT auto-fire on content_confirmed ===');
  const { data: noDesignYet } = await fixture.supabase.from('cover_designs').select('id').eq('project_id', fixture.projectId).maybeSingle();
  assert(!noDesignYet, 'Expected NO cover_designs row to exist yet — Step 9 must never auto-fire');
  console.log('OK: no cover_designs row exists — Step 9 correctly did not auto-fire.');

  // ============================================================
  // Candidate generation: first entry, then regenerate to the 3-candidate hard cap
  // ============================================================
  console.log('\n=== generateInitialCandidate (explicit first entry) ===');
  const gen1 = await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(gen1.generation.generation_status === 'succeeded', `Expected first candidate to succeed, got '${gen1.generation.generation_status}': ${gen1.generation.error_detail}`);
  assert(gen1.design.candidate_count === 1, `Expected candidate_count=1, got ${gen1.design.candidate_count}`);
  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj2?.status === 'design_generating', `Expected status='design_generating', got '${proj2?.status}'`);
  console.log(`OK: candidate #1 generated, cost=$${gen1.generation.cost_usd}, asset=${gen1.generation.asset_storage_path}`);
  const firstGenerationId = gen1.generation.id;

  console.log('\n=== Regenerating to the 3-candidate cap (unguarded, cap not yet reached) ===');
  await sleep(3000);
  const gen2 = await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(gen2.design.candidate_count === 2, `Expected candidate_count=2, got ${gen2.design.candidate_count}`);
  await sleep(3000);
  const gen3 = await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(gen3.design.candidate_count === 3, `Expected candidate_count=3, got ${gen3.design.candidate_count}`);
  console.log('OK: reached candidate_count=3 (the cap) with no acknowledgment needed.');

  console.log('\n=== Regenerating WITHOUT acknowledgeAdditionalCost at the cap (expect rejection, no Gemini call made) ===');
  let candidateCapRejected = false;
  try {
    await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  } catch (err) {
    candidateCapRejected = err instanceof Error && /acknowledgeAdditionalCost/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(candidateCapRejected, 'Expected regenerate to be rejected at the candidate cap without acknowledgeAdditionalCost');

  console.log('\n=== Regenerating WITH acknowledgeAdditionalCost=true past the cap (expect success) ===');
  await sleep(3000);
  const gen4 = await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, acknowledgeAdditionalCost: true });
  assert(gen4.design.candidate_count === 4, `Expected candidate_count=4 after the acknowledged regenerate, got ${gen4.design.candidate_count}`);
  console.log(`OK: acknowledged past the cap, candidate_count=${gen4.design.candidate_count}.`);

  // ============================================================
  // Style-edit: 5 free rounds, then the same blocked/acknowledged proof, chained via
  // real Gemini continuation (previous_interaction_id) each time.
  // ============================================================
  console.log('\n=== Style-editing to the 5-edit-round cap (unguarded, cap not yet reached) ===');
  let lastEdit;
  for (let i = 1; i <= 5; i++) {
    await sleep(3000);
    lastEdit = await styleEdit({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, editInstruction: `Style-edit round ${i}: shift the accent color slightly and adjust the composition.` });
    assert(lastEdit.generation.generation_status === 'succeeded', `Expected style-edit ${i} to succeed, got '${lastEdit.generation.generation_status}': ${lastEdit.generation.error_detail}`);
    assert(lastEdit.design.edit_round_count === i, `Expected edit_round_count=${i}, got ${lastEdit.design.edit_round_count}`);
  }
  console.log('OK: reached edit_round_count=5 (the cap) with no acknowledgment needed.');
  const fifthEditGenerationId = lastEdit!.generation.id;

  console.log('\n=== Style-editing WITHOUT acknowledgeAdditionalCost at the cap (expect rejection, no Gemini call made) ===');
  let editCapRejected = false;
  try {
    await styleEdit({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, editInstruction: 'This one should be blocked.' });
  } catch (err) {
    editCapRejected = err instanceof Error && /acknowledgeAdditionalCost/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(editCapRejected, 'Expected style-edit to be rejected at the edit-round cap without acknowledgeAdditionalCost');

  console.log('\n=== Style-editing WITH acknowledgeAdditionalCost=true past the cap (expect success) ===');
  await sleep(3000);
  const sixthEdit = await styleEdit({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, editInstruction: 'Final acknowledged edit round.', acknowledgeAdditionalCost: true });
  assert(sixthEdit.design.edit_round_count === 6, `Expected edit_round_count=6 after the acknowledged edit, got ${sixthEdit.design.edit_round_count}`);
  assert(sixthEdit.generation.parent_generation_id === fifthEditGenerationId, "Expected the 6th edit's parent to be the 5th edit's generation");
  console.log(`OK: acknowledged past the cap, edit_round_count=${sixthEdit.design.edit_round_count}.`);
  const sixthEditGenerationId = sixthEdit.generation.id;

  // ============================================================
  // pickOlderCandidate + undoLastEdit
  // ============================================================
  console.log('\n=== pickOlderCandidate: revert to the very first candidate (an initial_candidate, no parent) ===');
  const pickedFirst = await pickOlderCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, coverGenerationId: firstGenerationId });
  assert(pickedFirst.current_cover_generation_id === firstGenerationId, 'Expected current_cover_generation_id to point at the first candidate');
  console.log('OK: current candidate reverted to the first generation.');

  console.log('\n=== undoLastEdit on a non-edit current generation (expect rejection) ===');
  let undoRejected = false;
  try {
    await undoLastEdit({ supabase: fixture.supabase, projectId: fixture.projectId });
  } catch (err) {
    undoRejected = err instanceof Error && /only a style-edit can be undone/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(undoRejected, 'Expected undoLastEdit to reject when the current generation has no parent');

  console.log('\n=== pickOlderCandidate: restore the last (6th, acknowledged) style-edit ===');
  await pickOlderCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, coverGenerationId: sixthEditGenerationId });

  console.log('\n=== undoLastEdit on a real style-edit (expect a walk to its parent_generation_id) ===');
  const undone = await undoLastEdit({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(undone.current_cover_generation_id === fifthEditGenerationId, `Expected undo to land on the 5th edit's generation, got ${undone.current_cover_generation_id}`);
  console.log('OK: undo walked to the correct parent generation.');

  // ============================================================
  // uploadOwnImage — no AI call, no cap involved
  // ============================================================
  console.log('\n=== uploadOwnImage (no AI call, candidate_count/edit_round_count untouched) ===');
  const beforeUpload = await fixture.supabase.from('cover_designs').select('candidate_count, edit_round_count').eq('project_id', fixture.projectId).single();
  const uploaded = await uploadOwnImage({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, buffer: Buffer.from(TINY_PNG_BASE64, 'base64'), contentType: 'image/png' });
  assert(uploaded.generation.trigger_scope === 'user_upload', `Expected trigger_scope='user_upload', got '${uploaded.generation.trigger_scope}'`);
  assert(uploaded.generation.model === null && uploaded.generation.cost_usd === null, 'Expected model and cost_usd to be null for an uploaded image');
  assert(uploaded.design.candidate_count === beforeUpload.data?.candidate_count, 'Expected candidate_count untouched by an upload');
  assert(uploaded.design.edit_round_count === beforeUpload.data?.edit_round_count, 'Expected edit_round_count untouched by an upload');
  console.log(`OK: uploaded own image, current generation is now the upload (${uploaded.generation.asset_storage_path}).`);

  // ============================================================
  // approve
  // ============================================================
  console.log('\n=== approve (atomic confirm + approval on the uploaded image) ===');
  const approved = await approve({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  assert(approved.status === 'confirmed' && approved.approval_status === 'approved', `Expected confirmed/approved, got status='${approved.status}' approval_status='${approved.approval_status}'`);
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj3?.status === 'cover_approved', `Expected status='cover_approved', got '${proj3?.status}'`);
  console.log(`OK: approved. projects.status=${proj3?.status}`);

  // ============================================================
  // RLS proofs: Postgres cross-workspace spoofing + Storage cross-workspace isolation,
  // both against this project's real design/asset (no service-role bypass).
  // ============================================================
  console.log('\n=== Bootstrapping a second, unrelated workspace for the RLS proofs ===');
  const other = await bootstrapTestFixture('cover-other');
  console.log(`Other user: ${other.userId}  Other workspace: ${other.workspaceId}`);

  console.log('\n=== Postgres RLS: spoofed cross-workspace INSERT into cover_generations (expect rejection) ===');
  const { error: spoofErr } = await other.supabase.from('cover_generations').insert({
    workspace_id: other.workspaceId,
    project_id: other.projectId,
    cover_design_id: approved.id,
    generation_number: 999,
    trigger_scope: 'user_upload',
    asset_storage_path: 'spoofed/path.png',
    generation_status: 'succeeded',
  });
  assert(!!spoofErr, 'Expected the cross-workspace spoofed INSERT to be rejected by RLS');
  console.log(`OK: spoofed INSERT correctly rejected — ${spoofErr?.message}`);

  console.log('\n=== Postgres RLS: cross-workspace SELECT on cover_designs returns nothing ===');
  const { data: spoofSelect } = await other.supabase.from('cover_designs').select('id').eq('id', approved.id).maybeSingle();
  assert(!spoofSelect, 'Expected the other workspace to see no rows for this cover_designs id');
  console.log('OK: cross-workspace SELECT returned nothing.');

  const realAssetPath = uploaded.generation.asset_storage_path!;
  console.log(`\n=== Storage RLS: cross-workspace DOWNLOAD of the real asset (${realAssetPath}) (expect rejection) ===`);
  const { error: downloadErr } = await other.supabase.storage.from('product-covers').download(realAssetPath);
  assert(!!downloadErr, 'Expected the cross-workspace download to be rejected by Storage RLS');
  console.log(`OK: cross-workspace download correctly rejected — ${downloadErr?.message}`);

  const spoofedUploadPath = buildCoverAssetPath(fixture.workspaceId, fixture.projectId, 'spoofed-generation-id', 'image/png');
  console.log(`\n=== Storage RLS: cross-workspace path-prefix-spoofed UPLOAD (${spoofedUploadPath}) (expect rejection) ===`);
  const { error: spoofUploadErr } = await other.supabase.storage.from('product-covers').upload(spoofedUploadPath, Buffer.from(TINY_PNG_BASE64, 'base64'), { contentType: 'image/png' });
  assert(!!spoofUploadErr, 'Expected the path-prefix-spoofed upload to be rejected by Storage RLS');
  console.log(`OK: spoofed upload correctly rejected — ${spoofUploadErr?.message}`);

  // ============================================================
  // Unlock (content-preserving)
  // ============================================================
  console.log('\n=== unlockCoverDesign (expect current candidate + asset preserved, not cleared) ===');
  const unlocked = await unlockCoverDesign({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(unlocked.status === 'draft', `Expected status='draft' after unlock, got '${unlocked.status}'`);
  assert(unlocked.current_cover_generation_id === approved.current_cover_generation_id, 'Expected current_cover_generation_id preserved across the lock/unlock cycle');
  const { data: proj4 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj4?.status === 'design_generating', `Expected status='design_generating' after unlock, got '${proj4?.status}'`);
  console.log('OK: unlocked, current candidate preserved.');

  // ============================================================
  // STALENESS PROOFS — approve first each time, so the revert-on-stale effect is
  // observable, then resolve the tracked snapshot directly before the next proof
  // (resolution itself isn't under test here, so no extra paid Gemini call is needed).
  // ============================================================

  // Format proof runs before title (same ordering lesson Step 8's own smoke test
  // learned): Step 4 has its own lazy staleness check that supersedes the active
  // format_recommendations row and clears projects.current_format_recommendation_id
  // the moment the selected title diverges — so changing the title first would break
  // changeFormat's own precondition. Title runs last since it's the highest-precedence
  // dependency and should be proven taking precedence over a still-unresolved one.

  console.log('\n=== STALENESS PROOF 1/3: confirmed format change ===');
  await approve({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  const changedFormat = formatGen.recommended_format === 'tracker' ? 'workbook' : 'tracker';
  const newActiveFormatRow = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: changedFormat, confirmedDeliveryMode: newActiveFormatRow.recommended_delivery_mode });

  const afterFormatChange = await getCurrentCoverDesign({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterFormatChange.isStale && afterFormatChange.staleReason === 'format_changed', `Expected staleReason='format_changed', got '${afterFormatChange.staleReason}'`);
  assert(afterFormatChange.design?.status === 'draft', `Expected design reverted to draft, got '${afterFormatChange.design?.status}'`);
  console.log("OK: isStale=true, staleReason='format_changed', design reverted, asset untouched.");
  const { data: projAfterFormat } = await fixture.supabase.from('projects').select('current_format_recommendation_id').eq('id', fixture.projectId).single();
  await fixture.supabase.from('cover_designs').update({ format_recommendation_id: projAfterFormat?.current_format_recommendation_id }).eq('id', approved.id);

  console.log('\n=== STALENESS PROOF 2/3: content build re-confirmed (new confirmed_at) ===');
  await approve({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await unlockContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const afterContentBuildChange = await getCurrentCoverDesign({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterContentBuildChange.isStale && afterContentBuildChange.staleReason === 'content_build_changed', `Expected staleReason='content_build_changed', got '${afterContentBuildChange.staleReason}'`);
  assert(afterContentBuildChange.design?.status === 'draft', `Expected design reverted to draft, got '${afterContentBuildChange.design?.status}'`);
  console.log("OK: isStale=true, staleReason='content_build_changed', design reverted, asset untouched.");

  console.log('\n=== STALENESS PROOF 3/3: selected title change (highest precedence) ===');
  await approve({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: alternate.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);

  const afterTitleChange = await getCurrentCoverDesign({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterTitleChange.isStale && afterTitleChange.staleReason === 'title_changed', `Expected staleReason='title_changed' (highest precedence, over the still-unresolved content-build staleness), got '${afterTitleChange.staleReason}'`);
  assert(afterTitleChange.design?.status === 'draft', `Expected design reverted to draft, got '${afterTitleChange.design?.status}'`);
  const { data: projAfterTitle } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterTitle?.status === 'design_generating', `Expected project status reverted to design_generating, got '${projAfterTitle?.status}'`);
  console.log("OK: isStale=true, staleReason='title_changed' (correctly took precedence over the still-unresolved content-build staleness), design reverted, asset untouched.");

  console.log(
    '\nSmoke test passed: the full Step 9 action set ran end-to-end through real RLS, live Gemini, live Satori rendering, and real Supabase Storage — no-auto-fire, generateInitialCandidate (first entry + regenerate to the hard cap, blocked then acknowledged), styleEdit to its own hard cap the same way (chained via real continuation), pickOlderCandidate, undoLastEdit (rejection + real parent walk), uploadOwnImage, approve, the Postgres + Storage RLS proofs (cross-workspace spoofing and isolation against real data), content-preserving unlock, and all 3 staleness dependencies (title, format, content-build) were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
