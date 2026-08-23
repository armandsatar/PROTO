import type { SupabaseClient } from '@supabase/supabase-js';
import { generateWriterPass, type GenerateWriterPassInput } from './generateWriterPass';
import { generateReviewPass } from './generateReviewPass';
import { writerFailureFallback } from './fallback';
import { GROQ_MODEL } from '../ai/groq';
import { hasReachedRegenerateCap, wordCountTargetForFormatAndDepth, detectDocumentStalenessReason, isSubtopicContentStale, type DocumentStalenessReason } from './rules';
import type { FormatType, SubtopicDepth, SubtopicSnapshot, ContentStatus, ContentTriggerScope, ContentGenerationStatus } from './types';

export interface ContentBuildRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  transformation_map_snapshot_at: string;
  subtopic_list_confirmed_at: string;
  confirmed_format: FormatType;
  status: 'draft' | 'confirmed';
  confirmed_at: string | null;
  confirmed_by: string | null;
  regenerate_count: number;
  created_at: string;
  updated_at: string;
}

export interface SubtopicContentRow {
  id: string;
  workspace_id: string;
  project_id: string;
  content_build_id: string;
  subtopic_id: string;
  body: string;
  word_count: number;
  target_word_min: number;
  target_word_max: number;
  content_status: ContentStatus;
  source_generation_id: string | null;
  is_edited: boolean;
  compliance_reviewed: boolean;
  quality_flag: 'clean' | 'below_specificity_threshold';
  last_edited_at: string | null;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SubtopicRowLite {
  id: string;
  title: string;
  description: string;
  depth: SubtopicDepth;
  display_order: number;
}

interface LoadedGenerationContext {
  candidate: { id: string; candidate_text: string };
  rationale: string;
  formatRec: { id: string; confirmed_format: FormatType; confirmed_delivery_mode: string | null };
  map: { updated_at: string } & Omit<
    GenerateWriterPassInput,
    'title' | 'rationale' | 'confirmedFormat' | 'confirmedDeliveryMode' | 'subtopicTitle' | 'subtopicDescription' | 'subtopicDepth' | 'siblingSubtopicTitles'
  >;
  subtopicListConfirmedAt: string;
  subtopics: SubtopicRowLite[];
}

/**
 * §6.1's inputs, loaded fresh from live upstream state — deliberately excludes
 * demand/competition signals and the lead magnet decision (unlike Steps 4-7), per the
 * requirements doc's own resolution that those add no new signal at the prose-writing
 * stage once the subtopic itself is already locked in.
 */
async function loadGenerationContext(supabase: SupabaseClient, projectId: string): Promise<LoadedGenerationContext> {
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.selected_candidate_id) throw new Error('Project has no selected title candidate');
  if (!project.current_format_recommendation_id) throw new Error('Project has no confirmed format recommendation');

  const { data: candidate, error: candidateErr } = await supabase
    .from('title_candidates')
    .select('id, candidate_text')
    .eq('id', project.selected_candidate_id)
    .single();
  if (candidateErr || !candidate) throw new Error(`Selected title candidate not found: ${candidateErr?.message}`);

  const { data: idea, error: ideaErr } = await supabase.from('title_ideas').select('rationale').eq('project_id', projectId).single();
  if (ideaErr || !idea) throw new Error(`title_ideas row not found for project: ${ideaErr?.message}`);

  const { data: formatRec, error: formatErr } = await supabase
    .from('format_recommendations')
    .select('id, confirmed_format, confirmed_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (formatErr || !formatRec) throw new Error(`Confirmed format recommendation not found: ${formatErr?.message}`);

  const { data: map, error: mapErr } = await supabase
    .from('transformation_maps')
    .select(
      'updated_at, headline_before, headline_after, dim_emotional_before, dim_emotional_after, dim_practical_before, dim_practical_after, dim_identity_before, dim_identity_after, dim_pain_point_before, dim_pain_point_after',
    )
    .eq('project_id', projectId)
    .single();
  if (mapErr || !map) throw new Error(`Transformation map not found for project: ${mapErr?.message}`);

  const { data: subtopicList, error: listErr } = await supabase
    .from('subtopic_lists')
    .select('confirmed_at, updated_at')
    .eq('project_id', projectId)
    .single();
  if (listErr || !subtopicList) {
    throw new Error(`Subtopics list not found for project: ${listErr?.message ?? 'not found'}`);
  }
  // Falls back to updated_at when the list is currently unconfirmed — this loader is
  // also used by backfillNewSubtopicContent (increment 5), which by definition only
  // fires while Step 7's list is unlocked post-confirm (confirmed_at is null then,
  // per unlockSubtopicList). Decision 25 explicitly leaves the Step 7/Step 8 unlock
  // interaction unresolved rather than blocking on it here.
  const subtopicListSnapshotAt = subtopicList.confirmed_at ?? subtopicList.updated_at;

  const { data: subtopics, error: subtopicsErr } = await supabase
    .from('subtopics')
    .select('id, title, description, depth, display_order')
    .eq('project_id', projectId)
    .order('display_order', { ascending: true });
  if (subtopicsErr) throw new Error(`Failed to load subtopics: ${subtopicsErr.message}`);
  if (!subtopics || subtopics.length === 0) throw new Error('Project has no subtopics to generate content for');

  return {
    candidate,
    rationale: idea.rationale,
    formatRec,
    map: {
      updated_at: map.updated_at,
      headlineBefore: map.headline_before,
      headlineAfter: map.headline_after,
      dimEmotionalBefore: map.dim_emotional_before,
      dimEmotionalAfter: map.dim_emotional_after,
      dimPracticalBefore: map.dim_practical_before,
      dimPracticalAfter: map.dim_practical_after,
      dimIdentityBefore: map.dim_identity_before,
      dimIdentityAfter: map.dim_identity_after,
      dimPainPointBefore: map.dim_pain_point_before,
      dimPainPointAfter: map.dim_pain_point_after,
    },
    subtopicListConfirmedAt: subtopicListSnapshotAt,
    subtopics: subtopics as SubtopicRowLite[],
  };
}

async function nextGenerationNumber(supabase: SupabaseClient, contentBuildId: string, subtopicId: string): Promise<number> {
  const { data } = await supabase
    .from('content_generations')
    .select('generation_number')
    .eq('content_build_id', contentBuildId)
    .eq('subtopic_id', subtopicId)
    .order('generation_number', { ascending: false })
    .limit(1);
  return (data?.[0]?.generation_number ?? 0) + 1;
}

interface GenerateOneParams {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  buildId: string;
  subtopic: SubtopicRowLite;
  siblingTitles: string[];
  ctx: LoadedGenerationContext;
  triggerScope: ContentTriggerScope;
  existingContentId?: string;
}

/**
 * Generates and persists content for ONE subtopic — shared by generateContent's loop
 * (both first-entry and regenerate-all), regenerateOneSubtopicContent, and
 * backfillNewSubtopicContent (increment 5). Inserts when `existingContentId` is
 * absent (first-entry), updates in place otherwise (regenerate-all/regenerate-one) —
 * subtopic_contents is a fixed 1:1 satellite of `subtopics`, never deleted/reinserted
 * the way Step 7's variable-length list was.
 */
async function generateAndPersistOneSubtopicContent(params: GenerateOneParams): Promise<SubtopicContentRow> {
  const { supabase, workspaceId, projectId, buildId, subtopic, siblingTitles, ctx, triggerScope, existingContentId } = params;

  const target = wordCountTargetForFormatAndDepth(ctx.formatRec.confirmed_format, subtopic.depth);
  const generationNumber = await nextGenerationNumber(supabase, buildId, subtopic.id);

  const writerInput: GenerateWriterPassInput = {
    title: ctx.candidate.candidate_text,
    rationale: ctx.rationale,
    confirmedFormat: ctx.formatRec.confirmed_format,
    confirmedDeliveryMode: ctx.formatRec.confirmed_delivery_mode,
    ...ctx.map,
    subtopicTitle: subtopic.title,
    subtopicDescription: subtopic.description,
    subtopicDepth: subtopic.depth,
    siblingSubtopicTitles: siblingTitles,
  };

  const subtopicSnapshot: SubtopicSnapshot = { title: subtopic.title, description: subtopic.description, depth: subtopic.depth };
  const inputsSnapshot = {
    title: writerInput.title,
    rationale: writerInput.rationale,
    confirmed_format: writerInput.confirmedFormat,
    confirmed_delivery_mode: writerInput.confirmedDeliveryMode,
    transformation_map: {
      headline_before: writerInput.headlineBefore,
      headline_after: writerInput.headlineAfter,
      dim_emotional_before: writerInput.dimEmotionalBefore,
      dim_emotional_after: writerInput.dimEmotionalAfter,
      dim_practical_before: writerInput.dimPracticalBefore,
      dim_practical_after: writerInput.dimPracticalAfter,
      dim_identity_before: writerInput.dimIdentityBefore,
      dim_identity_after: writerInput.dimIdentityAfter,
      dim_pain_point_before: writerInput.dimPainPointBefore,
      dim_pain_point_after: writerInput.dimPainPointAfter,
    },
    sibling_subtopic_titles: siblingTitles,
    target_word_min: target.min,
    target_word_max: target.max,
  };

  let body = '';
  let contentStatus: ContentStatus = 'failed_empty';
  let generationStatus: ContentGenerationStatus;
  let complianceReviewed = false;
  let qualityFlag: 'clean' | 'below_specificity_threshold' = 'clean';
  let draftContentSnapshot: string | null = null;
  let outputSnapshot: string | null = null;
  let specificityScore: number | null = null;
  let complianceStatus: 'no_changes_needed' | 'changes_applied' | 'review_pass_failed' = 'no_changes_needed';
  let complianceChangesToInsert: { originalText: string; rewrittenText: string; reason: string; riskCategory: string; detectedBy: string }[] = [];

  try {
    const writerResult = await generateWriterPass(writerInput, target);
    draftContentSnapshot = writerResult.content;
    generationStatus = writerResult.meetsLengthTarget ? 'succeeded' : 'succeeded_outside_length_target';

    try {
      const reviewResult = await generateReviewPass({
        title: writerInput.title,
        subtopicTitle: subtopic.title,
        subtopicDescription: subtopic.description,
        draftContent: writerResult.content,
      });
      body = reviewResult.finalContent;
      contentStatus = 'generated';
      complianceReviewed = true;
      qualityFlag = reviewResult.meetsSpecificityThreshold ? 'clean' : 'below_specificity_threshold';
      outputSnapshot = reviewResult.finalContent;
      specificityScore = reviewResult.specificityScore;
      complianceStatus = reviewResult.complianceChanges.length === 0 ? 'no_changes_needed' : 'changes_applied';
      complianceChangesToInsert = reviewResult.complianceChanges.map((c) => ({
        originalText: c.originalText,
        rewrittenText: c.rewrittenText,
        reason: c.reason,
        riskCategory: c.riskCategory,
        detectedBy: c.detectedBy,
      }));
    } catch {
      // Review-pass-only failure: keep the writer's draft, don't discard real content.
      body = writerResult.content;
      contentStatus = 'generated';
      complianceReviewed = false;
      complianceStatus = 'review_pass_failed';
      outputSnapshot = null;
    }
  } catch {
    // Total writer-pass failure: honest empty body, no fallback content fabricated.
    body = writerFailureFallback();
    contentStatus = 'failed_empty';
    generationStatus = 'failed_fallback';
  }

  const { data: newGeneration, error: genInsertErr } = await supabase
    .from('content_generations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      content_build_id: buildId,
      subtopic_id: subtopic.id,
      generation_number: generationNumber,
      trigger_scope: triggerScope,
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      subtopic_list_confirmed_at: ctx.subtopicListConfirmedAt,
      subtopic_snapshot: subtopicSnapshot,
      inputs_snapshot: inputsSnapshot,
      draft_content_snapshot: draftContentSnapshot,
      output_snapshot: outputSnapshot,
      specificity_score: specificityScore,
      compliance_status: complianceStatus,
      model: generationStatus! === 'failed_fallback' ? 'fallback-empty-content' : GROQ_MODEL,
      generation_status: generationStatus!,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genInsertErr || !newGeneration) throw new Error(`Failed to persist content generation row: ${genInsertErr?.message}`);

  const wordCount = body.trim().length === 0 ? 0 : body.trim().split(/\s+/).filter(Boolean).length;

  let contentRow: SubtopicContentRow;
  if (existingContentId) {
    const { data: updated, error: updateErr } = await supabase
      .from('subtopic_contents')
      .update({
        body,
        word_count: wordCount,
        target_word_min: target.min,
        target_word_max: target.max,
        content_status: contentStatus,
        source_generation_id: newGeneration.id,
        is_edited: false,
        compliance_reviewed: complianceReviewed,
        quality_flag: qualityFlag,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingContentId)
      .select()
      .single();
    if (updateErr || !updated) throw new Error(`Failed to update subtopic content: ${updateErr?.message}`);
    contentRow = updated as SubtopicContentRow;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('subtopic_contents')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        content_build_id: buildId,
        subtopic_id: subtopic.id,
        body,
        word_count: wordCount,
        target_word_min: target.min,
        target_word_max: target.max,
        content_status: contentStatus,
        source_generation_id: newGeneration.id,
        is_edited: false,
        compliance_reviewed: complianceReviewed,
        quality_flag: qualityFlag,
      })
      .select()
      .single();
    if (insertErr || !inserted) throw new Error(`Failed to insert subtopic content: ${insertErr?.message}`);
    contentRow = inserted as SubtopicContentRow;
  }

  if (complianceChangesToInsert.length > 0) {
    const { error: changesErr } = await supabase.from('content_compliance_changes').insert(
      complianceChangesToInsert.map((c) => ({
        workspace_id: workspaceId,
        project_id: projectId,
        content_generation_id: newGeneration.id,
        subtopic_content_id: contentRow.id,
        original_text: c.originalText,
        rewritten_text: c.rewrittenText,
        reason: c.reason,
        risk_category: c.riskCategory,
        detected_by: c.detectedBy,
      })),
    );
    if (changesErr) throw new Error(`Failed to persist compliance change rows: ${changesErr.message}`);
  }

  return contentRow;
}

interface GenerateContentParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  /** Required (must be true) to regenerate over content where any row is edited/manual — decision 12's safety rail. */
  acknowledgeOverwrite?: boolean;
}

export interface GenerateContentResult {
  build: ContentBuildRow;
  contents: SubtopicContentRow[];
}

/**
 * §1.8's "Explicit Generate" action — first-entry and whole-document Regenerate
 * combined, same dual-purpose shape every prior phase's generate function used.
 * NEVER auto-fires (decision 18) — this must be called explicitly; reaching
 * `subtopics_confirmed` alone leaves everything untouched. Loops the same per-subtopic
 * writer+review call pair across every confirmed subtopic — real API rate limits (a
 * live finding from increment 3's smoke test) mean a large document's full generation
 * can take a while; no artificial pacing is added here since that's a real product
 * decision (queueing/throttling UX) out of scope for this increment, not something to
 * silently bake into the orchestration layer.
 */
export async function generateContent(params: GenerateContentParams): Promise<GenerateContentResult> {
  const { supabase, projectId, workspaceId, acknowledgeOverwrite } = params;

  const { data: project, error: projectErr } = await supabase.from('projects').select('status').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: existingBuild, error: existingErr } = await supabase
    .from('content_builds')
    .select('id, status, regenerate_count')
    .eq('project_id', projectId)
    .maybeSingle();
  if (existingErr) throw new Error(`Failed to check for existing content build: ${existingErr.message}`);

  const isRegenerate = !!existingBuild;
  if (!isRegenerate && project.status !== 'subtopics_confirmed') {
    throw new Error('Project has not reached subtopics_confirmed — cannot generate content yet (decision 18: no auto-fire, this must be called explicitly)');
  }

  if (isRegenerate) {
    if (existingBuild.status === 'confirmed') {
      throw new Error('Cannot regenerate a confirmed content build directly — unlock it first');
    }
    if (hasReachedRegenerateCap(existingBuild.regenerate_count)) {
      throw new Error('Whole-document regenerate cap reached for this project (decision 14)');
    }

    const { data: existingRows, error: rowsErr } = await supabase
      .from('subtopic_contents')
      .select('is_edited, content_status')
      .eq('content_build_id', existingBuild.id);
    if (rowsErr) throw new Error(`Failed to check existing content for hand-edits: ${rowsErr.message}`);

    const hasHandCuration = (existingRows ?? []).some((row) => row.is_edited || row.content_status === 'manual');
    if (hasHandCuration && acknowledgeOverwrite !== true) {
      throw new Error('This content has edited or manually-written rows — pass acknowledgeOverwrite=true to confirm overwriting them (decision 12)');
    }
  }

  const ctx = await loadGenerationContext(supabase, projectId);

  let buildId = existingBuild?.id;
  if (!isRegenerate) {
    const { data: insertedBuild, error: insertBuildErr } = await supabase
      .from('content_builds')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title_candidate_id: ctx.candidate.id,
        format_recommendation_id: ctx.formatRec.id,
        transformation_map_snapshot_at: ctx.map.updated_at,
        subtopic_list_confirmed_at: ctx.subtopicListConfirmedAt,
        confirmed_format: ctx.formatRec.confirmed_format,
      })
      .select('id')
      .single();
    if (insertBuildErr || !insertedBuild) throw new Error(`Failed to create content build: ${insertBuildErr?.message}`);
    buildId = insertedBuild.id;
  }
  if (!buildId) throw new Error('Internal error: no content build id available');

  let existingContentBySubtopicId = new Map<string, string>();
  if (isRegenerate) {
    const { data: existingContents, error: existingContentsErr } = await supabase
      .from('subtopic_contents')
      .select('id, subtopic_id')
      .eq('content_build_id', buildId);
    if (existingContentsErr) throw new Error(`Failed to load existing content rows: ${existingContentsErr.message}`);
    existingContentBySubtopicId = new Map((existingContents ?? []).map((c) => [c.subtopic_id as string, c.id as string]));
  }

  const triggerScope: ContentTriggerScope = isRegenerate ? 'regenerate_all' : 'initial';
  const allTitles = ctx.subtopics.map((s) => s.title);

  const contents: SubtopicContentRow[] = [];
  for (const subtopic of ctx.subtopics) {
    const siblingTitles = allTitles.filter((t) => t !== subtopic.title);
    const contentRow = await generateAndPersistOneSubtopicContent({
      supabase,
      workspaceId,
      projectId,
      buildId,
      subtopic,
      siblingTitles,
      ctx,
      triggerScope,
      existingContentId: existingContentBySubtopicId.get(subtopic.id),
    });
    contents.push(contentRow);
  }

  const { data: updatedBuild, error: buildUpdateErr } = await supabase
    .from('content_builds')
    .update({
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      subtopic_list_confirmed_at: ctx.subtopicListConfirmedAt,
      confirmed_format: ctx.formatRec.confirmed_format,
      regenerate_count: isRegenerate ? existingBuild.regenerate_count + 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', buildId)
    .select()
    .single();
  if (buildUpdateErr || !updatedBuild) throw new Error(`Failed to update content build: ${buildUpdateErr?.message}`);

  const { error: projectUpdateErr } = await supabase.from('projects').update({ status: 'content_generating' }).eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project status: ${projectUpdateErr.message}`);

  return { build: updatedBuild as ContentBuildRow, contents };
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
}

/** §1.8: Confirm is allowed even with content gaps (some rows failed_empty) — decision 20. */
export async function confirmContentBuild(params: ConfirmParams): Promise<ContentBuildRow> {
  const { supabase, projectId, userId } = params;

  const { data: existing, error: existingErr } = await supabase.from('content_builds').select('id, status').eq('project_id', projectId).single();
  if (existingErr || !existing) throw new Error(`No content build found for project: ${existingErr?.message}`);
  if (existing.status !== 'draft') throw new Error('Content build is not in draft status — nothing to confirm');

  const { data: updated, error: updateErr } = await supabase
    .from('content_builds')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: userId })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm content build: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'content_confirmed' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as ContentBuildRow;
}

interface UnlockParams {
  supabase: SupabaseClient;
  projectId: string;
}

/** Content-preserving unlock — nothing in `subtopic_contents` is cleared or re-checked. */
export async function unlockContentBuild(params: UnlockParams): Promise<ContentBuildRow> {
  const { supabase, projectId } = params;

  const { data: existing, error: existingErr } = await supabase.from('content_builds').select('id, status').eq('project_id', projectId).single();
  if (existingErr || !existing) throw new Error(`No content build found for project: ${existingErr?.message}`);
  if (existing.status !== 'confirmed') throw new Error('Content build is not confirmed — nothing to unlock');

  const { data: updated, error: updateErr } = await supabase
    .from('content_builds')
    .update({ status: 'draft', confirmed_at: null, confirmed_by: null })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to unlock content build: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'content_generating' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as ContentBuildRow;
}

interface GetCurrentParams {
  supabase: SupabaseClient;
  projectId: string;
}

export interface GetCurrentContentBuildResult {
  build: ContentBuildRow | null;
  contents: SubtopicContentRow[];
  isStale: boolean;
  documentStaleReason: DocumentStalenessReason;
  staleSubtopicContentIds: string[];
}

/**
 * §7's four-dependency soft staleness check — three document-level (title, format,
 * map, via detectDocumentStalenessReason, mirroring Step 7) PLUS a per-row check
 * (decision 11's new detection granularity) comparing each content row's generation-
 * time subtopic_snapshot against the LIVE subtopics row. Either kind of staleness
 * reverts a confirmed build to draft (§7.5's effect table applies uniformly regardless
 * of which dependency triggered it), leaving all content completely untouched either way.
 */
export async function getCurrentContentBuild(params: GetCurrentParams): Promise<GetCurrentContentBuildResult> {
  const { supabase, projectId } = params;

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: build, error: buildErr } = await supabase.from('content_builds').select('*').eq('project_id', projectId).maybeSingle();
  if (buildErr) throw new Error(`Failed to load content build: ${buildErr.message}`);
  if (!build) return { build: null, contents: [], isStale: false, documentStaleReason: null, staleSubtopicContentIds: [] };

  const { data: map, error: mapErr } = await supabase.from('transformation_maps').select('updated_at').eq('project_id', projectId).maybeSingle();
  if (mapErr) throw new Error(`Failed to load transformation map for staleness check: ${mapErr.message}`);

  const documentStaleReason = detectDocumentStalenessReason(
    {
      titleCandidateId: build.title_candidate_id,
      formatRecommendationId: build.format_recommendation_id,
      transformationMapSnapshotAt: build.transformation_map_snapshot_at,
    },
    {
      selectedCandidateId: project.selected_candidate_id,
      currentFormatRecommendationId: project.current_format_recommendation_id,
      transformationMapUpdatedAt: map?.updated_at ?? null,
    },
  );

  const { data: contentRows, error: contentsErr } = await supabase.from('subtopic_contents').select('*').eq('content_build_id', build.id);
  if (contentsErr) throw new Error(`Failed to load subtopic contents: ${contentsErr.message}`);

  const { data: subtopics, error: subtopicsErr } = await supabase
    .from('subtopics')
    .select('id, title, description, depth, display_order')
    .eq('project_id', projectId)
    .order('display_order', { ascending: true });
  if (subtopicsErr) throw new Error(`Failed to load subtopics for staleness check: ${subtopicsErr.message}`);

  const generationIds = (contentRows ?? []).map((c) => c.source_generation_id).filter((id): id is string => id !== null);
  const { data: generations, error: generationsErr } =
    generationIds.length > 0
      ? await supabase.from('content_generations').select('id, subtopic_snapshot').in('id', generationIds)
      : { data: [], error: null };
  if (generationsErr) throw new Error(`Failed to load generation snapshots for staleness check: ${generationsErr.message}`);

  const subtopicById = new Map((subtopics ?? []).map((s) => [s.id, s]));
  const generationById = new Map((generations ?? []).map((g) => [g.id, g.subtopic_snapshot as SubtopicSnapshot]));

  const staleSubtopicContentIds: string[] = [];
  for (const content of contentRows ?? []) {
    const subtopic = subtopicById.get(content.subtopic_id);
    const snapshot = content.source_generation_id ? generationById.get(content.source_generation_id) : undefined;
    if (subtopic && snapshot) {
      const current: SubtopicSnapshot = { title: subtopic.title, description: subtopic.description, depth: subtopic.depth };
      if (isSubtopicContentStale(snapshot, current)) {
        staleSubtopicContentIds.push(content.id);
      }
    }
  }

  const isStale = documentStaleReason !== null || staleSubtopicContentIds.length > 0;

  let currentBuild = build as ContentBuildRow;
  if (isStale && currentBuild.status === 'confirmed') {
    const { data: reverted, error: revertErr } = await supabase
      .from('content_builds')
      .update({ status: 'draft', confirmed_at: null, confirmed_by: null })
      .eq('id', currentBuild.id)
      .select()
      .single();
    if (revertErr || !reverted) throw new Error(`Failed to revert stale confirmed content build: ${revertErr?.message}`);
    currentBuild = reverted as ContentBuildRow;

    const { error: statusErr } = await supabase.from('projects').update({ status: 'content_generating' }).eq('id', projectId);
    if (statusErr) throw new Error(`Failed to revert project status for stale content build: ${statusErr.message}`);
  }

  const orderedContents = (subtopics ?? [])
    .map((s) => (contentRows ?? []).find((c) => c.subtopic_id === s.id))
    .filter((c): c is SubtopicContentRow => c !== undefined);

  return { build: currentBuild, contents: orderedContents, isStale, documentStaleReason, staleSubtopicContentIds };
}

/** Shared draft-status guard for every row-level action in §1.8's table. */
async function requireDraftBuild(supabase: SupabaseClient, projectId: string): Promise<ContentBuildRow> {
  const { data: build, error } = await supabase.from('content_builds').select('*').eq('project_id', projectId).single();
  if (error || !build) throw new Error(`No content build found for project: ${error?.message}`);
  if (build.status !== 'draft') throw new Error('Content build is confirmed — unlock it first');
  return build as ContentBuildRow;
}

interface EditSubtopicContentParams {
  supabase: SupabaseClient;
  projectId: string;
  subtopicContentId: string;
  userId: string;
  body: string;
}

/**
 * §1.8's Manual edit action — draft status only. Interpretive resolution of a gap in
 * the requirements doc: `content_status` transitions `failed_empty` -> `manual` only
 * when the row never had real AI content to begin with (the user is filling in a gap
 * from scratch); an already-`generated` row stays `generated` when hand-tweaked —
 * `is_edited=true` alone carries the "diverged from AI output" signal in that case,
 * same semantics as `subtopics.is_edited` in Step 7.
 */
export async function editSubtopicContent(params: EditSubtopicContentParams): Promise<SubtopicContentRow> {
  const { supabase, projectId, subtopicContentId, userId, body } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: existing, error: existingErr } = await supabase
    .from('subtopic_contents')
    .select('*')
    .eq('id', subtopicContentId)
    .eq('content_build_id', build.id)
    .single();
  if (existingErr || !existing) throw new Error(`Subtopic content not found in this build: ${existingErr?.message}`);

  const trimmed = body.trim();
  if (!trimmed) throw new Error('Content body cannot be empty');
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  const newContentStatus: ContentStatus = existing.content_status === 'failed_empty' ? 'manual' : existing.content_status;

  const { data: updated, error: updateErr } = await supabase
    .from('subtopic_contents')
    .update({
      body: trimmed,
      word_count: wordCount,
      content_status: newContentStatus,
      is_edited: true,
      compliance_reviewed: false,
      last_edited_at: new Date().toISOString(),
      last_edited_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subtopicContentId)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to edit subtopic content: ${updateErr?.message}`);

  return updated as SubtopicContentRow;
}

interface RegenerateOneSubtopicContentParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  subtopicContentId: string;
  /** Required (must be true) when the target row is edited — §1.8's single-row acknowledgment gate. */
  acknowledgeOverwrite?: boolean;
}

/**
 * §1.8's single-subtopic Regenerate action — draft status only, does not require
 * unlocking the whole build. Per the requirements doc's literal wording this action's
 * gate condition is `is_edited=true` alone (narrower than generateContent's whole-
 * document gate, which also checks `content_status='manual'` — though in practice a
 * `manual` row always has `is_edited=true` too, since editSubtopicContent above is the
 * only path that ever produces `manual`, so the two conditions never actually diverge).
 * No duplicate-avoidance guardrail — regenerated prose isn't competing for a shared
 * namespace the way Step 7's list-item titles were (phase6 §6.3).
 */
export async function regenerateOneSubtopicContent(params: RegenerateOneSubtopicContentParams): Promise<SubtopicContentRow> {
  const { supabase, projectId, workspaceId, subtopicContentId, acknowledgeOverwrite } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: existing, error: existingErr } = await supabase
    .from('subtopic_contents')
    .select('*')
    .eq('id', subtopicContentId)
    .eq('content_build_id', build.id)
    .single();
  if (existingErr || !existing) throw new Error(`Subtopic content not found in this build: ${existingErr?.message}`);

  if (existing.is_edited && acknowledgeOverwrite !== true) {
    throw new Error('This content has unsaved manual edits — pass acknowledgeOverwrite=true to confirm overwriting it (phase6 §1.8)');
  }

  const ctx = await loadGenerationContext(supabase, projectId);
  const targetSubtopic = ctx.subtopics.find((s) => s.id === existing.subtopic_id);
  if (!targetSubtopic) throw new Error('Subtopic not found for this content row');
  const siblingTitles = ctx.subtopics.filter((s) => s.id !== targetSubtopic.id).map((s) => s.title);

  return generateAndPersistOneSubtopicContent({
    supabase,
    workspaceId,
    projectId,
    buildId: build.id,
    subtopic: targetSubtopic,
    siblingTitles,
    ctx,
    triggerScope: 'regenerate_one',
    existingContentId: existing.id,
  });
}

interface BackfillNewSubtopicContentParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  subtopicId: string;
}

/**
 * §1.8's "New subtopic added" edge case — only reachable when Step 7's subtopics list
 * has been unlocked post-confirm (decision 25's acknowledged, unresolved cross-phase
 * interaction) and a new row added there. Unlike generateContent's whole-document
 * entry point, this genuinely does auto-fire per the requirements doc — it's a single
 * subtopic's worth of calls (1-2), not the full-document blast radius decision 18 was
 * about. Refuses to run if content already exists for the subtopic (use
 * regenerateOneSubtopicContent instead).
 */
export async function backfillNewSubtopicContent(params: BackfillNewSubtopicContentParams): Promise<SubtopicContentRow> {
  const { supabase, projectId, workspaceId, subtopicId } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: existingContent, error: existingContentErr } = await supabase
    .from('subtopic_contents')
    .select('id')
    .eq('subtopic_id', subtopicId)
    .maybeSingle();
  if (existingContentErr) throw new Error(`Failed to check for existing content: ${existingContentErr.message}`);
  if (existingContent) throw new Error('Content already exists for this subtopic — use regenerateOneSubtopicContent instead');

  const ctx = await loadGenerationContext(supabase, projectId);
  const targetSubtopic = ctx.subtopics.find((s) => s.id === subtopicId);
  if (!targetSubtopic) throw new Error('Subtopic not found for this project');
  const siblingTitles = ctx.subtopics.filter((s) => s.id !== subtopicId).map((s) => s.title);

  return generateAndPersistOneSubtopicContent({
    supabase,
    workspaceId,
    projectId,
    buildId: build.id,
    subtopic: targetSubtopic,
    siblingTitles,
    ctx,
    triggerScope: 'new_subtopic_backfill',
  });
}
