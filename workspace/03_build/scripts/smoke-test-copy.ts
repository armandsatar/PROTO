// End-to-end Step 10 smoke test: chains real Steps 2-9 (mock Etsy, live Groq, live
// Gemini/Satori/Storage for Step 9's cover) into Step 10's complete action set against
// real RLS, no service-role bypass. Sequence: assert NO auto-fire -> generateCopy
// (narrative + all 6 platforms, first entry) -> edit narrative (no cascade, all 6
// platforms flagged stale-relative-to-narrative) -> regenerate all platforms (re-adapts
// from the edited narrative, narrative itself untouched, staleness clears) -> manual
// edit of one platform -> regenerate-one (unguarded + guarded) -> the hard-limit block
// proof (force an over-limit Etsy title, confirm rejected, fix it, confirm succeeds) ->
// RLS proof (cross-workspace spoofed insert rejected) -> unlock (content preserved) ->
// all 6 document-level staleness dependencies in the completed precedence order
// (lowest first, title last, so title's proof visibly overrides a still-unresolved
// lower dependency). Makes ~31 real, free Groq calls plus one real, billable Gemini
// call to reach cover_approved. Run with: npm run smoke:copy
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation, changeFormat } from '../lib/format/runFormatRecommendation';
import { generateLeadMagnetRecommendation, confirmLeadMagnetRecommendation } from '../lib/leadmagnet/runLeadMagnetCheck';
import { generateOrRegenerateTransformationMap, confirmTransformationMap, unlockTransformationMap, editTransformationMapField } from '../lib/transformationmap/runTransformationMap';
import { generateOrRegenerateSubtopicList, confirmSubtopicList, unlockSubtopicList } from '../lib/subtopics/runSubtopicGeneration';
import { generateContent, confirmContentBuild, unlockContentBuild } from '../lib/content/runContentGeneration';
import { generateInitialCandidate, approve as approveCover } from '../lib/cover';
import {
  generateCopy,
  editNarrative,
  regenerateNarrative,
  editPlatformCopy,
  regenerateOnePlatformCopy,
  confirmCopywritingBuild,
  unlockCopywritingBuild,
  getCurrentCopywritingBuild,
} from '../lib/copywriting';
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

function findPlatform<T extends { platform: string }>(rows: T[], platform: string): T {
  const row = rows.find((r) => r.platform === platform);
  if (!row) throw new Error(`Expected a "${platform}" row, found none`);
  return row;
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('copy');
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

  console.log('\n=== Step 9: one real cover candidate + approve (reaching cover_approved) ===');
  const coverGen = await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(coverGen.generation.generation_status === 'succeeded', `Expected the cover candidate to succeed, got '${coverGen.generation.generation_status}'`);
  await approveCover({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj1?.status === 'cover_approved', `Expected status='cover_approved', got '${proj1?.status}'`);
  console.log('OK: reached cover_approved.');

  // ============================================================
  // THE NO-AUTO-FIRE PROOF (decision 2) — must come before anything else touches Step 10
  // ============================================================
  console.log('\n=== PROOF: Step 10 does NOT auto-fire on cover_approved ===');
  const { data: noBuildYet } = await fixture.supabase.from('copywriting_builds').select('id').eq('project_id', fixture.projectId).maybeSingle();
  assert(!noBuildYet, 'Expected NO copywriting_builds row to exist yet — Step 10 must never auto-fire');
  console.log('OK: no copywriting_builds row exists — Step 10 correctly did not auto-fire.');

  // ============================================================
  // generateCopy (first entry): narrative + all 6 platforms, live Groq
  // ============================================================
  console.log('\n=== generateCopy (explicit first entry): narrative + all 6 platform adaptations (live Groq) ===');
  await sleep(3000);
  const gen1 = await generateCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(gen1.platformCopies.length === 6, `Expected 6 real platform rows, got ${gen1.platformCopies.length}`);
  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj2?.status === 'copy_generating', `Expected status='copy_generating', got '${proj2?.status}'`);

  const etsyRow1 = findPlatform(gen1.platformCopies, 'etsy');
  assert(etsyRow1.title !== null, 'Expected Etsy to have a title');
  assert((etsyRow1.platform_fields as { tags?: string[] }).tags !== undefined, 'Expected Etsy to have tags in platform_fields');
  const instagramRow1 = findPlatform(gen1.platformCopies, 'instagram');
  assert(instagramRow1.title === null, 'Expected Instagram to have no title');
  console.log(`OK: narrative + 6 platforms generated. Etsy title="${etsyRow1.title}", Instagram caption length=${instagramRow1.body.length}.`);

  const { data: narrativeRow1 } = await fixture.supabase.from('platform_copies').select('*').eq('copywriting_build_id', gen1.build.id).eq('platform', 'narrative').single();
  assert(narrativeRow1?.content_status === 'generated', `Expected narrative content_status='generated', got '${narrativeRow1?.content_status}'`);

  // ============================================================
  // Edit narrative (no cascade) — all 6 platforms flagged stale-relative-to-narrative
  // ============================================================
  console.log('\n=== editNarrative (manual edit, expect NO cascade to the 6 platforms) ===');
  const editedNarrativeFields = {
    hook: 'MANUALLY EDITED hook for the smoke test.',
    transformationStory: narrativeRow1.platform_fields.transformation_story,
    cta: narrativeRow1.platform_fields.cta,
    summary: narrativeRow1.platform_fields.summary,
  };
  await editNarrative({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, fields: editedNarrativeFields });

  const afterNarrativeEdit = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterNarrativeEdit.staleNarrativePlatforms.length === 6, `Expected all 6 platforms flagged stale-relative-to-narrative, got ${afterNarrativeEdit.staleNarrativePlatforms.length}`);
  const stillSameEtsyRow = findPlatform(afterNarrativeEdit.platformCopies, 'etsy');
  assert(stillSameEtsyRow.title === etsyRow1.title, 'Expected the Etsy row to be completely untouched by the narrative edit (no cascade)');
  console.log(`OK: all 6 platforms flagged stale-relative-to-narrative, no platform text touched (no cascade) — Etsy title unchanged: "${stillSameEtsyRow.title}".`);

  // ============================================================
  // Regenerate all platforms — re-adapts from the edited narrative, staleness clears
  // ============================================================
  console.log('\n=== generateCopy (regenerate-all): re-adapts all 6 from the edited narrative, narrative itself untouched ===');
  await sleep(3000);
  const gen2 = await generateCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(gen2.build.regenerate_count === 1, `Expected regenerate_count=1, got ${gen2.build.regenerate_count}`);
  const { data: narrativeRow2 } = await fixture.supabase.from('platform_copies').select('platform_fields, updated_at').eq('copywriting_build_id', gen1.build.id).eq('platform', 'narrative').single();
  assert(narrativeRow2?.platform_fields.hook === editedNarrativeFields.hook, 'Expected the narrative to remain the hand-edited version after regenerate-all');

  const afterRegenAll = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterRegenAll.staleNarrativePlatforms.length === 0, `Expected 0 platforms flagged stale after regenerate-all, got ${afterRegenAll.staleNarrativePlatforms.length}`);
  console.log('OK: all 6 platforms re-adapted from the edited narrative, narrative itself untouched, staleness cleared.');

  // ============================================================
  // Manual edit of one platform + regenerate-one (unguarded + guarded)
  // ============================================================
  console.log('\n=== editPlatformCopy: manual edit of Gumroad (no confirmed hard limit, safe to hand-author) ===');
  const editedGumroad = await editPlatformCopy({ supabase: fixture.supabase, projectId: fixture.projectId, platform: 'gumroad', userId: fixture.userId, title: 'HAND-EDITED Gumroad Title', body: 'Hand-edited Gumroad description for the smoke test.' });
  assert(editedGumroad.is_edited === true, 'Expected is_edited=true after a manual edit');

  console.log('\n=== regenerateOnePlatformCopy on Pinterest (untouched, no acknowledgeOverwrite needed) ===');
  await sleep(3000);
  const regenPinterest = await regenerateOnePlatformCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, platform: 'pinterest' });
  assert(regenPinterest.is_edited === false, 'Expected is_edited=false after an unguarded regenerate');

  console.log('\n=== regenerateOnePlatformCopy on Gumroad WITHOUT acknowledgeOverwrite (expect rejection) ===');
  let regenGumroadRejected = false;
  try {
    await regenerateOnePlatformCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, platform: 'gumroad' });
  } catch (err) {
    regenGumroadRejected = err instanceof Error && /acknowledgeOverwrite/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(regenGumroadRejected, 'Expected regenerate-one to be rejected without acknowledgeOverwrite on an edited row');

  console.log('\n=== regenerateOnePlatformCopy on Gumroad WITH acknowledgeOverwrite=true (expect overwrite) ===');
  await sleep(3000);
  const regenGumroadAcked = await regenerateOnePlatformCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, platform: 'gumroad', acknowledgeOverwrite: true });
  assert(regenGumroadAcked.is_edited === false, 'Expected is_edited reset to false after acknowledged regenerate');
  assert(regenGumroadAcked.title !== 'HAND-EDITED Gumroad Title', 'Expected the hand-edited title to have been overwritten');
  console.log('OK: hand-edit overwritten, is_edited reset.');

  // ============================================================
  // Regenerate narrative (its own action, no cascade, does not bump regenerate_count)
  // ============================================================
  console.log('\n=== regenerateNarrative: its own action, independent of platform regenerate, does not bump regenerate_count ===');
  // acknowledgeOverwrite=true: the narrative is still is_edited=true from the earlier
  // editNarrative call above (regenerate-all only ever touches platforms, never the
  // narrative itself, so that edit flag has never been cleared since).
  await sleep(3000);
  const regenNarrative = await regenerateNarrative({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, acknowledgeOverwrite: true });
  assert(regenNarrative.build.regenerate_count === 1, `Expected regenerate_count to stay at 1 (unchanged by narrative-only regenerate), got ${regenNarrative.build.regenerate_count}`);
  const afterNarrativeRegen = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterNarrativeRegen.staleNarrativePlatforms.length === 6, 'Expected all 6 platforms flagged stale again after a fresh narrative regenerate');
  console.log('OK: narrative regenerated independently, regenerate_count unchanged, all 6 platforms flagged stale again.');

  // Resolve the narrative staleness before moving on, so it doesn't mask later proofs.
  await sleep(3000);
  await generateCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, acknowledgeOverwrite: true });

  // ============================================================
  // The hard-limit block proof (decision 4) — the first confirm-blocking guardrail
  // in this codebase beyond a pure existence check.
  // ============================================================
  console.log('\n=== Hard-limit block proof: force an over-limit Etsy title, confirm rejected, fix it, confirm succeeds ===');
  const { data: etsyRow } = await fixture.supabase.from('platform_copies').select('id').eq('copywriting_build_id', gen1.build.id).eq('platform', 'etsy').single();
  await fixture.supabase.from('platform_copies').update({ title: 'x'.repeat(160), hard_limit_status: 'exceeds_limit' }).eq('id', etsyRow!.id);

  let confirmRejected = false;
  try {
    await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  } catch (err) {
    confirmRejected = err instanceof Error && /etsy/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(confirmRejected, 'Expected confirm to be rejected while Etsy exceeds its hard limit');

  await fixture.supabase.from('platform_copies').update({ title: 'A short, valid Etsy title', hard_limit_status: 'within_limit' }).eq('id', etsyRow!.id);
  const confirmed1 = await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  assert(confirmed1.status === 'confirmed', `Expected status='confirmed' after fixing the hard-limit violation, got '${confirmed1.status}'`);
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj3?.status === 'copy_confirmed', `Expected status='copy_confirmed', got '${proj3?.status}'`);
  console.log('OK: confirm blocked while over the hard limit, then succeeded once fixed.');

  // ============================================================
  // RLS proof: cross-workspace spoofed insert rejected
  // ============================================================
  console.log('\n=== Bootstrapping a second, unrelated workspace for the RLS proof ===');
  const other = await bootstrapTestFixture('copy-other');

  console.log('\n=== Postgres RLS: spoofed cross-workspace INSERT into platform_copies (expect rejection) ===');
  const { error: spoofErr } = await other.supabase.from('platform_copies').insert({
    workspace_id: other.workspaceId,
    project_id: other.projectId,
    copywriting_build_id: confirmed1.id,
    platform: 'instagram',
    body: 'spoofed caption',
  });
  assert(!!spoofErr, 'Expected the cross-workspace spoofed INSERT to be rejected by RLS');
  console.log(`OK: spoofed INSERT correctly rejected — ${spoofErr?.message}`);

  const { data: spoofSelect } = await other.supabase.from('copywriting_builds').select('id').eq('id', confirmed1.id).maybeSingle();
  assert(!spoofSelect, 'Expected the other workspace to see no rows for this copywriting_builds id');
  console.log('OK: cross-workspace SELECT returned nothing.');

  // ============================================================
  // Unlock (content-preserving)
  // ============================================================
  console.log('\n=== unlockCopywritingBuild (expect content preserved, not cleared) ===');
  const unlocked = await unlockCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(unlocked.status === 'draft', `Expected status='draft' after unlock, got '${unlocked.status}'`);
  const { data: afterUnlockEtsy } = await fixture.supabase.from('platform_copies').select('title').eq('id', etsyRow!.id).single();
  assert(afterUnlockEtsy?.title === 'A short, valid Etsy title', 'Expected the fixed Etsy title to survive the lock/unlock cycle byte-for-byte');
  const { data: proj4 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj4?.status === 'copy_generating', `Expected status='copy_generating' after unlock, got '${proj4?.status}'`);
  console.log('OK: unlocked, content preserved.');

  // ============================================================
  // STALENESS PROOFS — lowest precedence first, title last (highest), each confirmed
  // first so the revert-on-stale effect is observable, resolved via a raw snapshot
  // resync between proofs (no extra paid API call — resolution itself isn't under test).
  // ============================================================

  console.log('\n=== STALENESS PROOF 1/6: cover look change (lowest precedence) ===');
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await fixture.supabase.from('cover_designs').update({ confirmed_look_id: 'placeholder-bold-01' }).eq('project_id', fixture.projectId);

  const afterCoverLook = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterCoverLook.documentStaleReason === 'cover_look_changed', `Expected 'cover_look_changed', got '${afterCoverLook.documentStaleReason}'`);
  assert(afterCoverLook.build?.status === 'draft', `Expected build reverted to draft, got '${afterCoverLook.build?.status}'`);
  console.log("OK: isStale=true, documentStaleReason='cover_look_changed', build reverted, content untouched.");
  await fixture.supabase.from('copywriting_builds').update({ cover_look_snapshot: 'placeholder-bold-01' }).eq('id', confirmed1.id);

  console.log('\n=== STALENESS PROOF 2/6: content build re-confirmed ===');
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await unlockContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  const reconfirmedContent = await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const afterContentBuild = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterContentBuild.documentStaleReason === 'content_build_changed', `Expected 'content_build_changed', got '${afterContentBuild.documentStaleReason}'`);
  assert(afterContentBuild.build?.status === 'draft', `Expected build reverted to draft, got '${afterContentBuild.build?.status}'`);
  console.log("OK: isStale=true, documentStaleReason='content_build_changed', build reverted, content untouched.");
  await fixture.supabase.from('copywriting_builds').update({ content_build_confirmed_at: reconfirmedContent.confirmed_at }).eq('id', confirmed1.id);

  console.log('\n=== STALENESS PROOF 3/6: confirmed subtopics list re-confirmed (the build-time gap-fill) ===');
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await unlockSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId });
  const reconfirmedSubtopics = await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const afterSubtopicsList = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterSubtopicsList.documentStaleReason === 'subtopics_list_changed', `Expected 'subtopics_list_changed', got '${afterSubtopicsList.documentStaleReason}'`);
  assert(afterSubtopicsList.build?.status === 'draft', `Expected build reverted to draft, got '${afterSubtopicsList.build?.status}'`);
  console.log("OK: isStale=true, documentStaleReason='subtopics_list_changed' — the gap the original requirements draft left unoperationalized is now live-proven.");
  await fixture.supabase.from('copywriting_builds').update({ subtopic_list_confirmed_at: reconfirmedSubtopics.confirmed_at }).eq('id', confirmed1.id);

  console.log('\n=== STALENESS PROOF 4/6: transformation map content change ===');
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await unlockTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId });
  const editedMap = await editTransformationMapField({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, updates: { dimPracticalBefore: 'SMOKE-TEST EDIT: changing the map content to trigger Step 10 map staleness.' } });
  await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const afterMap = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterMap.documentStaleReason === 'transformation_map_changed', `Expected 'transformation_map_changed', got '${afterMap.documentStaleReason}'`);
  assert(afterMap.build?.status === 'draft', `Expected build reverted to draft, got '${afterMap.build?.status}'`);
  console.log("OK: isStale=true, documentStaleReason='transformation_map_changed', build reverted, content untouched.");
  await fixture.supabase.from('copywriting_builds').update({ transformation_map_snapshot_at: editedMap.updated_at }).eq('id', confirmed1.id);

  console.log('\n=== STALENESS PROOF 5/6: confirmed format change ===');
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  const changedFormat = formatGen.recommended_format === 'tracker' ? 'workbook' : 'tracker';
  const newActiveFormatRow = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: changedFormat, confirmedDeliveryMode: newActiveFormatRow.recommended_delivery_mode });

  const afterFormat = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterFormat.documentStaleReason === 'format_changed', `Expected 'format_changed', got '${afterFormat.documentStaleReason}'`);
  assert(afterFormat.build?.status === 'draft', `Expected build reverted to draft, got '${afterFormat.build?.status}'`);
  console.log("OK: isStale=true, documentStaleReason='format_changed', build reverted, content untouched.");
  const { data: projAfterFormat } = await fixture.supabase.from('projects').select('current_format_recommendation_id').eq('id', fixture.projectId).single();
  await fixture.supabase.from('copywriting_builds').update({ format_recommendation_id: projAfterFormat?.current_format_recommendation_id }).eq('id', confirmed1.id);

  console.log('\n=== STALENESS PROOF 6/6: selected title change (highest precedence) ===');
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });
  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: alternate.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);

  const afterTitle = await getCurrentCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterTitle.documentStaleReason === 'title_changed', `Expected 'title_changed' (highest precedence, over any still-unresolved lower dependency), got '${afterTitle.documentStaleReason}'`);
  assert(afterTitle.build?.status === 'draft', `Expected build reverted to draft, got '${afterTitle.build?.status}'`);
  const { data: projAfterTitle } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterTitle?.status === 'copy_generating', `Expected status='copy_generating', got '${projAfterTitle?.status}'`);
  console.log("OK: isStale=true, documentStaleReason='title_changed' — correctly took precedence, build reverted, content untouched.");

  console.log(
    '\nSmoke test passed: the full Step 10 action set ran end-to-end through real RLS and live Groq — no-auto-fire, the narrative-then-adapt two-phase generation, the narrative edit/regenerate actions with no cascade, regenerate-all re-adapting from the current narrative, per-platform manual edit and regenerate (unguarded + guarded), the hard-limit confirm-block proof, the RLS proof, content-preserving unlock, and all 6 document-level staleness dependencies (including the build-time subtopics-list gap-fill) in the completed precedence order were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
