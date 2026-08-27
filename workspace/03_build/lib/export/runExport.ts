import type { SupabaseClient } from '@supabase/supabase-js';
import { generateExportRecommendationCall, GROQ_MODEL } from './generateExportRecommendation';
import { assertValidOutputFormat } from './guardrail';
import type { ExportOutputFormat, FormatType, DeliveryMode } from './types';

export interface ExportBuildRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  recommended_output_format: ExportOutputFormat;
  reasoning_summary: string;
  inputs_snapshot: unknown;
  model: string;
  generation_status: 'succeeded' | 'failed_fallback' | 'failed_blocked';
  confirmed_output_format: ExportOutputFormat | null;
  is_override: boolean | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  recommendation_status: 'active' | 'superseded';
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
}

interface GenerateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/**
 * §6's "Get output-format recommendation" action — decision 5: explicit trigger only,
 * no auto-fire. Requires project.status='copy_confirmed' for first entry (the
 * pipeline-sequence gate, §1.1 — not a data dependency on Step 10's own output).
 * No reconsider cap and no lazy title-staleness invalidation the way Step 4 has —
 * unlike Step 4, this recommendation depends only on confirmed_format/
 * confirmed_delivery_mode/word count, none of which a title change affects.
 */
export async function generateExportRecommendation(params: GenerateParams): Promise<ExportBuildRow> {
  const { supabase, projectId, workspaceId } = params;

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('status, selected_candidate_id, current_format_recommendation_id, current_export_build_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const isReconsider = !!project.current_export_build_id;
  if (!isReconsider && project.status !== 'copy_confirmed') {
    throw new Error('Project has not reached copy_confirmed — cannot generate an export recommendation yet (decision 5: no auto-fire, this must be called explicitly)');
  }
  if (!project.selected_candidate_id) throw new Error('Project has no selected title candidate');
  if (!project.current_format_recommendation_id) throw new Error('Project has no confirmed format recommendation');

  if (isReconsider) {
    const { data: activeBuild, error: activeBuildErr } = await supabase.from('export_builds').select('id, confirmed_at').eq('id', project.current_export_build_id).single();
    if (activeBuildErr || !activeBuild) throw new Error(`Active export build not found: ${activeBuildErr?.message}`);
    if (activeBuild.confirmed_at) throw new Error('Cannot reconsider a confirmed output format directly — use changeExportFormat first');

    const { error: supersedeErr } = await supabase.from('export_builds').update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString() }).eq('id', activeBuild.id);
    if (supersedeErr) throw new Error(`Failed to supersede prior export build: ${supersedeErr.message}`);
  }

  const { data: formatRec, error: formatErr } = await supabase
    .from('format_recommendations')
    .select('confirmed_format, confirmed_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (formatErr || !formatRec) throw new Error(`Confirmed format recommendation not found: ${formatErr?.message}`);
  const confirmedFormat = formatRec.confirmed_format as FormatType;
  const confirmedDeliveryMode = formatRec.confirmed_delivery_mode as DeliveryMode | null;

  const { data: contentBuild, error: contentBuildErr } = await supabase.from('content_builds').select('id').eq('project_id', projectId).single();
  if (contentBuildErr || !contentBuild) throw new Error(`Content build not found for project: ${contentBuildErr?.message}`);

  const { data: contents, error: contentsErr } = await supabase.from('subtopic_contents').select('word_count').eq('content_build_id', contentBuild.id);
  if (contentsErr) throw new Error(`Failed to load subtopic contents for word count: ${contentsErr.message}`);
  const totalWordCount = (contents ?? []).reduce((sum, c) => sum + (c.word_count as number), 0);

  const { result, usedFallback } = await generateExportRecommendationCall({ confirmedFormat, confirmedDeliveryMode, totalWordCount });

  const { data: newBuild, error: insertErr } = await supabase
    .from('export_builds')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: project.selected_candidate_id,
      format_recommendation_id: project.current_format_recommendation_id,
      recommended_output_format: result.outputFormat,
      reasoning_summary: result.reasoning,
      inputs_snapshot: { confirmed_format: confirmedFormat, confirmed_delivery_mode: confirmedDeliveryMode, total_word_count: totalWordCount },
      model: usedFallback ? 'fallback-heuristic' : GROQ_MODEL,
      generation_status: usedFallback ? 'failed_fallback' : 'succeeded',
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newBuild) throw new Error(`Failed to persist export_builds row: ${insertErr?.message}`);

  const { error: projectUpdateErr } = await supabase.from('projects').update({ current_export_build_id: newBuild.id, status: 'export_generating' }).eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newBuild as ExportBuildRow;
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
  confirmedOutputFormat: ExportOutputFormat;
}

/** §6's "Confirm output format" — exact mechanics of Step 4's confirm-in-place action. */
export async function confirmExportFormat(params: ConfirmParams): Promise<ExportBuildRow> {
  const { supabase, projectId, userId, confirmedOutputFormat } = params;
  assertValidOutputFormat(confirmedOutputFormat);

  const { data: project, error: projectErr } = await supabase.from('projects').select('current_export_build_id').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_export_build_id) throw new Error('No active export recommendation to confirm — generate one first');

  const { data: activeBuild, error: activeBuildErr } = await supabase.from('export_builds').select('recommended_output_format').eq('id', project.current_export_build_id).single();
  if (activeBuildErr || !activeBuild) throw new Error(`Active export build not found: ${activeBuildErr?.message}`);

  const isOverride = activeBuild.recommended_output_format !== confirmedOutputFormat;

  const { data: updated, error: updateErr } = await supabase
    .from('export_builds')
    .update({ confirmed_output_format: confirmedOutputFormat, is_override: isOverride, confirmed_by: userId, confirmed_at: new Date().toISOString() })
    .eq('id', project.current_export_build_id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm export build: ${updateErr?.message}`);

  return updated as ExportBuildRow;
}

interface ChangeFormatParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
}

/** §6's "Change output format" — supersede-and-copy-forward, exact mechanics of Step 4's changeFormat. */
export async function changeExportFormat(params: ChangeFormatParams): Promise<ExportBuildRow> {
  const { supabase, projectId, workspaceId } = params;

  const { data: project, error: projectErr } = await supabase.from('projects').select('current_export_build_id').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_export_build_id) throw new Error('No active export build to change');

  const { data: activeBuild, error: activeBuildErr } = await supabase.from('export_builds').select('*').eq('id', project.current_export_build_id).single();
  if (activeBuildErr || !activeBuild) throw new Error(`Active export build not found: ${activeBuildErr?.message}`);
  if (!activeBuild.confirmed_at) throw new Error('Cannot change output format before confirming one — regenerate the recommendation instead');

  const { error: supersedeErr } = await supabase.from('export_builds').update({ recommendation_status: 'superseded', superseded_at: new Date().toISOString() }).eq('id', activeBuild.id);
  if (supersedeErr) throw new Error(`Failed to supersede confirmed export build: ${supersedeErr.message}`);

  const { data: newBuild, error: insertErr } = await supabase
    .from('export_builds')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title_candidate_id: activeBuild.title_candidate_id,
      format_recommendation_id: activeBuild.format_recommendation_id,
      recommended_output_format: activeBuild.recommended_output_format,
      reasoning_summary: activeBuild.reasoning_summary,
      inputs_snapshot: activeBuild.inputs_snapshot,
      model: activeBuild.model,
      generation_status: activeBuild.generation_status,
      recommendation_status: 'active',
    })
    .select()
    .single();
  if (insertErr || !newBuild) throw new Error(`Failed to copy export build forward: ${insertErr?.message}`);

  const { error: projectUpdateErr } = await supabase.from('projects').update({ current_export_build_id: newBuild.id }).eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project pointer: ${projectUpdateErr.message}`);

  return newBuild as ExportBuildRow;
}
