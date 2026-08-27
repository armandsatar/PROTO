import type { SupabaseClient } from '@supabase/supabase-js';
import { generateNarrativeWriterPass, generatePlatformAdaptationWriterPass } from './generateWriterPass';
import { generateReviewPass } from './generateReviewPass';
import { getCopywritingModelName } from './aiProvider';
import { hasReachedRegenerateCap, checkHardLimits, detectDocumentStalenessReason, isNarrativeStale, type DocumentStalenessReason } from './rules';
import { getPlatformSpec } from './platforms';
import { REAL_PLATFORMS } from './types';
import type { FormatType, CopyPlatform, RealCopyPlatform, CopyTriggerScope, CopyGenerationStatus, ContentStatus, PlatformFields, NarrativeFields } from './types';

export interface CopywritingBuildRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  transformation_map_snapshot_at: string;
  subtopic_list_confirmed_at: string;
  content_build_confirmed_at: string;
  cover_look_snapshot: string;
  confirmed_format: FormatType;
  status: 'draft' | 'confirmed';
  confirmed_at: string | null;
  confirmed_by: string | null;
  regenerate_count: number;
  created_at: string;
  updated_at: string;
}

export interface PlatformCopyRow {
  id: string;
  workspace_id: string;
  project_id: string;
  copywriting_build_id: string;
  platform: CopyPlatform;
  title: string | null;
  body: string;
  platform_fields: PlatformFields | Record<string, unknown>;
  word_count: number;
  char_count: number;
  hard_limit_status: 'within_limit' | 'exceeds_limit';
  content_status: ContentStatus;
  source_generation_id: string | null;
  narrative_snapshot_at: string | null;
  is_edited: boolean;
  compliance_reviewed: boolean;
  quality_flag: 'clean' | 'below_specificity_threshold';
  last_edited_at: string | null;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CopyGenerationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  copywriting_build_id: string;
  platform: CopyPlatform;
  generation_number: number;
  trigger_scope: CopyTriggerScope;
  generation_status: CopyGenerationStatus;
  error_detail: string | null;
  created_at: string;
  completed_at: string | null;
}

interface SubtopicRowLite {
  id: string;
  title: string;
  description: string;
}

interface LoadedGenerationContext {
  candidate: { id: string; candidate_text: string };
  rationale: string;
  formatRec: { id: string; confirmed_format: FormatType; confirmed_delivery_mode: string | null };
  map: {
    updated_at: string;
    headline_before: string;
    headline_after: string;
    dim_emotional_before: string;
    dim_emotional_after: string;
    dim_practical_before: string;
    dim_practical_after: string;
    dim_identity_before: string;
    dim_identity_after: string;
    dim_pain_point_before: string;
    dim_pain_point_after: string;
  };
  subtopicListSnapshotAt: string;
  subtopics: SubtopicRowLite[];
  contentBuildSnapshotAt: string;
  contentBodies: { subtopicTitle: string; body: string }[];
  coverLookSnapshot: string;
}

/**
 * §1's full input set, loaded fresh from live upstream state — the load-bearing
 * decision-1 read is contentBodies, the full confirmed subtopic_contents.body text for
 * every subtopic, not just titles.
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

  const { data: candidate, error: candidateErr } = await supabase.from('title_candidates').select('id, candidate_text').eq('id', project.selected_candidate_id).single();
  if (candidateErr || !candidate) throw new Error(`Selected title candidate not found: ${candidateErr?.message}`);

  const { data: idea, error: ideaErr } = await supabase.from('title_ideas').select('rationale').eq('project_id', projectId).single();
  if (ideaErr || !idea) throw new Error(`title_ideas row not found for project: ${ideaErr?.message}`);

  const { data: formatRec, error: formatErr } = await supabase
    .from('format_recommendations')
    .select('id, confirmed_format, confirmed_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (formatErr || !formatRec) throw new Error(`Confirmed format recommendation not found: ${formatErr?.message}`);

  const { data: map, error: mapErr } = await supabase.from('transformation_maps').select('*').eq('project_id', projectId).single();
  if (mapErr || !map) throw new Error(`Transformation map not found for project: ${mapErr?.message}`);

  const { data: subtopicList, error: subtopicListErr } = await supabase.from('subtopic_lists').select('confirmed_at, updated_at').eq('project_id', projectId).single();
  if (subtopicListErr || !subtopicList) throw new Error(`Subtopic list not found for project: ${subtopicListErr?.message}`);

  const { data: subtopics, error: subtopicsErr } = await supabase.from('subtopics').select('id, title, description').eq('project_id', projectId).order('display_order');
  if (subtopicsErr) throw new Error(`Failed to load subtopics: ${subtopicsErr.message}`);

  const { data: contentBuild, error: contentBuildErr } = await supabase.from('content_builds').select('id, confirmed_at, updated_at').eq('project_id', projectId).single();
  if (contentBuildErr || !contentBuild) throw new Error(`Content build not found for project: ${contentBuildErr?.message}`);

  const { data: contents, error: contentsErr } = await supabase.from('subtopic_contents').select('subtopic_id, body').eq('content_build_id', contentBuild.id);
  if (contentsErr) throw new Error(`Failed to load subtopic contents: ${contentsErr.message}`);

  const bodyBySubtopicId = new Map((contents ?? []).map((c) => [c.subtopic_id as string, c.body as string]));
  const contentBodies = (subtopics ?? []).map((s) => ({ subtopicTitle: s.title as string, body: bodyBySubtopicId.get(s.id as string) ?? '' }));

  const { data: coverDesign, error: coverDesignErr } = await supabase.from('cover_designs').select('confirmed_look_id').eq('project_id', projectId).single();
  if (coverDesignErr || !coverDesign) throw new Error(`Cover design not found for project: ${coverDesignErr?.message}`);

  return {
    candidate,
    rationale: idea.rationale,
    formatRec,
    map,
    subtopicListSnapshotAt: subtopicList.confirmed_at ?? subtopicList.updated_at,
    subtopics: (subtopics ?? []) as SubtopicRowLite[],
    contentBuildSnapshotAt: contentBuild.confirmed_at ?? contentBuild.updated_at,
    contentBodies,
    coverLookSnapshot: coverDesign.confirmed_look_id,
  };
}

async function nextGenerationNumber(supabase: SupabaseClient, copywritingBuildId: string, platform: CopyPlatform): Promise<number> {
  const { data } = await supabase
    .from('copy_generations')
    .select('generation_number')
    .eq('copywriting_build_id', copywritingBuildId)
    .eq('platform', platform)
    .order('generation_number', { ascending: false })
    .limit(1);
  return (data?.[0]?.generation_number ?? 0) + 1;
}

async function requireDraftBuild(supabase: SupabaseClient, projectId: string): Promise<CopywritingBuildRow> {
  const { data: build, error } = await supabase.from('copywriting_builds').select('*').eq('project_id', projectId).single();
  if (error || !build) throw new Error(`No copywriting build found for project: ${error?.message}`);
  if (build.status !== 'draft') throw new Error('Copywriting build is confirmed — unlock it first');
  return build as CopywritingBuildRow;
}

function narrativeFieldsToPlatformFields(fields: NarrativeFields): Record<string, unknown> {
  return { hook: fields.hook, transformation_story: fields.transformationStory, cta: fields.cta, summary: fields.summary };
}

function platformFieldsToNarrativeFields(raw: Record<string, unknown>): NarrativeFields {
  return {
    hook: raw.hook as string,
    transformationStory: raw.transformation_story as string,
    cta: raw.cta as string,
    summary: raw.summary as string,
  };
}

interface PersistParams {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  buildId: string;
  ctx: LoadedGenerationContext;
  triggerScope: CopyTriggerScope;
  existingRowId?: string;
}

/** Narrative writer + review pass, persisted as the platform='narrative' sentinel row. */
async function generateAndPersistNarrative(params: PersistParams): Promise<{ generation: CopyGenerationRow; row: PlatformCopyRow }> {
  const { supabase, workspaceId, projectId, buildId, ctx, triggerScope, existingRowId } = params;
  const generationNumber = await nextGenerationNumber(supabase, buildId, 'narrative');

  let generationStatus: CopyGenerationStatus = 'succeeded';
  let complianceStatus: 'no_changes_needed' | 'changes_applied' | 'review_pass_failed' = 'no_changes_needed';
  let contentStatus: ContentStatus = 'failed_empty';
  let narrativeFields: NarrativeFields | null = null;
  let specificityScore: number | null = null;
  let complianceChanges: { originalText: string; rewrittenText: string; reason: string; riskCategory: string; detectedBy: string }[] = [];
  let errorDetail: string | null = null;

  try {
    const draft = await generateNarrativeWriterPass({
      title: ctx.candidate.candidate_text,
      rationale: ctx.rationale,
      confirmedFormat: ctx.formatRec.confirmed_format,
      confirmedDeliveryMode: ctx.formatRec.confirmed_delivery_mode,
      headlineBefore: ctx.map.headline_before,
      headlineAfter: ctx.map.headline_after,
      dimEmotionalBefore: ctx.map.dim_emotional_before,
      dimEmotionalAfter: ctx.map.dim_emotional_after,
      dimPracticalBefore: ctx.map.dim_practical_before,
      dimPracticalAfter: ctx.map.dim_practical_after,
      dimIdentityBefore: ctx.map.dim_identity_before,
      dimIdentityAfter: ctx.map.dim_identity_after,
      dimPainPointBefore: ctx.map.dim_pain_point_before,
      dimPainPointAfter: ctx.map.dim_pain_point_after,
      subtopics: ctx.subtopics.map((s) => ({ title: s.title, description: s.description })),
      contentBodies: ctx.contentBodies,
      coverLookMoodDescriptor: ctx.coverLookSnapshot,
    });

    const groundingText = ctx.contentBodies.map((c) => `${c.subtopicTitle}: ${c.body}`).join('\n\n');
    const review = await generateReviewPass({
      title: ctx.candidate.candidate_text,
      draftFields: { hook: draft.fields.hook, transformationStory: draft.fields.transformationStory, cta: draft.fields.cta, summary: draft.fields.summary },
      groundingText,
    });

    narrativeFields = {
      hook: review.finalFields.hook,
      transformationStory: review.finalFields.transformationStory,
      cta: review.finalFields.cta,
      summary: review.finalFields.summary,
    };
    contentStatus = 'generated';
    specificityScore = review.specificityScore;
    complianceStatus = review.complianceChanges.length === 0 ? 'no_changes_needed' : 'changes_applied';
    complianceChanges = review.complianceChanges.map((c) => ({ originalText: c.originalText, rewrittenText: c.rewrittenText, reason: c.reason, riskCategory: c.riskCategory, detectedBy: c.detectedBy }));
  } catch (err) {
    generationStatus = 'failed_fallback';
    errorDetail = err instanceof Error ? err.message : 'Narrative generation failed';
  }

  const { data: generation, error: genErr } = await supabase
    .from('copy_generations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      copywriting_build_id: buildId,
      platform: 'narrative',
      generation_number: generationNumber,
      trigger_scope: triggerScope,
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      subtopic_list_confirmed_at: ctx.subtopicListSnapshotAt,
      content_build_confirmed_at: ctx.contentBuildSnapshotAt,
      cover_look_snapshot: ctx.coverLookSnapshot,
      inputs_snapshot: { title: ctx.candidate.candidate_text, rationale: ctx.rationale },
      draft_content_snapshot: narrativeFields ? narrativeFieldsToPlatformFields(narrativeFields) : null,
      output_snapshot: narrativeFields ? narrativeFieldsToPlatformFields(narrativeFields) : null,
      specificity_score: specificityScore,
      compliance_status: complianceStatus,
      hard_limit_status: 'within_limit',
      model: generationStatus === 'failed_fallback' ? 'fallback-no-narrative' : getCopywritingModelName(),
      generation_status: generationStatus,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genErr || !generation) throw new Error(`Failed to persist narrative generation row: ${genErr?.message}`);

  const rowPayload = {
    workspace_id: workspaceId,
    project_id: projectId,
    copywriting_build_id: buildId,
    platform: 'narrative' as const,
    platform_fields: narrativeFields ? narrativeFieldsToPlatformFields(narrativeFields) : {},
    word_count: narrativeFields ? Object.values(narrativeFieldsToPlatformFields(narrativeFields)).join(' ').split(/\s+/).filter(Boolean).length : 0,
    char_count: narrativeFields ? Object.values(narrativeFieldsToPlatformFields(narrativeFields)).join('').length : 0,
    hard_limit_status: 'within_limit' as const,
    content_status: contentStatus,
    source_generation_id: generation.id,
    is_edited: false,
    compliance_reviewed: contentStatus === 'generated',
    quality_flag: 'clean' as const,
    updated_at: new Date().toISOString(),
  };

  let row: PlatformCopyRow;
  if (existingRowId) {
    const { data: updated, error: updateErr } = await supabase.from('platform_copies').update(rowPayload).eq('id', existingRowId).select().single();
    if (updateErr || !updated) throw new Error(`Failed to update narrative row: ${updateErr?.message}`);
    row = updated as PlatformCopyRow;
  } else {
    const { data: inserted, error: insertErr } = await supabase.from('platform_copies').insert(rowPayload).select().single();
    if (insertErr || !inserted) throw new Error(`Failed to insert narrative row: ${insertErr?.message}`);
    row = inserted as PlatformCopyRow;
  }

  if (complianceChanges.length > 0) {
    const { error: changesErr } = await supabase.from('copy_compliance_changes').insert(
      complianceChanges.map((c) => ({
        workspace_id: workspaceId,
        project_id: projectId,
        copy_generation_id: generation.id,
        platform_copy_id: row.id,
        original_text: c.originalText,
        rewritten_text: c.rewrittenText,
        reason: c.reason,
        risk_category: c.riskCategory,
        detected_by: c.detectedBy,
      })),
    );
    if (changesErr) throw new Error(`Failed to persist narrative compliance change rows: ${changesErr.message}`);
  }

  return { generation: generation as CopyGenerationRow, row };
}

interface PersistPlatformParams extends PersistParams {
  platform: RealCopyPlatform;
  narrative: NarrativeFields;
  narrativeUpdatedAt: string;
}

/** Platform-adaptation writer + review pass, persisted as that platform's live row. */
async function generateAndPersistPlatformAdaptation(params: PersistPlatformParams): Promise<{ generation: CopyGenerationRow; row: PlatformCopyRow }> {
  const { supabase, workspaceId, projectId, buildId, ctx, triggerScope, existingRowId, platform, narrative, narrativeUpdatedAt } = params;
  const generationNumber = await nextGenerationNumber(supabase, buildId, platform);

  let generationStatus: CopyGenerationStatus = 'succeeded';
  let complianceStatus: 'no_changes_needed' | 'changes_applied' | 'review_pass_failed' = 'no_changes_needed';
  let contentStatus: ContentStatus = 'failed_empty';
  let hardLimitStatus: 'within_limit' | 'exceeds_limit' = 'within_limit';
  let title: string | null = null;
  let body = '';
  let platformFields: PlatformFields = {};
  let specificityScore: number | null = null;
  let complianceChanges: { originalText: string; rewrittenText: string; reason: string; riskCategory: string; detectedBy: string }[] = [];
  let errorDetail: string | null = null;

  try {
    const draft = await generatePlatformAdaptationWriterPass({
      platform,
      narrative,
      title: ctx.candidate.candidate_text,
      confirmedFormat: ctx.formatRec.confirmed_format,
      confirmedDeliveryMode: ctx.formatRec.confirmed_delivery_mode,
    });

    const draftFields: Record<string, string> = draft.title !== null ? { title: draft.title, body: draft.body } : { body: draft.body };
    const review = await generateReviewPass({
      title: ctx.candidate.candidate_text,
      draftFields,
      groundingText: JSON.stringify(narrativeFieldsToPlatformFields(narrative)),
    });

    title = draft.title !== null ? review.finalFields.title : null;
    body = review.finalFields.body;
    platformFields = draft.platformFields;
    const hardLimitCheck = checkHardLimits(platform, { title, body, platformFields });
    hardLimitStatus = hardLimitCheck.status;
    contentStatus = 'generated';
    specificityScore = review.specificityScore;
    complianceStatus = review.complianceChanges.length === 0 ? 'no_changes_needed' : 'changes_applied';
    complianceChanges = review.complianceChanges.map((c) => ({ originalText: c.originalText, rewrittenText: c.rewrittenText, reason: c.reason, riskCategory: c.riskCategory, detectedBy: c.detectedBy }));
    generationStatus = hardLimitStatus === 'exceeds_limit' ? 'failed_hard_limit_exceeded' : 'succeeded';
  } catch (err) {
    generationStatus = 'failed_fallback';
    errorDetail = err instanceof Error ? err.message : `Platform adaptation for "${platform}" failed`;
  }

  const { data: generation, error: genErr } = await supabase
    .from('copy_generations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      copywriting_build_id: buildId,
      platform,
      generation_number: generationNumber,
      trigger_scope: triggerScope,
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      subtopic_list_confirmed_at: ctx.subtopicListSnapshotAt,
      content_build_confirmed_at: ctx.contentBuildSnapshotAt,
      cover_look_snapshot: ctx.coverLookSnapshot,
      inputs_snapshot: narrativeFieldsToPlatformFields(narrative),
      draft_content_snapshot: contentStatus === 'generated' ? { title, body, platform_fields: platformFields } : null,
      output_snapshot: contentStatus === 'generated' ? { title, body, platform_fields: platformFields } : null,
      specificity_score: specificityScore,
      compliance_status: complianceStatus,
      hard_limit_status: hardLimitStatus,
      model: generationStatus === 'failed_fallback' ? 'fallback-no-copy' : getCopywritingModelName(),
      generation_status: generationStatus,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genErr || !generation) throw new Error(`Failed to persist ${platform} generation row: ${genErr?.message}`);

  const rowPayload = {
    workspace_id: workspaceId,
    project_id: projectId,
    copywriting_build_id: buildId,
    platform,
    title,
    body,
    platform_fields: platformFields,
    word_count: body.split(/\s+/).filter(Boolean).length,
    char_count: (title?.length ?? 0) + body.length,
    hard_limit_status: hardLimitStatus,
    content_status: contentStatus,
    source_generation_id: generation.id,
    narrative_snapshot_at: narrativeUpdatedAt,
    is_edited: false,
    compliance_reviewed: contentStatus === 'generated',
    quality_flag: 'clean' as const,
    updated_at: new Date().toISOString(),
  };

  let row: PlatformCopyRow;
  if (existingRowId) {
    const { data: updated, error: updateErr } = await supabase.from('platform_copies').update(rowPayload).eq('id', existingRowId).select().single();
    if (updateErr || !updated) throw new Error(`Failed to update ${platform} row: ${updateErr?.message}`);
    row = updated as PlatformCopyRow;
  } else {
    const { data: inserted, error: insertErr } = await supabase.from('platform_copies').insert(rowPayload).select().single();
    if (insertErr || !inserted) throw new Error(`Failed to insert ${platform} row: ${insertErr?.message}`);
    row = inserted as PlatformCopyRow;
  }

  if (complianceChanges.length > 0) {
    const { error: changesErr } = await supabase.from('copy_compliance_changes').insert(
      complianceChanges.map((c) => ({
        workspace_id: workspaceId,
        project_id: projectId,
        copy_generation_id: generation.id,
        platform_copy_id: row.id,
        original_text: c.originalText,
        rewritten_text: c.rewrittenText,
        reason: c.reason,
        risk_category: c.riskCategory,
        detected_by: c.detectedBy,
      })),
    );
    if (changesErr) throw new Error(`Failed to persist ${platform} compliance change rows: ${changesErr.message}`);
  }

  return { generation: generation as CopyGenerationRow, row };
}

interface GenerateCopyParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  /** Required (must be true) once the whole-batch regenerate cap is reached, or if any platform row is hand-edited. */
  acknowledgeOverwrite?: boolean;
}

export interface GenerateCopyResult {
  build: CopywritingBuildRow;
  platformCopies: PlatformCopyRow[];
}

/**
 * §7's "Explicit Generate Copy" (first entry) and "Regenerate all platforms" combined —
 * same dual-purpose shape every prior phase's generate function uses. NEVER auto-fires
 * (decision 2) — requires either an existing copywriting_builds row (regenerate path)
 * or projects.status='cover_approved' (first-entry path). On first entry, generates the
 * narrative AND all 6 platforms. On regenerate, re-adapts all 6 platforms from
 * whatever narrative currently exists — it does NOT regenerate the narrative itself
 * (decision 14: that is the separate regenerateNarrative action).
 */
export async function generateCopy(params: GenerateCopyParams): Promise<GenerateCopyResult> {
  const { supabase, projectId, workspaceId, acknowledgeOverwrite } = params;

  const { data: project, error: projectErr } = await supabase.from('projects').select('status').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: existingBuild, error: existingErr } = await supabase.from('copywriting_builds').select('id, status, regenerate_count').eq('project_id', projectId).maybeSingle();
  if (existingErr) throw new Error(`Failed to check for existing copywriting build: ${existingErr.message}`);

  const isRegenerate = !!existingBuild;
  if (!isRegenerate && project.status !== 'cover_approved') {
    throw new Error('Project has not reached cover_approved — cannot generate copy yet (decision 2: no auto-fire, this must be called explicitly)');
  }
  if (isRegenerate) {
    if (existingBuild.status === 'confirmed') throw new Error('Cannot regenerate a confirmed copywriting build directly — unlock it first');
    if (hasReachedRegenerateCap(existingBuild.regenerate_count)) throw new Error('Whole-batch regenerate cap reached for this project (§9.3/rules.ts REGENERATE_CAP)');

    const { data: existingRows, error: rowsErr } = await supabase.from('platform_copies').select('platform, is_edited').eq('copywriting_build_id', existingBuild.id).neq('platform', 'narrative');
    if (rowsErr) throw new Error(`Failed to check existing platform copies for hand-edits: ${rowsErr.message}`);
    const hasHandCuration = (existingRows ?? []).some((row) => row.is_edited);
    if (hasHandCuration && acknowledgeOverwrite !== true) {
      throw new Error('One or more platform rows have unsaved manual edits — pass acknowledgeOverwrite=true to confirm overwriting them');
    }
  }

  const ctx = await loadGenerationContext(supabase, projectId);

  let buildId = existingBuild?.id;
  if (!isRegenerate) {
    const { data: insertedBuild, error: insertBuildErr } = await supabase
      .from('copywriting_builds')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title_candidate_id: ctx.candidate.id,
        format_recommendation_id: ctx.formatRec.id,
        transformation_map_snapshot_at: ctx.map.updated_at,
        subtopic_list_confirmed_at: ctx.subtopicListSnapshotAt,
        content_build_confirmed_at: ctx.contentBuildSnapshotAt,
        cover_look_snapshot: ctx.coverLookSnapshot,
        confirmed_format: ctx.formatRec.confirmed_format,
      })
      .select('id')
      .single();
    if (insertBuildErr || !insertedBuild) throw new Error(`Failed to create copywriting build: ${insertBuildErr?.message}`);
    buildId = insertedBuild.id;
  }
  if (!buildId) throw new Error('Internal error: no copywriting build id available');

  const { data: existingCopies, error: existingCopiesErr } = await supabase.from('platform_copies').select('id, platform').eq('copywriting_build_id', buildId);
  if (existingCopiesErr) throw new Error(`Failed to load existing platform copies: ${existingCopiesErr.message}`);
  const existingRowIdByPlatform = new Map((existingCopies ?? []).map((c) => [c.platform as CopyPlatform, c.id as string]));

  let narrative: NarrativeFields;
  let narrativeUpdatedAt: string;
  if (!isRegenerate) {
    const { row: narrativeRow } = await generateAndPersistNarrative({
      supabase,
      workspaceId,
      projectId,
      buildId,
      ctx,
      triggerScope: 'initial',
      existingRowId: existingRowIdByPlatform.get('narrative'),
    });
    narrative = platformFieldsToNarrativeFields(narrativeRow.platform_fields as Record<string, unknown>);
    narrativeUpdatedAt = narrativeRow.updated_at;
  } else {
    const { data: narrativeRow, error: narrativeErr } = await supabase.from('platform_copies').select('*').eq('copywriting_build_id', buildId).eq('platform', 'narrative').single();
    if (narrativeErr || !narrativeRow) throw new Error(`Narrative row not found for regenerate: ${narrativeErr?.message}`);
    narrative = platformFieldsToNarrativeFields(narrativeRow.platform_fields as Record<string, unknown>);
    narrativeUpdatedAt = narrativeRow.updated_at;
  }

  const triggerScope: CopyTriggerScope = isRegenerate ? 'regenerate_all' : 'initial';
  const platformCopies: PlatformCopyRow[] = [];
  for (const platform of REAL_PLATFORMS) {
    const { row } = await generateAndPersistPlatformAdaptation({
      supabase,
      workspaceId,
      projectId,
      buildId,
      ctx,
      triggerScope,
      existingRowId: existingRowIdByPlatform.get(platform),
      platform,
      narrative,
      narrativeUpdatedAt,
    });
    platformCopies.push(row);
  }

  const { data: updatedBuild, error: buildUpdateErr } = await supabase
    .from('copywriting_builds')
    .update({
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      subtopic_list_confirmed_at: ctx.subtopicListSnapshotAt,
      content_build_confirmed_at: ctx.contentBuildSnapshotAt,
      cover_look_snapshot: ctx.coverLookSnapshot,
      confirmed_format: ctx.formatRec.confirmed_format,
      regenerate_count: isRegenerate ? existingBuild.regenerate_count + 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', buildId)
    .select()
    .single();
  if (buildUpdateErr || !updatedBuild) throw new Error(`Failed to update copywriting build: ${buildUpdateErr?.message}`);

  const { error: projectUpdateErr } = await supabase.from('projects').update({ status: 'copy_generating' }).eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project status: ${projectUpdateErr.message}`);

  return { build: updatedBuild as CopywritingBuildRow, platformCopies };
}

interface EditNarrativeParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  fields: NarrativeFields;
}

/** §7's new "Manual edit — narrative" action — draft status only, does not touch any platform row. */
export async function editNarrative(params: EditNarrativeParams): Promise<PlatformCopyRow> {
  const { supabase, projectId, userId, fields } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: existing, error: existingErr } = await supabase.from('platform_copies').select('id').eq('copywriting_build_id', build.id).eq('platform', 'narrative').single();
  if (existingErr || !existing) throw new Error(`Narrative row not found: ${existingErr?.message}`);

  const platformFields = narrativeFieldsToPlatformFields(fields);
  const { data: updated, error: updateErr } = await supabase
    .from('platform_copies')
    .update({
      platform_fields: platformFields,
      word_count: Object.values(platformFields).join(' ').split(/\s+/).filter(Boolean).length,
      char_count: Object.values(platformFields).join('').length,
      is_edited: true,
      compliance_reviewed: false,
      last_edited_at: new Date().toISOString(),
      last_edited_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to edit narrative: ${updateErr?.message}`);

  return updated as PlatformCopyRow;
}

interface RegenerateNarrativeParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  /** Required (must be true) if the narrative row is currently hand-edited. */
  acknowledgeOverwrite?: boolean;
}

/**
 * §7's new "Regenerate narrative" action — its own acknowledgment gate, independent of
 * the 6 platforms. Per decision 14, this does NOT cascade: the 6 platform rows are left
 * completely untouched (their narrative_snapshot_at will simply no longer match this
 * row's new updated_at, flagging them stale-relative-to-narrative, §8.4). Does NOT
 * increment copywriting_builds.regenerate_count — only whole-document "regenerate all
 * platforms" does, same precedent as regenerateOneSubtopicContent in Step 8.
 */
export async function regenerateNarrative(params: RegenerateNarrativeParams): Promise<{ build: CopywritingBuildRow; row: PlatformCopyRow }> {
  const { supabase, projectId, workspaceId, acknowledgeOverwrite } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: existing, error: existingErr } = await supabase.from('platform_copies').select('id, is_edited').eq('copywriting_build_id', build.id).eq('platform', 'narrative').single();
  if (existingErr || !existing) throw new Error(`Narrative row not found: ${existingErr?.message}`);
  if (existing.is_edited && acknowledgeOverwrite !== true) {
    throw new Error('The narrative has unsaved manual edits — pass acknowledgeOverwrite=true to confirm overwriting it');
  }

  const ctx = await loadGenerationContext(supabase, projectId);
  const { row } = await generateAndPersistNarrative({
    supabase,
    workspaceId,
    projectId,
    buildId: build.id,
    ctx,
    triggerScope: 'regenerate_one',
    existingRowId: existing.id,
  });

  return { build, row };
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
}

/** §7's Confirm — blocked if any hard-limit-enforced platform currently exceeds its limit (decision 4). */
export async function confirmCopywritingBuild(params: ConfirmParams): Promise<CopywritingBuildRow> {
  const { supabase, projectId, userId } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: rows, error: rowsErr } = await supabase.from('platform_copies').select('platform, hard_limit_status').eq('copywriting_build_id', build.id).neq('platform', 'narrative');
  if (rowsErr) throw new Error(`Failed to check platform hard-limit status: ${rowsErr.message}`);
  const overLimit = (rows ?? []).filter((r) => r.hard_limit_status === 'exceeds_limit').map((r) => r.platform as string);
  if (overLimit.length > 0) {
    throw new Error(`Cannot confirm — the following platform(s) exceed their hard character/tag limit: ${overLimit.join(', ')} (decision 4). Fix by regenerating or manually editing that platform's copy.`);
  }

  const { data: updated, error: updateErr } = await supabase
    .from('copywriting_builds')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: userId })
    .eq('id', build.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm copywriting build: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'copy_confirmed' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as CopywritingBuildRow;
}

interface UnlockParams {
  supabase: SupabaseClient;
  projectId: string;
}

/** Content-preserving unlock — nothing in platform_copies or copy_generations is touched. */
export async function unlockCopywritingBuild(params: UnlockParams): Promise<CopywritingBuildRow> {
  const { supabase, projectId } = params;

  const { data: existing, error: existingErr } = await supabase.from('copywriting_builds').select('id, status').eq('project_id', projectId).single();
  if (existingErr || !existing) throw new Error(`No copywriting build found for project: ${existingErr?.message}`);
  if (existing.status !== 'confirmed') throw new Error('Copywriting build is not confirmed — nothing to unlock');

  const { data: updated, error: updateErr } = await supabase.from('copywriting_builds').update({ status: 'draft', confirmed_at: null, confirmed_by: null }).eq('id', existing.id).select().single();
  if (updateErr || !updated) throw new Error(`Failed to unlock copywriting build: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'copy_generating' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as CopywritingBuildRow;
}

interface GetCurrentParams {
  supabase: SupabaseClient;
  projectId: string;
}

export interface GetCurrentCopywritingBuildResult {
  build: CopywritingBuildRow | null;
  platformCopies: PlatformCopyRow[];
  isStale: boolean;
  documentStaleReason: DocumentStalenessReason;
  /** §8.4's new per-row dimension — platforms whose copy predates the current narrative. */
  staleNarrativePlatforms: RealCopyPlatform[];
}

/**
 * §8's two-tier soft staleness check — 6-way document-level (mirrors
 * getCurrentContentBuild/getCurrentCoverDesign exactly, with the completed precedence
 * order) PLUS the new per-row narrative-vs-platform dimension (§8.4), checked
 * independently and simultaneously. Either kind reverts a confirmed build to draft;
 * content is untouched either way.
 */
export async function getCurrentCopywritingBuild(params: GetCurrentParams): Promise<GetCurrentCopywritingBuildResult> {
  const { supabase, projectId } = params;

  const { data: project, error: projectErr } = await supabase.from('projects').select('selected_candidate_id, current_format_recommendation_id').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: build, error: buildErr } = await supabase.from('copywriting_builds').select('*').eq('project_id', projectId).maybeSingle();
  if (buildErr) throw new Error(`Failed to load copywriting build: ${buildErr.message}`);
  if (!build) return { build: null, platformCopies: [], isStale: false, documentStaleReason: null, staleNarrativePlatforms: [] };

  const { data: platformCopies, error: copiesErr } = await supabase.from('platform_copies').select('*').eq('copywriting_build_id', build.id);
  if (copiesErr) throw new Error(`Failed to load platform copies: ${copiesErr.message}`);

  const { data: map, error: mapErr } = await supabase.from('transformation_maps').select('updated_at').eq('project_id', projectId).maybeSingle();
  if (mapErr) throw new Error(`Failed to load transformation map for staleness check: ${mapErr.message}`);

  const { data: subtopicList, error: subtopicListErr } = await supabase.from('subtopic_lists').select('confirmed_at, updated_at').eq('project_id', projectId).maybeSingle();
  if (subtopicListErr) throw new Error(`Failed to load subtopic list for staleness check: ${subtopicListErr.message}`);

  const { data: contentBuild, error: contentBuildErr } = await supabase.from('content_builds').select('confirmed_at, updated_at').eq('project_id', projectId).maybeSingle();
  if (contentBuildErr) throw new Error(`Failed to load content build for staleness check: ${contentBuildErr.message}`);

  const { data: coverDesign, error: coverDesignErr } = await supabase.from('cover_designs').select('confirmed_look_id').eq('project_id', projectId).maybeSingle();
  if (coverDesignErr) throw new Error(`Failed to load cover design for staleness check: ${coverDesignErr.message}`);

  const documentStaleReason = detectDocumentStalenessReason(
    {
      titleCandidateId: build.title_candidate_id,
      formatRecommendationId: build.format_recommendation_id,
      transformationMapSnapshotAt: build.transformation_map_snapshot_at,
      subtopicListConfirmedAt: build.subtopic_list_confirmed_at,
      contentBuildConfirmedAt: build.content_build_confirmed_at,
      coverLookSnapshot: build.cover_look_snapshot,
    },
    {
      selectedCandidateId: project.selected_candidate_id,
      currentFormatRecommendationId: project.current_format_recommendation_id,
      transformationMapUpdatedAt: map?.updated_at ?? null,
      subtopicListSnapshotAt: subtopicList ? (subtopicList.confirmed_at ?? subtopicList.updated_at) : null,
      contentBuildSnapshotAt: contentBuild ? (contentBuild.confirmed_at ?? contentBuild.updated_at) : null,
      confirmedLookId: coverDesign?.confirmed_look_id ?? null,
    },
  );

  const narrativeRow = (platformCopies ?? []).find((r) => r.platform === 'narrative');
  const staleNarrativePlatforms = (platformCopies ?? [])
    .filter((r) => r.platform !== 'narrative')
    .filter((r) => narrativeRow && isNarrativeStale(r.narrative_snapshot_at, narrativeRow.updated_at))
    .map((r) => r.platform as RealCopyPlatform);

  let currentBuild = build as CopywritingBuildRow;
  if (documentStaleReason !== null && currentBuild.status === 'confirmed') {
    const { data: reverted, error: revertErr } = await supabase.from('copywriting_builds').update({ status: 'draft', confirmed_at: null, confirmed_by: null }).eq('id', currentBuild.id).select().single();
    if (revertErr || !reverted) throw new Error(`Failed to revert stale confirmed copywriting build: ${revertErr?.message}`);
    currentBuild = reverted as CopywritingBuildRow;

    const { error: statusErr } = await supabase.from('projects').update({ status: 'copy_generating' }).eq('id', projectId);
    if (statusErr) throw new Error(`Failed to revert project status for stale copywriting build: ${statusErr.message}`);
  }

  return { build: currentBuild, platformCopies: (platformCopies ?? []) as PlatformCopyRow[], isStale: documentStaleReason !== null, documentStaleReason, staleNarrativePlatforms };
}

interface EditPlatformCopyParams {
  supabase: SupabaseClient;
  projectId: string;
  platform: RealCopyPlatform;
  userId: string;
  title?: string | null;
  body: string;
  platformFields?: PlatformFields;
}

/**
 * §7's "Manual edit — platform" action — draft status only. Same content_status
 * transition rule as Step 8's editSubtopicContent: a row that never had real AI
 * content (`failed_empty`) becomes `manual` once hand-filled; an already-`generated`
 * row stays `generated` when hand-tweaked (`is_edited=true` alone carries the
 * "diverged from AI output" signal). Recomputes hard_limit_status against the edited
 * fields — a manual edit can just as easily introduce or fix a hard-limit violation as
 * a regenerate can.
 */
export async function editPlatformCopy(params: EditPlatformCopyParams): Promise<PlatformCopyRow> {
  const { supabase, projectId, platform, userId, body, platformFields } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const spec = getPlatformSpec(platform);
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error('Copy body cannot be empty');
  const title = spec.hasTitle ? (params.title?.trim() ?? null) : null;
  if (spec.hasTitle && !title) throw new Error(`Platform "${platform}" requires a title`);

  const { data: existing, error: existingErr } = await supabase.from('platform_copies').select('*').eq('copywriting_build_id', build.id).eq('platform', platform).single();
  if (existingErr || !existing) throw new Error(`Platform copy not found for "${platform}" in this build: ${existingErr?.message}`);

  const resolvedFields = platformFields ?? (existing.platform_fields as PlatformFields);
  const hardLimitCheck = checkHardLimits(platform, { title, body: trimmedBody, platformFields: resolvedFields });
  const newContentStatus: ContentStatus = existing.content_status === 'failed_empty' ? 'manual' : existing.content_status;

  const { data: updated, error: updateErr } = await supabase
    .from('platform_copies')
    .update({
      title,
      body: trimmedBody,
      platform_fields: resolvedFields,
      word_count: trimmedBody.split(/\s+/).filter(Boolean).length,
      char_count: (title?.length ?? 0) + trimmedBody.length,
      hard_limit_status: hardLimitCheck.status,
      content_status: newContentStatus,
      is_edited: true,
      compliance_reviewed: false,
      last_edited_at: new Date().toISOString(),
      last_edited_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to edit platform copy: ${updateErr?.message}`);

  return updated as PlatformCopyRow;
}

interface RegenerateOnePlatformCopyParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  platform: RealCopyPlatform;
  /** Required (must be true) when the target row is edited — §7's single-row acknowledgment gate. */
  acknowledgeOverwrite?: boolean;
}

/**
 * §7's single-platform Regenerate action — draft status only, does not require
 * unlocking the whole build. Always re-adapts from whatever narrative is CURRENTLY
 * live (never a stale snapshot) — §3.2's explicit resolution that per-platform
 * regenerate and narrative regenerate are independent actions, but a platform
 * regenerate always picks up the latest narrative state available at call time.
 */
export async function regenerateOnePlatformCopy(params: RegenerateOnePlatformCopyParams): Promise<PlatformCopyRow> {
  const { supabase, projectId, workspaceId, platform, acknowledgeOverwrite } = params;
  const build = await requireDraftBuild(supabase, projectId);

  const { data: existing, error: existingErr } = await supabase.from('platform_copies').select('id, is_edited').eq('copywriting_build_id', build.id).eq('platform', platform).single();
  if (existingErr || !existing) throw new Error(`Platform copy not found for "${platform}" in this build: ${existingErr?.message}`);
  if (existing.is_edited && acknowledgeOverwrite !== true) {
    throw new Error(`This platform's copy has unsaved manual edits — pass acknowledgeOverwrite=true to confirm overwriting it`);
  }

  const { data: narrativeRow, error: narrativeErr } = await supabase.from('platform_copies').select('platform_fields, updated_at').eq('copywriting_build_id', build.id).eq('platform', 'narrative').single();
  if (narrativeErr || !narrativeRow) throw new Error(`Narrative row not found: ${narrativeErr?.message}`);
  const narrative = platformFieldsToNarrativeFields(narrativeRow.platform_fields as Record<string, unknown>);

  const ctx = await loadGenerationContext(supabase, projectId);
  const { row } = await generateAndPersistPlatformAdaptation({
    supabase,
    workspaceId,
    projectId,
    buildId: build.id,
    ctx,
    triggerScope: 'regenerate_one',
    existingRowId: existing.id,
    platform,
    narrative,
    narrativeUpdatedAt: narrativeRow.updated_at,
  });

  return row;
}
