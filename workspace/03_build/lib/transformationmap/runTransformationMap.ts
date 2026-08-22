import type { SupabaseClient } from '@supabase/supabase-js';
import { generateTransformationMap } from './generateTransformationMap';
import { transformationMapFallbackScaffold } from './fallbackScaffold';
import { applyTransformationMapGuardrail } from './guardrail';
import { GROQ_MODEL } from '../ai/groq';
import { isTitleStale, hasReachedRegenerateCap } from './rules';
import type { TransformationMapContent } from './types';

export interface TransformationMapRow {
  id: string;
  workspace_id: string;
  project_id: string;
  source_generation_id: string;
  title_candidate_id: string;
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
  is_edited: boolean;
  last_edited_at: string | null;
  last_edited_by: string | null;
  status: 'draft' | 'confirmed';
  confirmed_at: string | null;
  confirmed_by: string | null;
  regenerate_count: number;
  created_at: string;
  updated_at: string;
}

function contentToRow(content: TransformationMapContent) {
  return {
    headline_before: content.headlineBefore,
    headline_after: content.headlineAfter,
    dim_emotional_before: content.dimEmotionalBefore,
    dim_emotional_after: content.dimEmotionalAfter,
    dim_practical_before: content.dimPracticalBefore,
    dim_practical_after: content.dimPracticalAfter,
    dim_identity_before: content.dimIdentityBefore,
    dim_identity_after: content.dimIdentityAfter,
    dim_pain_point_before: content.dimPainPointBefore,
    dim_pain_point_after: content.dimPainPointAfter,
  };
}

interface GenerateOrRegenerateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  /** Required (must be true) to regenerate over an existing row with is_edited=true — decision 10's safety rail. */
  acknowledgeOverwrite?: boolean;
}

/**
 * Handles both first-entry auto-fire and explicit Regenerate through one function
 * (§1.6). Unlike Steps 4/5's generate, this never supersedes a row — it either creates
 * the 1:1 transformation_maps row (first entry) or overwrites its content fields in
 * place (regenerate), always logging a new transformation_map_generations row either way.
 */
export async function generateOrRegenerateTransformationMap(params: GenerateOrRegenerateParams): Promise<TransformationMapRow> {
  const { supabase, projectId, workspaceId, acknowledgeOverwrite } = params;

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('selected_candidate_id, status')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.selected_candidate_id) throw new Error('Project has no selected title candidate');

  const { data: existingMap, error: existingErr } = await supabase
    .from('transformation_maps')
    .select('id, status, is_edited, regenerate_count')
    .eq('project_id', projectId)
    .maybeSingle();
  if (existingErr) throw new Error(`Failed to check for existing map: ${existingErr.message}`);

  const isRegenerate = !!existingMap;
  if (isRegenerate) {
    if (existingMap.status === 'confirmed') {
      throw new Error('Cannot regenerate a confirmed map directly — unlock it first');
    }
    if (hasReachedRegenerateCap(existingMap.regenerate_count)) {
      throw new Error('Regenerate cap reached for this project (decision 9)');
    }
    if (existingMap.is_edited && acknowledgeOverwrite !== true) {
      throw new Error('This map has unsaved manual edits — pass acknowledgeOverwrite=true to confirm overwriting them (decision 10)');
    }
  }

  const { data: lastGen } = await supabase
    .from('transformation_map_generations')
    .select('generation_number')
    .eq('project_id', projectId)
    .order('generation_number', { ascending: false })
    .limit(1);
  const generationNumber = (lastGen?.[0]?.generation_number ?? 0) + 1;

  const { data: candidate, error: candidateErr } = await supabase
    .from('title_candidates')
    .select('id, candidate_text, demand_score, demand_signal_detail, competition_score, competition_signal_detail')
    .eq('id', project.selected_candidate_id)
    .single();
  if (candidateErr || !candidate) throw new Error(`Selected title candidate not found: ${candidateErr?.message}`);

  const { data: idea, error: ideaErr } = await supabase.from('title_ideas').select('rationale').eq('project_id', projectId).single();
  if (ideaErr || !idea) throw new Error(`title_ideas row not found for project: ${ideaErr?.message}`);

  let generationStatus: 'succeeded' | 'failed_fallback' = 'succeeded';
  let content: TransformationMapContent;
  try {
    content = await generateTransformationMap({
      title: candidate.candidate_text,
      rationale: idea.rationale,
      demandScore: candidate.demand_score,
      demandSignalDetail: candidate.demand_signal_detail,
      competitionScore: candidate.competition_score,
      competitionSignalDetail: candidate.competition_signal_detail,
    });
  } catch {
    generationStatus = 'failed_fallback';
    content = applyTransformationMapGuardrail(transformationMapFallbackScaffold());
  }

  const inputsSnapshot = {
    title: candidate.candidate_text,
    rationale: idea.rationale,
    demand_score: candidate.demand_score,
    demand_signal_detail: candidate.demand_signal_detail,
    competition_score: candidate.competition_score,
    competition_signal_detail: candidate.competition_signal_detail,
  };

  const { data: newGeneration, error: genInsertErr } = await supabase
    .from('transformation_map_generations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      generation_number: generationNumber,
      title_candidate_id: candidate.id,
      inputs_snapshot: inputsSnapshot,
      ...contentToRow(content),
      model: generationStatus === 'succeeded' ? GROQ_MODEL : 'fallback-scaffold',
      generation_status: generationStatus,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genInsertErr || !newGeneration) throw new Error(`Failed to persist generation row: ${genInsertErr?.message}`);

  let mapRow: TransformationMapRow;
  if (isRegenerate) {
    const { data: updated, error: updateErr } = await supabase
      .from('transformation_maps')
      .update({
        source_generation_id: newGeneration.id,
        title_candidate_id: candidate.id,
        ...contentToRow(content),
        is_edited: false,
        regenerate_count: existingMap.regenerate_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingMap.id)
      .select()
      .single();
    if (updateErr || !updated) throw new Error(`Failed to overwrite map on regenerate: ${updateErr?.message}`);
    mapRow = updated as TransformationMapRow;
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('transformation_maps')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        source_generation_id: newGeneration.id,
        title_candidate_id: candidate.id,
        ...contentToRow(content),
      })
      .select()
      .single();
    if (insertErr || !inserted) throw new Error(`Failed to create map on first entry: ${insertErr?.message}`);
    mapRow = inserted as TransformationMapRow;
  }

  const { error: projectUpdateErr } = await supabase
    .from('projects')
    .update({ current_transformation_map_generation_id: newGeneration.id, status: 'transformation_mapping' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return mapRow;
}

interface EditFieldParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  updates: Partial<{
    headlineBefore: string;
    headlineAfter: string;
    dimEmotionalBefore: string;
    dimEmotionalAfter: string;
    dimPracticalBefore: string;
    dimPracticalAfter: string;
    dimIdentityBefore: string;
    dimIdentityAfter: string;
    dimPainPointBefore: string;
    dimPainPointAfter: string;
  }>;
}

/** Direct field mutation, draft status only (§1.6) — DB trigger backs this up if status has changed underneath. */
export async function editTransformationMapField(params: EditFieldParams): Promise<TransformationMapRow> {
  const { supabase, projectId, userId, updates } = params;

  const { data: existing, error: existingErr } = await supabase
    .from('transformation_maps')
    .select('id, status')
    .eq('project_id', projectId)
    .single();
  if (existingErr || !existing) throw new Error(`No transformation map found for project: ${existingErr?.message}`);
  if (existing.status !== 'draft') throw new Error('Cannot edit while confirmed — unlock first');

  const columnUpdates: Record<string, string> = {};
  if (updates.headlineBefore !== undefined) columnUpdates.headline_before = updates.headlineBefore;
  if (updates.headlineAfter !== undefined) columnUpdates.headline_after = updates.headlineAfter;
  if (updates.dimEmotionalBefore !== undefined) columnUpdates.dim_emotional_before = updates.dimEmotionalBefore;
  if (updates.dimEmotionalAfter !== undefined) columnUpdates.dim_emotional_after = updates.dimEmotionalAfter;
  if (updates.dimPracticalBefore !== undefined) columnUpdates.dim_practical_before = updates.dimPracticalBefore;
  if (updates.dimPracticalAfter !== undefined) columnUpdates.dim_practical_after = updates.dimPracticalAfter;
  if (updates.dimIdentityBefore !== undefined) columnUpdates.dim_identity_before = updates.dimIdentityBefore;
  if (updates.dimIdentityAfter !== undefined) columnUpdates.dim_identity_after = updates.dimIdentityAfter;
  if (updates.dimPainPointBefore !== undefined) columnUpdates.dim_pain_point_before = updates.dimPainPointBefore;
  if (updates.dimPainPointAfter !== undefined) columnUpdates.dim_pain_point_after = updates.dimPainPointAfter;

  const { data: updated, error: updateErr } = await supabase
    .from('transformation_maps')
    .update({
      ...columnUpdates,
      is_edited: true,
      last_edited_at: new Date().toISOString(),
      last_edited_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to edit map field: ${updateErr?.message}`);

  return updated as TransformationMapRow;
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
}

export async function confirmTransformationMap(params: ConfirmParams): Promise<TransformationMapRow> {
  const { supabase, projectId, userId } = params;

  const { data: existing, error: existingErr } = await supabase
    .from('transformation_maps')
    .select('id, status')
    .eq('project_id', projectId)
    .single();
  if (existingErr || !existing) throw new Error(`No transformation map found for project: ${existingErr?.message}`);
  if (existing.status !== 'draft') throw new Error('Map is not in draft status — nothing to confirm');

  const { data: updated, error: updateErr } = await supabase
    .from('transformation_maps')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: userId })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm map: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'transformation_map_confirmed' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as TransformationMapRow;
}

interface UnlockParams {
  supabase: SupabaseClient;
  projectId: string;
}

/** Content-preserving unlock (decision 11) — unlike Phase 1's title-selection unlock, nothing here is cleared. */
export async function unlockTransformationMap(params: UnlockParams): Promise<TransformationMapRow> {
  const { supabase, projectId } = params;

  const { data: existing, error: existingErr } = await supabase
    .from('transformation_maps')
    .select('id, status')
    .eq('project_id', projectId)
    .single();
  if (existingErr || !existing) throw new Error(`No transformation map found for project: ${existingErr?.message}`);
  if (existing.status !== 'confirmed') throw new Error('Map is not confirmed — nothing to unlock');

  const { data: updated, error: updateErr } = await supabase
    .from('transformation_maps')
    .update({ status: 'draft', confirmed_at: null, confirmed_by: null })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to unlock map: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'transformation_mapping' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as TransformationMapRow;
}

interface GetCurrentParams {
  supabase: SupabaseClient;
  projectId: string;
}

export interface GetCurrentResult {
  map: TransformationMapRow | null;
  isStale: boolean;
}

/**
 * §4's soft staleness check — computed live, never persisted as a stored flag. If
 * stale and currently confirmed, performs the one side-effect decision 8 calls for
 * (revert to draft, revert projects.status) while leaving all 10 content fields
 * completely untouched.
 */
export async function getCurrentTransformationMap(params: GetCurrentParams): Promise<GetCurrentResult> {
  const { supabase, projectId } = params;

  const { data: project, error: projectErr } = await supabase.from('projects').select('selected_candidate_id').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: map, error: mapErr } = await supabase.from('transformation_maps').select('*').eq('project_id', projectId).maybeSingle();
  if (mapErr) throw new Error(`Failed to load transformation map: ${mapErr.message}`);
  if (!map) return { map: null, isStale: false };

  const stale = isTitleStale(map.title_candidate_id, project.selected_candidate_id);
  if (!stale) return { map: map as TransformationMapRow, isStale: false };

  if (map.status === 'confirmed') {
    const { data: reverted, error: revertErr } = await supabase
      .from('transformation_maps')
      .update({ status: 'draft', confirmed_at: null, confirmed_by: null })
      .eq('id', map.id)
      .select()
      .single();
    if (revertErr || !reverted) throw new Error(`Failed to revert stale confirmed map: ${revertErr?.message}`);

    const { error: statusErr } = await supabase.from('projects').update({ status: 'transformation_mapping' }).eq('id', projectId);
    if (statusErr) throw new Error(`Failed to revert project status for stale map: ${statusErr.message}`);

    return { map: reverted as TransformationMapRow, isStale: true };
  }

  return { map: map as TransformationMapRow, isStale: true };
}
