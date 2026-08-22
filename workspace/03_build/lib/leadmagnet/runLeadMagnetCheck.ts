import type { SupabaseClient } from '@supabase/supabase-js';
import { recommendLeadMagnet } from './recommendLeadMagnet';
import { fallbackLeadMagnetRecommendation } from './fallbackRecommendation';
import { applyLeadMagnetGuardrail } from './guardrail';
import { GROQ_MODEL } from '../ai/groq';
import { detectStalenessReason, hasReachedReconsiderCap, assertValidConfirmation, computeIsOverride } from './rules';
import type { LeadMagnetType } from './types';

export interface LeadMagnetRecommendationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  recommended_suitable: boolean;
  recommended_type: LeadMagnetType | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning_summary: string;
  reasoning_signals: unknown;
  alternate_type_considered: LeadMagnetType | null;
  inputs_snapshot: unknown;
  model: string;
  generation_status: 'succeeded' | 'failed_fallback' | 'failed_blocked';
  confirmed_suitable: boolean | null;
  confirmed_type: LeadMagnetType | null;
  is_override: boolean | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  recommendation_status: 'active' | 'superseded';
  superseded_at: string | null;
  superseded_reason: string | null;
}

/**
 * §1.6's dual staleness check. Unlike Step 4's single-dependency version, this
 * compares the active row against BOTH the project's selected title AND its current
 * format recommendation. On format_changed, projects.status is left alone here — Step
 * 4's own changeFormat()/re-confirm already sets it back to 'format_recommending'
 * (already-built code, verified in Step 4). On title_changed, no equivalent "Change
 * Selection" orchestration function exists yet in this codebase (only the RLS/data
 * model from Phase 1 does) — so projects.status reversion to 'researching' for that
 * case is a dependency on future work, not something this function can rely on today.
 */
async function invalidateIfStale(supabase: SupabaseClient, projectId: string): Promise<void> {
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_lead_magnet_recommendation_id, selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_lead_magnet_recommendation_id) return;

  const { data: activeRow, error: rowErr } = await supabase
    .from('lead_magnet_recommendations')
    .select('id, title_candidate_id, format_recommendation_id, recommendation_status')
    .eq('id', project.current_lead_magnet_recommendation_id)
    .single();
  if (rowErr || !activeRow || activeRow.recommendation_status !== 'active') return;

  const reason = detectStalenessReason(
    { titleCandidateId: activeRow.title_candidate_id, formatRecommendationId: activeRow.format_recommendation_id },
    { selectedCandidateId: project.selected_candidate_id, currentFormatRecommendationId: project.current_format_recommendation_id },
  );
  if (!reason) return;

  const { error: supersedeErr } = await supabase
    .from('lead_magnet_recommendations')
    .update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString(), superseded_reason: reason })
    .eq('id', activeRow.id);
  if (supersedeErr) throw new Error(`Failed to supersede stale recommendation: ${supersedeErr.message}`);

  const { error: clearErr } = await supabase
    .from('projects')
    .update({ current_lead_magnet_recommendation_id: null })
    .eq('id', projectId);
  if (clearErr) throw new Error(`Failed to clear stale recommendation pointer: ${clearErr.message}`);
}

interface GenerateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/** Handles both first-entry and Reconsider (§1.6), mirroring lib/format's pattern. */
export async function generateLeadMagnetRecommendation(params: GenerateParams): Promise<LeadMagnetRecommendationRow> {
  const { supabase, projectId, workspaceId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_lead_magnet_recommendation_id, selected_candidate_id, current_format_recommendation_id, status')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.selected_candidate_id) throw new Error('Project has no selected title candidate');
  if (!project.current_format_recommendation_id) throw new Error('Project has no format recommendation yet');

  const isReconsider = !!project.current_lead_magnet_recommendation_id;
  if (isReconsider && project.status === 'lead_magnet_reviewed') {
    throw new Error('Cannot reconsider a confirmed recommendation directly — use changeLeadMagnetRecommendation first');
  }

  if (isReconsider) {
    const { count, error: countErr } = await supabase
      .from('lead_magnet_recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('superseded_reason', 'user_requested_reconsider');
    if (countErr) throw new Error(`Failed to count prior reconsiders: ${countErr.message}`);
    if (hasReachedReconsiderCap(count ?? 0)) {
      throw new Error('Reconsider cap reached for this project (decision 11)');
    }

    const { error: supersedeErr } = await supabase
      .from('lead_magnet_recommendations')
      .update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString(), superseded_reason: 'user_requested_reconsider' })
      .eq('id', project.current_lead_magnet_recommendation_id as string);
    if (supersedeErr) throw new Error(`Failed to supersede prior recommendation: ${supersedeErr.message}`);
  }

  // §2.1: Step 5 reasons over Step 4's CONFIRMED format, not just any active row —
  // confirmed_format is null until the user has actually confirmed it.
  const { data: formatRow, error: formatErr } = await supabase
    .from('format_recommendations')
    .select('confirmed_format, confirmed_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (formatErr || !formatRow) throw new Error(`Format recommendation not found: ${formatErr?.message}`);
  if (!formatRow.confirmed_format) {
    throw new Error('Format recommendation is not yet confirmed — cannot generate a lead magnet check');
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
    result = await recommendLeadMagnet({
      title: candidate.candidate_text,
      rationale: idea.rationale,
      demandScore: candidate.demand_score,
      demandSignalDetail: candidate.demand_signal_detail,
      competitionScore: candidate.competition_score,
      competitionSignalDetail: candidate.competition_signal_detail,
      confirmedFormat: formatRow.confirmed_format,
      confirmedDeliveryMode: formatRow.confirmed_delivery_mode,
    });
  } catch {
    generationStatus = 'failed_fallback';
    result = applyLeadMagnetGuardrail(fallbackLeadMagnetRecommendation());
  }

  const inputsSnapshot = {
    title: candidate.candidate_text,
    rationale: idea.rationale,
    demand_score: candidate.demand_score,
    demand_signal_detail: candidate.demand_signal_detail,
    competition_score: candidate.competition_score,
    competition_signal_detail: candidate.competition_signal_detail,
    confirmed_format: formatRow.confirmed_format,
    confirmed_delivery_mode: formatRow.confirmed_delivery_mode,
  };

  const { data: newRow, error: insertErr } = await supabase
    .from('lead_magnet_recommendations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: candidate.id,
      format_recommendation_id: project.current_format_recommendation_id,
      recommended_suitable: result.recommendedSuitable,
      recommended_type: result.recommendedType,
      confidence: result.confidence,
      reasoning_summary: result.reasoningSummary,
      reasoning_signals: result.reasoningSignals,
      alternate_type_considered: result.alternateTypeConsidered,
      inputs_snapshot: inputsSnapshot,
      model: generationStatus === 'succeeded' ? GROQ_MODEL : 'fallback-heuristic',
      generation_status: generationStatus,
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newRow) throw new Error(`Failed to persist lead_magnet_recommendations row: ${insertErr?.message}`);

  const { error: projectUpdateErr } = await supabase
    .from('projects')
    .update({ current_lead_magnet_recommendation_id: newRow.id, status: 'lead_magnet_checking' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newRow as LeadMagnetRecommendationRow;
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  confirmedSuitable: boolean;
  confirmedType: LeadMagnetType | null;
}

/**
 * Handles both outcomes ("yes + type" and "no") through the same function — decision 5
 * treats "no" as a lighter-weight UI action, not a different code path or a silent skip.
 */
export async function confirmLeadMagnetRecommendation(params: ConfirmParams): Promise<LeadMagnetRecommendationRow> {
  const { supabase, projectId, userId, confirmedSuitable, confirmedType } = params;
  assertValidConfirmation(confirmedSuitable, confirmedType);
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_lead_magnet_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_lead_magnet_recommendation_id) {
    throw new Error('No active lead magnet recommendation to confirm — generate one first');
  }

  const { data: activeRow, error: rowErr } = await supabase
    .from('lead_magnet_recommendations')
    .select('recommended_suitable, recommended_type')
    .eq('id', project.current_lead_magnet_recommendation_id)
    .single();
  if (rowErr || !activeRow) throw new Error(`Active recommendation row not found: ${rowErr?.message}`);

  const isOverride = computeIsOverride(
    { suitable: activeRow.recommended_suitable, type: activeRow.recommended_type },
    { suitable: confirmedSuitable, type: confirmedType },
  );

  const { data: updated, error: updateErr } = await supabase
    .from('lead_magnet_recommendations')
    .update({
      confirmed_suitable: confirmedSuitable,
      confirmed_type: confirmedType,
      is_override: isOverride,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', project.current_lead_magnet_recommendation_id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm recommendation: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'lead_magnet_reviewed' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as LeadMagnetRecommendationRow;
}

interface ChangeParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/** §1.6: supersede-and-copy-forward, same mechanics as lib/format's changeFormat. */
export async function changeLeadMagnetRecommendation(params: ChangeParams): Promise<LeadMagnetRecommendationRow> {
  const { supabase, projectId, workspaceId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_lead_magnet_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_lead_magnet_recommendation_id) throw new Error('No active recommendation to change');

  const { data: activeRow, error: rowErr } = await supabase
    .from('lead_magnet_recommendations')
    .select('*')
    .eq('id', project.current_lead_magnet_recommendation_id)
    .single();
  if (rowErr || !activeRow) throw new Error(`Active recommendation row not found: ${rowErr?.message}`);
  if (!activeRow.confirmed_at) throw new Error('Cannot Change before confirming — use Reconsider instead');

  const { error: supersedeErr } = await supabase
    .from('lead_magnet_recommendations')
    .update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString(), superseded_reason: 'user_requested_change' })
    .eq('id', activeRow.id);
  if (supersedeErr) throw new Error(`Failed to supersede confirmed recommendation: ${supersedeErr.message}`);

  const { data: newRow, error: insertErr } = await supabase
    .from('lead_magnet_recommendations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: activeRow.title_candidate_id,
      format_recommendation_id: activeRow.format_recommendation_id,
      recommended_suitable: activeRow.recommended_suitable,
      recommended_type: activeRow.recommended_type,
      confidence: activeRow.confidence,
      reasoning_summary: activeRow.reasoning_summary,
      reasoning_signals: activeRow.reasoning_signals,
      alternate_type_considered: activeRow.alternate_type_considered,
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
    .update({ current_lead_magnet_recommendation_id: newRow.id, status: 'lead_magnet_checking' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newRow as LeadMagnetRecommendationRow;
}

interface GetActiveParams {
  supabase: SupabaseClient;
  projectId: string;
}

export async function getActiveLeadMagnetRecommendation(params: GetActiveParams): Promise<LeadMagnetRecommendationRow | null> {
  const { supabase, projectId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_lead_magnet_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_lead_magnet_recommendation_id) return null;

  const { data: row, error: rowErr } = await supabase
    .from('lead_magnet_recommendations')
    .select('*')
    .eq('id', project.current_lead_magnet_recommendation_id)
    .single();
  if (rowErr) throw new Error(`Failed to load active recommendation: ${rowErr.message}`);

  return (row as LeadMagnetRecommendationRow) ?? null;
}
