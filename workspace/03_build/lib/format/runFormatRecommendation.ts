import type { SupabaseClient } from '@supabase/supabase-js';
import { recommendFormat } from './recommendFormat';
import { fallbackFormatRecommendation } from './fallbackHeuristic';
import { applyFormatGuardrail } from './guardrail';
import { GROQ_MODEL } from '../ai/groq';
import { isRecommendationStale, hasReachedReconsiderCap, assertValidConfirmation, computeIsOverride } from './rules';
import type { FormatType, DeliveryMode } from './types';

export interface FormatRecommendationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  recommended_format: FormatType;
  recommended_delivery_mode: DeliveryMode | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning_summary: string;
  reasoning_signals: unknown;
  alternate_format_considered: FormatType | null;
  inputs_snapshot: unknown;
  model: string;
  generation_status: 'succeeded' | 'failed_fallback' | 'failed_blocked';
  confirmed_format: FormatType | null;
  confirmed_delivery_mode: DeliveryMode | null;
  is_override: boolean | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  recommendation_status: 'active' | 'superseded';
  superseded_at: string | null;
  superseded_reason: string | null;
}

/**
 * §1.6's lazy staleness check. Compares the active row's snapshotted title against the
 * project's currently selected title; if they've diverged (the user changed their
 * title selection via Step 2/3's "Change Selection", which knows nothing about Step 4),
 * supersedes the stale row and clears the project's pointer. Called at the start of
 * every function below, so callers never have to think about staleness themselves.
 */
async function invalidateIfStale(supabase: SupabaseClient, projectId: string): Promise<void> {
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_format_recommendation_id, selected_candidate_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_format_recommendation_id) return;

  const { data: activeRow, error: rowErr } = await supabase
    .from('format_recommendations')
    .select('id, title_candidate_id, recommendation_status')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (rowErr || !activeRow || activeRow.recommendation_status !== 'active') return;

  if (isRecommendationStale(activeRow.title_candidate_id, project.selected_candidate_id)) {
    const { error: supersedeErr } = await supabase
      .from('format_recommendations')
      .update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString(), superseded_reason: 'title_changed' })
      .eq('id', activeRow.id);
    if (supersedeErr) throw new Error(`Failed to supersede stale recommendation: ${supersedeErr.message}`);

    const { error: clearErr } = await supabase
      .from('projects')
      .update({ current_format_recommendation_id: null })
      .eq('id', projectId);
    if (clearErr) throw new Error(`Failed to clear stale recommendation pointer: ${clearErr.message}`);
  }
}

interface GenerateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/**
 * Handles both "first entry into Step 4" and "Reconsider" (§1.6) — the DB operations
 * are nearly identical; the only difference is whether an active row exists to
 * supersede first, and whether the reconsider cap applies.
 */
export async function generateFormatRecommendation(params: GenerateParams): Promise<FormatRecommendationRow> {
  const { supabase, projectId, workspaceId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_format_recommendation_id, selected_candidate_id, status')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.selected_candidate_id) {
    throw new Error('Project has no selected title candidate — cannot generate a format recommendation yet');
  }

  const isReconsider = !!project.current_format_recommendation_id;
  if (isReconsider && project.status === 'format_selected') {
    throw new Error('Cannot reconsider a confirmed recommendation directly — use changeFormat first');
  }

  if (isReconsider) {
    const { count, error: countErr } = await supabase
      .from('format_recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('superseded_reason', 'user_requested_reconsider');
    if (countErr) throw new Error(`Failed to count prior reconsiders: ${countErr.message}`);
    if (hasReachedReconsiderCap(count ?? 0)) {
      throw new Error('Reconsider cap reached for this project (decision 8)');
    }

    const { error: supersedeErr } = await supabase
      .from('format_recommendations')
      .update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString(), superseded_reason: 'user_requested_reconsider' })
      .eq('id', project.current_format_recommendation_id as string);
    if (supersedeErr) throw new Error(`Failed to supersede prior recommendation: ${supersedeErr.message}`);
  }

  const { data: candidate, error: candidateErr } = await supabase
    .from('title_candidates')
    .select('id, candidate_text, demand_score, demand_signal_detail, competition_score, competition_signal_detail')
    .eq('id', project.selected_candidate_id)
    .single();
  if (candidateErr || !candidate) throw new Error(`Selected title candidate not found: ${candidateErr?.message}`);

  const { data: idea, error: ideaErr } = await supabase
    .from('title_ideas')
    .select('rationale')
    .eq('project_id', projectId)
    .single();
  if (ideaErr || !idea) throw new Error(`title_ideas row not found for project: ${ideaErr?.message}`);

  let generationStatus: 'succeeded' | 'failed_fallback' = 'succeeded';
  let result;
  try {
    result = await recommendFormat({
      title: candidate.candidate_text,
      rationale: idea.rationale,
      demandScore: candidate.demand_score,
      demandSignalDetail: candidate.demand_signal_detail,
      competitionScore: candidate.competition_score,
      competitionSignalDetail: candidate.competition_signal_detail,
    });
  } catch {
    // Decision 1: deterministic fallback, not a hard failure of Step 4 entirely.
    generationStatus = 'failed_fallback';
    result = applyFormatGuardrail(fallbackFormatRecommendation(candidate.candidate_text, idea.rationale));
  }

  const inputsSnapshot = {
    title: candidate.candidate_text,
    rationale: idea.rationale,
    demand_score: candidate.demand_score,
    demand_signal_detail: candidate.demand_signal_detail,
    competition_score: candidate.competition_score,
    competition_signal_detail: candidate.competition_signal_detail,
  };

  const { data: newRow, error: insertErr } = await supabase
    .from('format_recommendations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: candidate.id,
      recommended_format: result.recommendedFormat,
      recommended_delivery_mode: result.recommendedDeliveryMode,
      confidence: result.confidence,
      reasoning_summary: result.reasoningSummary,
      reasoning_signals: result.reasoningSignals,
      alternate_format_considered: result.alternateFormatConsidered,
      inputs_snapshot: inputsSnapshot,
      model: generationStatus === 'succeeded' ? GROQ_MODEL : 'fallback-heuristic',
      generation_status: generationStatus,
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newRow) throw new Error(`Failed to persist format_recommendations row: ${insertErr?.message}`);

  const { error: projectUpdateErr } = await supabase
    .from('projects')
    .update({ current_format_recommendation_id: newRow.id, status: 'format_recommending' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newRow as FormatRecommendationRow;
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  confirmedFormat: FormatType;
  confirmedDeliveryMode: DeliveryMode | null;
}

/** §1.6: confirm-in-place — fills confirmation fields on the existing active row, no new row. */
export async function confirmFormatRecommendation(params: ConfirmParams): Promise<FormatRecommendationRow> {
  const { supabase, projectId, userId, confirmedFormat, confirmedDeliveryMode } = params;
  assertValidConfirmation(confirmedFormat, confirmedDeliveryMode);
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_format_recommendation_id) {
    throw new Error('No active format recommendation to confirm — generate one first');
  }

  const { data: activeRow, error: rowErr } = await supabase
    .from('format_recommendations')
    .select('recommended_format, recommended_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (rowErr || !activeRow) throw new Error(`Active recommendation row not found: ${rowErr?.message}`);

  const isOverride = computeIsOverride(
    { format: activeRow.recommended_format, deliveryMode: activeRow.recommended_delivery_mode },
    { format: confirmedFormat, deliveryMode: confirmedDeliveryMode },
  );

  const { data: updated, error: updateErr } = await supabase
    .from('format_recommendations')
    .update({
      confirmed_format: confirmedFormat,
      confirmed_delivery_mode: confirmedDeliveryMode,
      is_override: isOverride,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', project.current_format_recommendation_id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm recommendation: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'format_selected' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as FormatRecommendationRow;
}

interface ChangeFormatParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/** §1.6: supersede-and-copy-forward — preserves the prior confirmation as history, per decision 4. */
export async function changeFormat(params: ChangeFormatParams): Promise<FormatRecommendationRow> {
  const { supabase, projectId, workspaceId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_format_recommendation_id) throw new Error('No active recommendation to change');

  const { data: activeRow, error: rowErr } = await supabase
    .from('format_recommendations')
    .select('*')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (rowErr || !activeRow) throw new Error(`Active recommendation row not found: ${rowErr?.message}`);
  if (!activeRow.confirmed_at) throw new Error('Cannot Change Format before confirming — use Reconsider instead');

  const { error: supersedeErr } = await supabase
    .from('format_recommendations')
    .update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString(), superseded_reason: 'user_requested_format_change' })
    .eq('id', activeRow.id);
  if (supersedeErr) throw new Error(`Failed to supersede confirmed recommendation: ${supersedeErr.message}`);

  const { data: newRow, error: insertErr } = await supabase
    .from('format_recommendations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: activeRow.title_candidate_id,
      recommended_format: activeRow.recommended_format,
      recommended_delivery_mode: activeRow.recommended_delivery_mode,
      confidence: activeRow.confidence,
      reasoning_summary: activeRow.reasoning_summary,
      reasoning_signals: activeRow.reasoning_signals,
      alternate_format_considered: activeRow.alternate_format_considered,
      inputs_snapshot: activeRow.inputs_snapshot,
      model: activeRow.model,
      generation_status: activeRow.generation_status,
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newRow) throw new Error(`Failed to copy recommendation forward: ${insertErr?.message}`);

  const { error: projectUpdateErr } = await supabase
    .from('projects')
    .update({ current_format_recommendation_id: newRow.id, status: 'format_recommending' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newRow as FormatRecommendationRow;
}

interface GetActiveParams {
  supabase: SupabaseClient;
  projectId: string;
}

/** Read-only: current active row (post-staleness-check), or null if none/just invalidated. */
export async function getActiveFormatRecommendation(params: GetActiveParams): Promise<FormatRecommendationRow | null> {
  const { supabase, projectId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_format_recommendation_id) return null;

  const { data: row, error: rowErr } = await supabase
    .from('format_recommendations')
    .select('*')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (rowErr) throw new Error(`Failed to load active recommendation: ${rowErr.message}`);

  return (row as FormatRecommendationRow) ?? null;
}
