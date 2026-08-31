import type { SupabaseClient } from '@supabase/supabase-js';
import { computeRecommendedPrice } from './formula';
import { generatePricingReasoningCall, fallbackPricingReasoning } from './generatePricingReasoning';
import { assertValidPrice } from './guardrail';
import { isPricingStale, hasReachedReconsiderCap, computeIsOverride, computePlatformIsOverride } from './rules';
import { PRICE_CEILING, PRICING_PLATFORMS } from './types';
import type { PricingPlatform, FormatType, DeliveryMode, PricingSupersedeReason } from './types';
import { GROQ_MODEL } from '../ai/groq';

// ── Row types (mirror the DB shape) ──────────────────────────────────────────

export interface PricingRecommendationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  export_page_count_snapshot: number;
  recommended_price: number;
  base_price: number;
  comparable_count: number;
  demand_competition_multiplier: number;
  depth_adjustment: number;
  reasoning_summary: string;
  reasoning_signals: unknown;
  inputs_snapshot: unknown;
  model: string;
  generation_status: 'succeeded' | 'failed_fallback' | 'failed_blocked';
  confirmed_price: number | null;
  is_override: boolean | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  recommendation_status: 'active' | 'superseded';
  superseded_at: string | null;
  superseded_reason: PricingSupersedeReason | null;
  created_at: string;
}

export interface PricingPlatformSuggestionRow {
  id: string;
  workspace_id: string;
  pricing_recommendation_id: string;
  platform: PricingPlatform;
  platform_multiplier: number;
  suggested_price: number;
  confirmed_price: number | null;
  is_override: boolean | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}

// ── Staleness check ──────────────────────────────────────────────────────────

/**
 * Lazy staleness check (§7.2). 3 dependencies: title, format, export page count.
 * Called at the start of every action so callers never think about staleness.
 */
async function invalidateIfStale(supabase: SupabaseClient, projectId: string): Promise<void> {
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_pricing_recommendation_id, selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_pricing_recommendation_id) return;

  const { data: activeRow, error: rowErr } = await supabase
    .from('pricing_recommendations')
    .select('id, title_candidate_id, format_recommendation_id, export_page_count_snapshot, recommendation_status')
    .eq('id', project.current_pricing_recommendation_id)
    .single();
  if (rowErr || !activeRow || activeRow.recommendation_status !== 'active') return;

  // Get the current approved export's page count (any approved format)
  const { data: approvedExport } = await supabase
    .from('export_format_states')
    .select('current_export_generation_id')
    .eq('project_id', projectId)
    .eq('approval_status', 'approved')
    .limit(1)
    .maybeSingle();

  let currentExportPageCount: number | null = null;
  if (approvedExport?.current_export_generation_id) {
    const { data: generation } = await supabase
      .from('export_generations')
      .select('page_count')
      .eq('id', approvedExport.current_export_generation_id)
      .single();
    currentExportPageCount = generation?.page_count ?? null;
  }

  const staleness = isPricingStale(
    {
      titleCandidateId: activeRow.title_candidate_id,
      formatRecommendationId: activeRow.format_recommendation_id,
      exportPageCountSnapshot: activeRow.export_page_count_snapshot,
    },
    {
      selectedCandidateId: project.selected_candidate_id,
      currentFormatRecommendationId: project.current_format_recommendation_id,
      currentExportPageCount,
    },
  );

  if (staleness.isStale) {
    const { error: supersedeErr } = await supabase
      .from('pricing_recommendations')
      .update({
        recommendation_status: 'superseded',
        superseded_at: new Date().toISOString(),
        superseded_reason: staleness.staleReason,
      })
      .eq('id', activeRow.id);
    if (supersedeErr) throw new Error(`Failed to supersede stale pricing: ${supersedeErr.message}`);

    const { error: clearErr } = await supabase
      .from('projects')
      .update({ current_pricing_recommendation_id: null, status: 'ready_to_download' })
      .eq('id', projectId);
    if (clearErr) throw new Error(`Failed to clear stale pricing pointer: ${clearErr.message}`);
  }
}

// ── Generate ─────────────────────────────────────────────────────────────────

interface GenerateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/**
 * Decision 6: explicit trigger only (no auto-fire). Handles both first-time
 * generation and reconsider (same pattern as Step 4's generateFormatRecommendation).
 */
export async function generatePricingRecommendation(
  params: GenerateParams,
): Promise<{ recommendation: PricingRecommendationRow; platformSuggestions: PricingPlatformSuggestionRow[] }> {
  const { supabase, projectId, workspaceId } = params;
  await invalidateIfStale(supabase, projectId);

  // Load project state
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_pricing_recommendation_id, selected_candidate_id, current_format_recommendation_id, status')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.selected_candidate_id) throw new Error('No selected title candidate');
  if (!project.current_format_recommendation_id) throw new Error('No confirmed format recommendation');

  const isReconsider = !!project.current_pricing_recommendation_id;
  if (isReconsider && project.status === 'pricing_confirmed') {
    throw new Error('Cannot reconsider a confirmed pricing — use changePricing first');
  }

  if (isReconsider) {
    const { count, error: countErr } = await supabase
      .from('pricing_recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('superseded_reason', 'user_requested_reconsider');
    if (countErr) throw new Error(`Failed to count prior reconsiders: ${countErr.message}`);
    if (hasReachedReconsiderCap(count ?? 0)) {
      throw new Error('Reconsider cap reached for this project (decision 9)');
    }

    const { error: supersedeErr } = await supabase
      .from('pricing_recommendations')
      .update({
        recommendation_status: 'superseded',
        superseded_at: new Date().toISOString(),
        superseded_reason: 'user_requested_reconsider',
      })
      .eq('id', project.current_pricing_recommendation_id as string);
    if (supersedeErr) throw new Error(`Failed to supersede prior pricing: ${supersedeErr.message}`);
  }

  // Load inputs: title candidate
  const { data: candidate, error: candidateErr } = await supabase
    .from('title_candidates')
    .select('id, candidate_text, demand_score, demand_signal_detail, competition_score, competition_signal_detail')
    .eq('id', project.selected_candidate_id)
    .single();
  if (candidateErr || !candidate) throw new Error(`Selected title candidate not found: ${candidateErr?.message}`);

  // Load inputs: confirmed format
  const { data: formatRec, error: formatErr } = await supabase
    .from('format_recommendations')
    .select('id, confirmed_format, confirmed_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (formatErr || !formatRec) throw new Error(`Format recommendation not found: ${formatErr?.message}`);
  if (!formatRec.confirmed_format) throw new Error('Format recommendation is not confirmed');

  // Load inputs: approved export page count
  const { data: approvedExport } = await supabase
    .from('export_format_states')
    .select('current_export_generation_id')
    .eq('project_id', projectId)
    .eq('approval_status', 'approved')
    .limit(1)
    .maybeSingle();

  let exportPageCount = 1; // fallback for edge case
  if (approvedExport?.current_export_generation_id) {
    const { data: generation } = await supabase
      .from('export_generations')
      .select('page_count')
      .eq('id', approvedExport.current_export_generation_id)
      .single();
    if (generation?.page_count) exportPageCount = generation.page_count;
  }

  // Extract comparable prices from competition_signal_detail (decision 1: reuse Step 2 data)
  const competitionDetail = candidate.competition_signal_detail as Record<string, unknown>;
  const comparablePrices: number[] = Array.isArray(competitionDetail?.exactAngleMatchPrices)
    ? (competitionDetail.exactAngleMatchPrices as number[]).filter((p) => typeof p === 'number' && p > 0)
    : [];

  // Run the deterministic formula (§4.2)
  const formulaResult = computeRecommendedPrice({
    comparablePrices,
    demandScore: candidate.demand_score,
    competitionScore: candidate.competition_score,
    pageCount: exportPageCount,
    deliveryMode: formatRec.confirmed_delivery_mode as DeliveryMode | null,
    format: formatRec.confirmed_format as FormatType,
  });

  assertValidPrice(formulaResult.recommendedPrice, PRICE_CEILING);

  // Run AI reasoning call (§4.3) — or fall back to template (§4.4)
  let generationStatus: 'succeeded' | 'failed_fallback' = 'succeeded';
  const reasoningInput = {
    ...formulaResult,
    demandScore: candidate.demand_score,
    competitionScore: candidate.competition_score,
    pageCount: exportPageCount,
    deliveryMode: formatRec.confirmed_delivery_mode as DeliveryMode | null,
    format: formatRec.confirmed_format as FormatType,
    title: candidate.candidate_text,
  };

  let reasoning;
  try {
    reasoning = await generatePricingReasoningCall(reasoningInput);
  } catch {
    generationStatus = 'failed_fallback';
    reasoning = fallbackPricingReasoning(reasoningInput);
  }

  const inputsSnapshot = {
    title: candidate.candidate_text,
    demand_score: candidate.demand_score,
    demand_signal_detail: candidate.demand_signal_detail,
    competition_score: candidate.competition_score,
    competition_signal_detail: candidate.competition_signal_detail,
    confirmed_format: formatRec.confirmed_format,
    confirmed_delivery_mode: formatRec.confirmed_delivery_mode,
    page_count: exportPageCount,
    comparable_prices: comparablePrices,
  };

  // Persist the recommendation
  const { data: newRow, error: insertErr } = await supabase
    .from('pricing_recommendations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: candidate.id,
      format_recommendation_id: formatRec.id,
      export_page_count_snapshot: exportPageCount,
      recommended_price: formulaResult.recommendedPrice,
      base_price: formulaResult.basePrice,
      comparable_count: formulaResult.comparableCount,
      demand_competition_multiplier: formulaResult.demandCompetitionMultiplier,
      depth_adjustment: formulaResult.depthAdjustment,
      reasoning_summary: reasoning.reasoningSummary,
      reasoning_signals: reasoning.reasoningSignals,
      inputs_snapshot: inputsSnapshot,
      model: generationStatus === 'succeeded' ? GROQ_MODEL : 'fallback-template',
      generation_status: generationStatus,
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newRow) throw new Error(`Failed to persist pricing_recommendations row: ${insertErr?.message}`);

  // Persist 4 platform suggestion child rows
  const platformRows = formulaResult.platformPrices.map((pp) => ({
    workspace_id: workspaceId,
    pricing_recommendation_id: newRow.id,
    platform: pp.platform,
    platform_multiplier: pp.multiplier,
    suggested_price: pp.suggestedPrice,
  }));

  const { data: platformData, error: platformErr } = await supabase
    .from('pricing_platform_suggestions')
    .insert(platformRows)
    .select();
  if (platformErr || !platformData) throw new Error(`Failed to persist platform suggestions: ${platformErr?.message}`);

  // Update project pointer and status
  const { error: projectUpdateErr } = await supabase
    .from('projects')
    .update({ current_pricing_recommendation_id: newRow.id, status: 'pricing_recommending' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return {
    recommendation: newRow as PricingRecommendationRow,
    platformSuggestions: platformData as PricingPlatformSuggestionRow[],
  };
}

// ── Confirm ──────────────────────────────────────────────────────────────────

interface ConfirmPricingParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  /** Base price confirmation (can differ from recommended) */
  confirmedPrice: number;
  /** Per-platform confirmed prices (platform → price) */
  platformPrices: Partial<Record<PricingPlatform, number>>;
}

export async function confirmPricing(
  params: ConfirmPricingParams,
): Promise<{ recommendation: PricingRecommendationRow; platformSuggestions: PricingPlatformSuggestionRow[] }> {
  const { supabase, projectId, userId, confirmedPrice, platformPrices } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_pricing_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_pricing_recommendation_id) throw new Error('No active pricing recommendation to confirm');

  const { data: activeRow, error: rowErr } = await supabase
    .from('pricing_recommendations')
    .select('recommended_price')
    .eq('id', project.current_pricing_recommendation_id)
    .single();
  if (rowErr || !activeRow) throw new Error(`Active pricing row not found: ${rowErr?.message}`);

  const isOverride = computeIsOverride(Number(activeRow.recommended_price), confirmedPrice);

  // Confirm the base recommendation
  const { data: updated, error: updateErr } = await supabase
    .from('pricing_recommendations')
    .update({
      confirmed_price: confirmedPrice,
      is_override: isOverride,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', project.current_pricing_recommendation_id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm pricing: ${updateErr?.message}`);

  // Confirm per-platform prices
  const { data: suggestions, error: sugErr } = await supabase
    .from('pricing_platform_suggestions')
    .select('*')
    .eq('pricing_recommendation_id', project.current_pricing_recommendation_id);
  if (sugErr) throw new Error(`Failed to load platform suggestions: ${sugErr.message}`);

  const updatedSuggestions: PricingPlatformSuggestionRow[] = [];
  for (const suggestion of (suggestions ?? []) as PricingPlatformSuggestionRow[]) {
    const confirmedPlatformPrice = platformPrices[suggestion.platform as PricingPlatform];
    if (confirmedPlatformPrice !== undefined) {
      const platformOverride = computePlatformIsOverride(Number(suggestion.suggested_price), confirmedPlatformPrice);
      const { data: updatedSug, error: updErr } = await supabase
        .from('pricing_platform_suggestions')
        .update({
          confirmed_price: confirmedPlatformPrice,
          is_override: platformOverride,
          confirmed_by: userId,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', suggestion.id)
        .select()
        .single();
      if (updErr || !updatedSug) throw new Error(`Failed to confirm platform ${suggestion.platform}: ${updErr?.message}`);
      updatedSuggestions.push(updatedSug as PricingPlatformSuggestionRow);
    } else {
      updatedSuggestions.push(suggestion);
    }
  }

  // Update project status to pricing_confirmed
  const { error: statusErr } = await supabase
    .from('projects')
    .update({ status: 'pricing_confirmed' })
    .eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return {
    recommendation: updated as PricingRecommendationRow,
    platformSuggestions: updatedSuggestions,
  };
}

// ── Change ───────────────────────────────────────────────────────────────────

interface ChangePricingParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/**
 * Supersede-and-carry-forward: preserves prior confirmation as history.
 * No new formula run unless the user explicitly calls reconsider afterward.
 */
export async function changePricing(params: ChangePricingParams): Promise<PricingRecommendationRow> {
  const { supabase, projectId, workspaceId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_pricing_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_pricing_recommendation_id) throw new Error('No active pricing to change');

  const { data: activeRow, error: rowErr } = await supabase
    .from('pricing_recommendations')
    .select('*')
    .eq('id', project.current_pricing_recommendation_id)
    .single();
  if (rowErr || !activeRow) throw new Error(`Active pricing row not found: ${rowErr?.message}`);
  if (!activeRow.confirmed_at) throw new Error('Cannot change pricing before confirming — use reconsider instead');

  // Supersede the current row
  const { error: supersedeErr } = await supabase
    .from('pricing_recommendations')
    .update({
      recommendation_status: 'superseded',
      superseded_at: new Date().toISOString(),
      superseded_reason: 'user_requested_change',
    })
    .eq('id', activeRow.id);
  if (supersedeErr) throw new Error(`Failed to supersede confirmed pricing: ${supersedeErr.message}`);

  // Copy forward the recommendation fields (no new formula run)
  const { data: newRow, error: insertErr } = await supabase
    .from('pricing_recommendations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: activeRow.title_candidate_id,
      format_recommendation_id: activeRow.format_recommendation_id,
      export_page_count_snapshot: activeRow.export_page_count_snapshot,
      recommended_price: activeRow.recommended_price,
      base_price: activeRow.base_price,
      comparable_count: activeRow.comparable_count,
      demand_competition_multiplier: activeRow.demand_competition_multiplier,
      depth_adjustment: activeRow.depth_adjustment,
      reasoning_summary: activeRow.reasoning_summary,
      reasoning_signals: activeRow.reasoning_signals,
      inputs_snapshot: activeRow.inputs_snapshot,
      model: activeRow.model,
      generation_status: activeRow.generation_status,
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newRow) throw new Error(`Failed to copy pricing forward: ${insertErr?.message}`);

  // Also copy forward platform suggestions
  const { data: oldSuggestions, error: oldSugErr } = await supabase
    .from('pricing_platform_suggestions')
    .select('*')
    .eq('pricing_recommendation_id', activeRow.id);
  if (oldSugErr) throw new Error(`Failed to load old platform suggestions: ${oldSugErr.message}`);

  if (oldSuggestions && oldSuggestions.length > 0) {
    const newSuggestions = oldSuggestions.map((s: PricingPlatformSuggestionRow) => ({
      workspace_id: workspaceId,
      pricing_recommendation_id: newRow.id,
      platform: s.platform,
      platform_multiplier: s.platform_multiplier,
      suggested_price: s.suggested_price,
    }));
    const { error: newSugErr } = await supabase
      .from('pricing_platform_suggestions')
      .insert(newSuggestions);
    if (newSugErr) throw new Error(`Failed to copy platform suggestions forward: ${newSugErr.message}`);
  }

  // Revert status to pricing_recommending
  const { error: projectUpdateErr } = await supabase
    .from('projects')
    .update({ current_pricing_recommendation_id: newRow.id, status: 'pricing_recommending' })
    .eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newRow as PricingRecommendationRow;
}

// ── Read ─────────────────────────────────────────────────────────────────────

interface GetActiveParams {
  supabase: SupabaseClient;
  projectId: string;
}

export async function getActivePricingRecommendation(
  params: GetActiveParams,
): Promise<{ recommendation: PricingRecommendationRow; platformSuggestions: PricingPlatformSuggestionRow[] } | null> {
  const { supabase, projectId } = params;
  await invalidateIfStale(supabase, projectId);

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('current_pricing_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_pricing_recommendation_id) return null;

  const { data: row, error: rowErr } = await supabase
    .from('pricing_recommendations')
    .select('*')
    .eq('id', project.current_pricing_recommendation_id)
    .single();
  if (rowErr) throw new Error(`Failed to load active pricing: ${rowErr.message}`);
  if (!row) return null;

  const { data: suggestions, error: sugErr } = await supabase
    .from('pricing_platform_suggestions')
    .select('*')
    .eq('pricing_recommendation_id', row.id);
  if (sugErr) throw new Error(`Failed to load platform suggestions: ${sugErr.message}`);

  return {
    recommendation: row as PricingRecommendationRow,
    platformSuggestions: (suggestions ?? []) as PricingPlatformSuggestionRow[],
  };
}
