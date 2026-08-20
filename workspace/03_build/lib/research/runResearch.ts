import type { SupabaseClient } from '@supabase/supabase-js';
import { researchTitle } from './researchTitle';
import { generateTitleVariants } from '../ai/generateCandidates';
import { GROQ_MODEL } from '../ai/groq';

export interface RunResearchParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  originalTitle: string;
  rationale: string;
}

interface CandidateRow {
  research_run_id: string;
  workspace_id: string;
  project_id: string;
  candidate_text: string;
  is_original: boolean;
  generation_axis: 'original' | 'niche_down' | 'format_hint' | 'keyword_optimized';
  demand_score: number;
  demand_color: string;
  demand_signal_detail: Record<string, unknown>;
  competition_score: number;
  competition_color: string;
  competition_signal_detail: Record<string, unknown>;
  display_order: number;
}

/**
 * Full Step 2 orchestration (§3.2 sequencing): research the original title first, use
 * that output to generate 3 variants, research+score each variant independently, then
 * persist a research_run + exactly 4 title_candidates (decision 7). On any failure the
 * run is marked 'failed' — see the note below on why v1 has no partial-signal fallback.
 */
export async function runResearch(params: RunResearchParams) {
  const { supabase, projectId, workspaceId, originalTitle, rationale } = params;

  const { data: existingRuns, error: countErr } = await supabase
    .from('research_runs')
    .select('run_number')
    .eq('project_id', projectId)
    .order('run_number', { ascending: false })
    .limit(1);
  if (countErr) throw new Error(`Failed to determine run_number: ${countErr.message}`);
  const runNumber = (existingRuns?.[0]?.run_number ?? 0) + 1;

  const { data: run, error: runInsertErr } = await supabase
    .from('research_runs')
    .insert({
      project_id: projectId,
      workspace_id: workspaceId,
      run_number: runNumber,
      idea_title_snapshot: originalTitle,
      idea_rationale_snapshot: rationale,
      ai_connector_used: GROQ_MODEL,
      status: 'pending',
    })
    .select()
    .single();
  if (runInsertErr || !run) {
    throw new Error(`Failed to create research_run: ${runInsertErr?.message ?? 'no row returned'}`);
  }

  try {
    // Original researched first — its exact-angle-match listing titles feed candidate
    // generation below, per §3.2's sequencing note.
    const originalResearch = await researchTitle(originalTitle);

    const variants = await generateTitleVariants({
      originalTitle,
      rationale,
      exactAngleMatchListingTitles: originalResearch.exactAngleMatchListingTitles,
    });

    const variantResearch = await Promise.all(variants.map((v) => researchTitle(v.text)));

    const candidateRows: CandidateRow[] = [
      {
        research_run_id: run.id,
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_text: originalTitle,
        is_original: true,
        generation_axis: 'original',
        demand_score: originalResearch.demand.score,
        demand_color: originalResearch.demand.color,
        demand_signal_detail: originalResearch.demand.detail,
        competition_score: originalResearch.competition.score,
        competition_color: originalResearch.competition.color,
        competition_signal_detail: originalResearch.competition.detail,
        display_order: 1,
      },
      ...variants.map((v, i) => ({
        research_run_id: run.id,
        workspace_id: workspaceId,
        project_id: projectId,
        candidate_text: v.text,
        is_original: false,
        generation_axis: v.axis,
        demand_score: variantResearch[i].demand.score,
        demand_color: variantResearch[i].demand.color,
        demand_signal_detail: variantResearch[i].demand.detail,
        competition_score: variantResearch[i].competition.score,
        competition_color: variantResearch[i].competition.color,
        competition_signal_detail: variantResearch[i].competition.detail,
        display_order: i + 2,
      })),
    ];

    const { data: insertedCandidates, error: candidatesErr } = await supabase
      .from('title_candidates')
      .insert(candidateRows)
      .select();
    if (candidatesErr || !insertedCandidates) {
      throw new Error(`Failed to persist candidates: ${candidatesErr?.message ?? 'no rows returned'}`);
    }

    const { error: completeErr } = await supabase
      .from('research_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', run.id);
    if (completeErr) throw new Error(`Failed to mark run completed: ${completeErr.message}`);

    // §1.3: re-running research always clears the selection pointer — a selection from
    // a superseded run cannot silently persist as "the" selection.
    const { error: projectErr } = await supabase
      .from('projects')
      .update({ current_research_run_id: run.id, selected_candidate_id: null, status: 'researching' })
      .eq('id', projectId);
    if (projectErr) throw new Error(`Failed to update project pointer: ${projectErr.message}`);

    return { runId: run.id as string, candidates: insertedCandidates };
  } catch (err) {
    // Decision 6 calls for partial/degrade over hard-fail, but that was written when
    // Demand had 3 independent SERP signals to degrade across. In v1, Etsy is the ONLY
    // source for both scores (decision 10/12) — if it fails, there's no fallback signal
    // left to produce a lower-confidence-but-still-displayed score from. So this marks
    // 'failed', not 'partial'; true partial-signal degradation is a future revisit once
    // Trends becomes a second independent source (decision 16 tracks the AI-connector
    // side of that gap; this is the data-source side of the same open item).
    const message = err instanceof Error ? err.message : 'Unknown error during research run';
    await supabase
      .from('research_runs')
      .update({ status: 'failed', error_detail: message, completed_at: new Date().toISOString() })
      .eq('id', run.id);
    throw err;
  }
}
