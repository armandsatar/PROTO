import type { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'node:crypto';
import { generateCoverCandidate } from './generateCoverCandidate';
import { renderCoverImage } from './renderCoverImage';
import { uploadCoverAsset } from './storage';
import { assertCanApprove, assertCandidateCapNotExceeded } from './guardrail';
import { detectDocumentStalenessReason, type DocumentStalenessReason } from './rules';
import { getLookById, DEFAULT_LOOK_ID } from './templates';
import { NANOBANANA_MODEL } from '../ai/nanobanana';
import type { FormatType } from '../format/types';
import type { CoverApprovalStatus, CoverTriggerScope, CoverGenerationStatus } from './types';

export interface CoverDesignRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  content_build_confirmed_at: string;
  recommended_look_id: string;
  recommendation_reason: string;
  confirmed_look_id: string;
  look_is_overridden: boolean;
  current_cover_generation_id: string | null;
  candidate_count: number;
  edit_round_count: number;
  approval_status: CoverApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  status: 'draft' | 'confirmed';
  created_at: string;
  updated_at: string;
}

export interface CoverGenerationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  cover_design_id: string;
  generation_number: number;
  trigger_scope: CoverTriggerScope;
  parent_generation_id: string | null;
  look_id: string | null;
  edit_instruction: string | null;
  prompt_sent: string | null;
  gemini_interaction_id: string | null;
  asset_storage_path: string | null;
  model: string | null;
  cost_usd: number | null;
  generation_status: CoverGenerationStatus;
  error_detail: string | null;
  created_at: string;
  completed_at: string | null;
}

interface LoadedGenerationContext {
  candidate: { id: string; candidate_text: string };
  rationale: string;
  formatRec: { id: string; confirmed_format: FormatType; confirmed_delivery_mode: string | null };
  contentBuildSnapshotAt: string;
}

/**
 * §7.10's inputs, loaded fresh from live upstream state. content_build_confirmed_at
 * falls back to content_builds.updated_at when currently unconfirmed — a verbatim
 * reuse of Step 8's own loadGenerationContext precedent for the identical cross-phase
 * situation (depending on an upstream table's own confirm/unlock cycle).
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

  const { data: contentBuild, error: contentBuildErr } = await supabase
    .from('content_builds')
    .select('confirmed_at, updated_at')
    .eq('project_id', projectId)
    .single();
  if (contentBuildErr || !contentBuild) throw new Error(`Content build not found for project: ${contentBuildErr?.message}`);

  return {
    candidate,
    rationale: idea.rationale,
    formatRec,
    contentBuildSnapshotAt: contentBuild.confirmed_at ?? contentBuild.updated_at,
  };
}

async function nextGenerationNumber(supabase: SupabaseClient, coverDesignId: string): Promise<number> {
  const { data } = await supabase
    .from('cover_generations')
    .select('generation_number')
    .eq('cover_design_id', coverDesignId)
    .order('generation_number', { ascending: false })
    .limit(1);
  return (data?.[0]?.generation_number ?? 0) + 1;
}

/** Shared draft-status guard, mirroring requireDraftBuild/requireDraftList in Steps 7/8. */
async function requireDraftDesign(supabase: SupabaseClient, projectId: string): Promise<CoverDesignRow> {
  const { data: design, error } = await supabase.from('cover_designs').select('*').eq('project_id', projectId).single();
  if (error || !design) throw new Error(`No cover design found for project: ${error?.message}`);
  if (design.status !== 'draft') throw new Error('Cover design is confirmed — unlock it first');
  return design as CoverDesignRow;
}

interface GenerateInitialCandidateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  /** Only meaningful on regenerate — overrides the current look for this attempt. */
  lookId?: string;
  /** Required (must be true) once the 3-candidate cap is reached — decision 15's hard-cap gate. */
  acknowledgeAdditionalCost?: boolean;
}

export interface GenerateInitialCandidateResult {
  design: CoverDesignRow;
  generation: CoverGenerationRow;
}

/**
 * §7.8's "Explicit Generate Cover" (first entry) and "Regenerate candidate" actions,
 * combined — same dual-purpose shape every prior phase's generate function used.
 * NEVER auto-fires (decision 6) — requires either an existing cover_designs row
 * (regenerate path) or projects.status='content_confirmed' (first-entry path).
 */
export async function generateInitialCandidate(params: GenerateInitialCandidateParams): Promise<GenerateInitialCandidateResult> {
  const { supabase, projectId, workspaceId, lookId, acknowledgeAdditionalCost } = params;

  const { data: project, error: projectErr } = await supabase.from('projects').select('status').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: existingDesign, error: existingErr } = await supabase.from('cover_designs').select('*').eq('project_id', projectId).maybeSingle();
  if (existingErr) throw new Error(`Failed to check for existing cover design: ${existingErr.message}`);

  const isRegenerate = !!existingDesign;
  if (!isRegenerate && project.status !== 'content_confirmed') {
    throw new Error('Project has not reached content_confirmed — cannot generate a cover yet (decision 6: no auto-fire, this must be called explicitly)');
  }
  if (isRegenerate) {
    if (existingDesign.status === 'confirmed') throw new Error('Cannot regenerate a confirmed cover design directly — unlock it first');
    assertCandidateCapNotExceeded(existingDesign.candidate_count, acknowledgeAdditionalCost);
  }

  const ctx = await loadGenerationContext(supabase, projectId);
  const effectiveLookId = lookId ?? existingDesign?.confirmed_look_id ?? DEFAULT_LOOK_ID;
  const look = getLookById(effectiveLookId);
  if (!look) throw new Error(`Unknown look id: ${effectiveLookId}`);

  let designId = existingDesign?.id;
  if (!isRegenerate) {
    const { data: insertedDesign, error: insertDesignErr } = await supabase
      .from('cover_designs')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title_candidate_id: ctx.candidate.id,
        format_recommendation_id: ctx.formatRec.id,
        content_build_confirmed_at: ctx.contentBuildSnapshotAt,
        recommended_look_id: DEFAULT_LOOK_ID,
        recommendation_reason: "Default placeholder look — Arman's real template recommendation logic is not yet built (decision 16).",
        confirmed_look_id: effectiveLookId,
        look_is_overridden: effectiveLookId !== DEFAULT_LOOK_ID,
      })
      .select('id')
      .single();
    if (insertDesignErr || !insertedDesign) throw new Error(`Failed to create cover design: ${insertDesignErr?.message}`);
    designId = insertedDesign.id;
  }
  if (!designId) throw new Error('Internal error: no cover design id available');

  const generationNumber = await nextGenerationNumber(supabase, designId);
  const generationId = crypto.randomUUID();

  let generationStatus: CoverGenerationStatus = 'succeeded';
  let geminiInteractionId: string | null = null;
  let costUsd: number | null = null;
  let assetStoragePath: string | null = null;
  let model: string | null = NANOBANANA_MODEL;
  let errorDetail: string | null = null;

  try {
    const candidate = await generateCoverCandidate({
      title: ctx.candidate.candidate_text,
      rationale: ctx.rationale,
      confirmedFormat: ctx.formatRec.confirmed_format,
      lookId: effectiveLookId,
    });
    geminiInteractionId = candidate.interactionId;
    costUsd = candidate.costUsd;

    const composited = await renderCoverImage({
      look,
      title: ctx.candidate.candidate_text,
      artBase64: candidate.imageDataBase64,
      artMimeType: candidate.mimeType,
    });
    assetStoragePath = await uploadCoverAsset({
      supabase,
      workspaceId,
      projectId,
      coverGenerationId: generationId,
      buffer: composited,
      contentType: 'image/png',
    });
  } catch (err) {
    // Decision 10's continuation: an honest failed state, no fabricated asset.
    generationStatus = 'failed_fallback';
    model = 'fallback-no-image';
    errorDetail = err instanceof Error ? err.message : 'Cover candidate generation failed';
  }

  const { data: generation, error: genInsertErr } = await supabase
    .from('cover_generations')
    .insert({
      id: generationId,
      workspace_id: workspaceId,
      project_id: projectId,
      cover_design_id: designId,
      generation_number: generationNumber,
      trigger_scope: 'initial_candidate',
      look_id: effectiveLookId,
      gemini_interaction_id: geminiInteractionId,
      asset_storage_path: assetStoragePath,
      model,
      cost_usd: costUsd,
      generation_status: generationStatus,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genInsertErr || !generation) throw new Error(`Failed to persist cover generation row: ${genInsertErr?.message}`);

  const { data: updatedDesign, error: designUpdateErr } = await supabase
    .from('cover_designs')
    .update({
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      content_build_confirmed_at: ctx.contentBuildSnapshotAt,
      confirmed_look_id: effectiveLookId,
      look_is_overridden: effectiveLookId !== DEFAULT_LOOK_ID,
      current_cover_generation_id: generationStatus === 'succeeded' ? generation.id : (existingDesign?.current_cover_generation_id ?? null),
      candidate_count: isRegenerate ? existingDesign.candidate_count + 1 : 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', designId)
    .select()
    .single();
  if (designUpdateErr || !updatedDesign) throw new Error(`Failed to update cover design: ${designUpdateErr?.message}`);

  const { error: projectUpdateErr } = await supabase.from('projects').update({ status: 'design_generating' }).eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project status: ${projectUpdateErr.message}`);

  return { design: updatedDesign as CoverDesignRow, generation: generation as CoverGenerationRow };
}

interface ApproveParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
}

/** §7.8's Approve action — atomic confirm + approval, the one deterministic hard rule this phase has (§8 rule 1). */
export async function approve(params: ApproveParams): Promise<CoverDesignRow> {
  const { supabase, projectId, userId } = params;
  const design = await requireDraftDesign(supabase, projectId);
  assertCanApprove(design.current_cover_generation_id);

  const { data: updated, error: updateErr } = await supabase
    .from('cover_designs')
    .update({ status: 'confirmed', approval_status: 'approved', approved_at: new Date().toISOString(), approved_by: userId })
    .eq('id', design.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to approve cover design: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'cover_approved' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as CoverDesignRow;
}

interface UnlockParams {
  supabase: SupabaseClient;
  projectId: string;
}

/** Content-preserving unlock — nothing in `cover_generations` or Storage is touched. */
export async function unlockCoverDesign(params: UnlockParams): Promise<CoverDesignRow> {
  const { supabase, projectId } = params;

  const { data: existing, error: existingErr } = await supabase.from('cover_designs').select('id, status').eq('project_id', projectId).single();
  if (existingErr || !existing) throw new Error(`No cover design found for project: ${existingErr?.message}`);
  if (existing.status !== 'confirmed') throw new Error('Cover design is not confirmed — nothing to unlock');

  const { data: updated, error: updateErr } = await supabase
    .from('cover_designs')
    .update({ status: 'draft', approval_status: 'pending', approved_at: null, approved_by: null })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to unlock cover design: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'design_generating' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as CoverDesignRow;
}

interface GetCurrentParams {
  supabase: SupabaseClient;
  projectId: string;
}

export interface GetCurrentCoverDesignResult {
  design: CoverDesignRow | null;
  isStale: boolean;
  staleReason: DocumentStalenessReason;
}

/**
 * §7.10's three-dependency soft staleness check — mirrors getCurrentContentBuild/
 * getCurrentSubtopicList exactly. Content untouched either way; a confirmed design
 * reverts to draft (approval cleared) if stale.
 */
export async function getCurrentCoverDesign(params: GetCurrentParams): Promise<GetCurrentCoverDesignResult> {
  const { supabase, projectId } = params;

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: design, error: designErr } = await supabase.from('cover_designs').select('*').eq('project_id', projectId).maybeSingle();
  if (designErr) throw new Error(`Failed to load cover design: ${designErr.message}`);
  if (!design) return { design: null, isStale: false, staleReason: null };

  const { data: contentBuild, error: contentBuildErr } = await supabase
    .from('content_builds')
    .select('confirmed_at, updated_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (contentBuildErr) throw new Error(`Failed to load content build for staleness check: ${contentBuildErr.message}`);

  const staleReason = detectDocumentStalenessReason(
    {
      titleCandidateId: design.title_candidate_id,
      formatRecommendationId: design.format_recommendation_id,
      contentBuildConfirmedAt: design.content_build_confirmed_at,
    },
    {
      selectedCandidateId: project.selected_candidate_id,
      currentFormatRecommendationId: project.current_format_recommendation_id,
      contentBuildSnapshotAt: contentBuild ? (contentBuild.confirmed_at ?? contentBuild.updated_at) : null,
    },
  );

  let currentDesign = design as CoverDesignRow;
  if (staleReason !== null && currentDesign.status === 'confirmed') {
    const { data: reverted, error: revertErr } = await supabase
      .from('cover_designs')
      .update({ status: 'draft', approval_status: 'pending', approved_at: null, approved_by: null })
      .eq('id', currentDesign.id)
      .select()
      .single();
    if (revertErr || !reverted) throw new Error(`Failed to revert stale confirmed cover design: ${revertErr?.message}`);
    currentDesign = reverted as CoverDesignRow;

    const { error: statusErr } = await supabase.from('projects').update({ status: 'design_generating' }).eq('id', projectId);
    if (statusErr) throw new Error(`Failed to revert project status for stale cover design: ${statusErr.message}`);
  }

  return { design: currentDesign, isStale: staleReason !== null, staleReason };
}
