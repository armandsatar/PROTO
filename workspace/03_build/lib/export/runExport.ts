import type { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'node:crypto';
import { generateExportRecommendationCall, GROQ_MODEL } from './generateExportRecommendation';
import { assertValidOutputFormat } from './guardrail';
import { generateFieldStructurePass } from './generateFieldStructure';
import { renderPdfDocument, countPdfPages } from './renderPdf';
import { renderFillablePdfDocument } from './renderFillablePdf';
import { renderDocxDocument } from './renderDocx';
import { renderNotionMarkdown } from './renderNotionMarkdown';
import { uploadExportAsset } from './storage';
import { isPageCountWithinSanityBand } from './rules';
import type { ExportOutputFormat, ExportGenerationStatus, FormatType, DeliveryMode, FieldStructureBlock } from './types';

export interface ExportFormatStateRow {
  id: string;
  workspace_id: string;
  project_id: string;
  output_format: ExportOutputFormat;
  title_candidate_id: string;
  format_recommendation_id: string;
  content_build_confirmed_at: string;
  cover_generation_id: string | null;
  current_export_generation_id: string | null;
  status: 'draft' | 'confirmed';
  approval_status: 'pending' | 'approved';
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

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

interface ExportSubtopicLite {
  id: string;
  title: string;
  body: string;
}

interface LoadedExportContext {
  titleCandidateId: string;
  productTitle: string;
  formatRecommendationId: string;
  confirmedFormat: FormatType;
  confirmedDeliveryMode: DeliveryMode | null;
  contentBuildConfirmedAt: string;
  subtopics: ExportSubtopicLite[];
  coverGenerationId: string | null;
  coverImageBuffer: Buffer;
  coverImageMimeType: 'image/jpeg' | 'image/png';
}

/** §1's full input set — title, confirmed format/delivery mode, all confirmed subtopic bodies in order, and the real embedded cover bytes (§1's genuine escalation vs. every prior consumer of Step 9's output). */
async function loadExportGenerationContext(supabase: SupabaseClient, projectId: string): Promise<LoadedExportContext> {
  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: candidate, error: candidateErr } = await supabase.from('title_candidates').select('id, candidate_text').eq('id', project.selected_candidate_id).single();
  if (candidateErr || !candidate) throw new Error(`Selected title candidate not found: ${candidateErr?.message}`);

  const { data: formatRec, error: formatErr } = await supabase
    .from('format_recommendations')
    .select('id, confirmed_format, confirmed_delivery_mode')
    .eq('id', project.current_format_recommendation_id)
    .single();
  if (formatErr || !formatRec) throw new Error(`Confirmed format recommendation not found: ${formatErr?.message}`);

  const { data: contentBuild, error: contentBuildErr } = await supabase.from('content_builds').select('id, confirmed_at, updated_at').eq('project_id', projectId).single();
  if (contentBuildErr || !contentBuild) throw new Error(`Content build not found for project: ${contentBuildErr?.message}`);

  const { data: subtopics, error: subtopicsErr } = await supabase.from('subtopics').select('id, title, display_order').eq('project_id', projectId).order('display_order');
  if (subtopicsErr) throw new Error(`Failed to load subtopics: ${subtopicsErr.message}`);

  const { data: contents, error: contentsErr } = await supabase.from('subtopic_contents').select('subtopic_id, body').eq('content_build_id', contentBuild.id);
  if (contentsErr) throw new Error(`Failed to load subtopic contents: ${contentsErr.message}`);
  const bodyBySubtopicId = new Map((contents ?? []).map((c) => [c.subtopic_id as string, c.body as string]));

  const { data: coverDesign, error: coverDesignErr } = await supabase.from('cover_designs').select('current_cover_generation_id').eq('project_id', projectId).single();
  if (coverDesignErr || !coverDesign) throw new Error(`Cover design not found for project: ${coverDesignErr?.message}`);
  if (!coverDesign.current_cover_generation_id) throw new Error('Cover design has no current generation to embed');

  const { data: coverGen, error: coverGenErr } = await supabase.from('cover_generations').select('asset_storage_path').eq('id', coverDesign.current_cover_generation_id).single();
  if (coverGenErr || !coverGen || !coverGen.asset_storage_path) throw new Error(`Cover generation asset not found: ${coverGenErr?.message}`);

  const { data: coverBlob, error: downloadErr } = await supabase.storage.from('product-covers').download(coverGen.asset_storage_path);
  if (downloadErr || !coverBlob) throw new Error(`Failed to download cover asset: ${downloadErr?.message}`);
  const coverImageBuffer = Buffer.from(await coverBlob.arrayBuffer());
  const coverImageMimeType: 'image/jpeg' | 'image/png' = coverGen.asset_storage_path.endsWith('.png') ? 'image/png' : 'image/jpeg';

  return {
    titleCandidateId: candidate.id,
    productTitle: candidate.candidate_text,
    formatRecommendationId: formatRec.id,
    confirmedFormat: formatRec.confirmed_format,
    confirmedDeliveryMode: formatRec.confirmed_delivery_mode,
    contentBuildConfirmedAt: contentBuild.confirmed_at ?? contentBuild.updated_at,
    subtopics: (subtopics ?? []).map((s) => ({ id: s.id as string, title: s.title as string, body: bodyBySubtopicId.get(s.id as string) ?? '' })),
    coverGenerationId: coverDesign.current_cover_generation_id,
    coverImageBuffer,
    coverImageMimeType,
  };
}

interface SubtopicFieldBlocks {
  subtopicId: string;
  blocks: FieldStructureBlock[];
  usedFallback: boolean;
}

/**
 * Decision 1's structure-extraction pass, with the disclosed degradation named in
 * phase9-requirements.md §2.3: if a single subtopic's classification fails after its
 * own retry, that subtopic's whole body becomes one instructional_paragraph block
 * (readable, still renders correctly) rather than failing the entire export over one
 * bad classification. Never a silent full failure — the caller tracks whether any
 * fallback occurred and reflects it in generation_status.
 */
async function getFieldBlocksForSubtopic(subtopic: ExportSubtopicLite, confirmedFormat: FormatType): Promise<SubtopicFieldBlocks> {
  try {
    const result = await generateFieldStructurePass({ subtopicTitle: subtopic.title, body: subtopic.body, confirmedFormat });
    return { subtopicId: subtopic.id, blocks: result.blocks, usedFallback: false };
  } catch {
    return { subtopicId: subtopic.id, blocks: [{ fieldType: 'instructional_paragraph', text: subtopic.body, order: 0 }], usedFallback: true };
  }
}

interface GenerateExportParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  outputFormat: ExportOutputFormat;
}

export interface ExportGenerationRow {
  id: string;
  workspace_id: string;
  project_id: string;
  output_format: ExportOutputFormat;
  generation_number: number;
  trigger_scope: 'initial' | 'regenerate';
  asset_storage_path: string | null;
  model: string | null;
  page_count: number | null;
  generation_status: ExportGenerationStatus;
  error_detail: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface GenerateExportResult {
  formatState: ExportFormatStateRow;
  generation: ExportGenerationRow;
}

/**
 * §6's "Generate Export" / "Generate additional format" — the same underlying
 * pipeline for any of the 3 output formats (decision 6: formats are generated
 * independently, not gated on export_builds.confirmed_output_format matching). No
 * acknowledgeOverwrite gate — unlike every prior phase's editable content, an export
 * is a rendered artifact with nothing to hand-edit, so there is no hand-curation to
 * protect against overwriting. Requires only that the project has reached
 * export_generating (an export_builds row exists, decision 5's no-auto-fire gate).
 */
export async function generateExport(params: GenerateExportParams): Promise<GenerateExportResult> {
  const { supabase, projectId, workspaceId, outputFormat } = params;
  assertValidOutputFormat(outputFormat);

  const { data: project, error: projectErr } = await supabase.from('projects').select('current_export_build_id').eq('id', projectId).single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);
  if (!project.current_export_build_id) {
    throw new Error('Project has no export recommendation yet — generateExportRecommendation must run first (decision 5: no auto-fire)');
  }

  const { data: existingState, error: existingErr } = await supabase.from('export_format_states').select('*').eq('project_id', projectId).eq('output_format', outputFormat).maybeSingle();
  if (existingErr) throw new Error(`Failed to check for existing export format state: ${existingErr.message}`);
  if (existingState && existingState.status === 'confirmed') {
    throw new Error(`Cannot regenerate the ${outputFormat} export directly — unlock it first`);
  }

  const ctx = await loadExportGenerationContext(supabase, projectId);
  const isFillable = ctx.confirmedDeliveryMode === 'fillable';

  const { count: priorCount, error: countErr } = await supabase
    .from('export_generations')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('output_format', outputFormat);
  if (countErr) throw new Error(`Failed to count prior generations: ${countErr.message}`);
  const generationNumber = (priorCount ?? 0) + 1;
  const triggerScope: 'initial' | 'regenerate' = generationNumber === 1 ? 'initial' : 'regenerate';

  let generationStatus: ExportGenerationStatus = 'succeeded';
  let assetBuffer: Buffer | string | null = null;
  let model: string | null = null;
  let pageCount: number | null = null;
  let errorDetail: string | null = null;
  let fieldMapsToInsert: { subtopicId: string | null; block: FieldStructureBlock }[] = [];
  let anyFallback = false;

  try {
    let fieldBlocksBySubtopic: SubtopicFieldBlocks[] = [];
    if (isFillable && (outputFormat === 'pdf' || outputFormat === 'notion_markdown')) {
      fieldBlocksBySubtopic = await Promise.all(ctx.subtopics.map((s) => getFieldBlocksForSubtopic(s, ctx.confirmedFormat)));
      anyFallback = fieldBlocksBySubtopic.some((f) => f.usedFallback);
      fieldMapsToInsert = fieldBlocksBySubtopic.flatMap((f) => f.blocks.map((block) => ({ subtopicId: f.subtopicId, block })));
    }

    if (outputFormat === 'pdf') {
      if (isFillable) {
        const fillableInput = ctx.subtopics.map((s, i) => ({ title: s.title, blocks: fieldBlocksBySubtopic[i].blocks }));
        const { buffer } = await renderFillablePdfDocument({
          productTitle: ctx.productTitle,
          coverImageBytes: ctx.coverImageBuffer,
          coverImageMimeType: ctx.coverImageMimeType,
          subtopics: fillableInput,
        });
        assetBuffer = buffer;
        model = 'pdf-lib (fillable)';
        pageCount = await countPdfPages(buffer);
      } else {
        const buffer = await renderPdfDocument({
          productTitle: ctx.productTitle,
          coverImageBase64: ctx.coverImageBuffer.toString('base64'),
          coverImageMimeType: ctx.coverImageMimeType,
          subtopics: ctx.subtopics.map((s) => ({ title: s.title, body: s.body })),
        });
        assetBuffer = buffer;
        model = '@react-pdf/renderer';
        pageCount = await countPdfPages(buffer);
      }
      const totalWordCount = ctx.subtopics.reduce((sum, s) => sum + s.body.trim().split(/\s+/).filter(Boolean).length, 0);
      if (pageCount !== null && !isPageCountWithinSanityBand(totalWordCount, pageCount)) {
        generationStatus = 'succeeded_with_warnings';
      }
    } else if (outputFormat === 'docx') {
      // §2.6's disclosed limitation: Docx has no fillable-field story at all, regardless of delivery mode.
      assetBuffer = await renderDocxDocument({
        productTitle: ctx.productTitle,
        coverImageBuffer: ctx.coverImageBuffer,
        coverImageMimeType: ctx.coverImageMimeType,
        subtopics: ctx.subtopics.map((s) => ({ title: s.title, body: s.body })),
      });
      model = 'docx';
    } else {
      const md = renderNotionMarkdown({
        productTitle: ctx.productTitle,
        subtopics: ctx.subtopics.map((s, i) => ({
          title: s.title,
          body: s.body,
          fieldBlocks: isFillable ? fieldBlocksBySubtopic[i].blocks : undefined,
        })),
      });
      assetBuffer = md;
      model = 'notion-markdown-assembler';
    }

    if (anyFallback && generationStatus === 'succeeded') generationStatus = 'succeeded_with_warnings';
  } catch (err) {
    generationStatus = 'failed_fallback';
    errorDetail = err instanceof Error ? err.message : 'Export generation failed';
  }

  // Either a real asset was produced, or this is a total render failure — either way,
  // persist an honest log row (never a fabricated file) and always upsert the format
  // state, same "always record the attempt, only advance the current pointer on
  // success" posture as generateInitialCandidate/generateContent in prior phases.
  let assetStoragePath: string | null = null;
  const generationId = crypto.randomUUID();
  if (assetBuffer !== null) {
    assetStoragePath = await uploadExportAsset({ supabase, workspaceId, projectId, exportGenerationId: generationId, outputFormat, buffer: assetBuffer });
  } else {
    model = 'fallback-no-export';
    generationStatus = 'failed_fallback';
  }

  const { data: generation, error: genErr } = await supabase
    .from('export_generations')
    .insert({
      id: generationId,
      workspace_id: workspaceId,
      project_id: projectId,
      output_format: outputFormat,
      generation_number: generationNumber,
      trigger_scope: triggerScope,
      title_candidate_id: ctx.titleCandidateId,
      format_recommendation_id: ctx.formatRecommendationId,
      content_build_confirmed_at: ctx.contentBuildConfirmedAt,
      cover_generation_id: ctx.coverGenerationId,
      asset_storage_path: assetStoragePath,
      model,
      page_count: pageCount,
      generation_status: generationStatus,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genErr || !generation) throw new Error(`Failed to persist export generation row: ${genErr?.message}`);

  if (fieldMapsToInsert.length > 0 && assetStoragePath !== null) {
    const { error: fieldMapErr } = await supabase.from('export_field_maps').insert(
      fieldMapsToInsert.map(({ subtopicId, block }) => ({
        workspace_id: workspaceId,
        project_id: projectId,
        export_generation_id: generation.id,
        subtopic_id: subtopicId,
        field_order: block.order,
        field_type: block.fieldType,
        source_text: block.text,
      })),
    );
    if (fieldMapErr) throw new Error(`Failed to persist export field map rows: ${fieldMapErr.message}`);
  }

  const statePayload = {
    workspace_id: workspaceId,
    project_id: projectId,
    output_format: outputFormat,
    title_candidate_id: ctx.titleCandidateId,
    format_recommendation_id: ctx.formatRecommendationId,
    content_build_confirmed_at: ctx.contentBuildConfirmedAt,
    cover_generation_id: ctx.coverGenerationId,
    current_export_generation_id: assetStoragePath !== null ? generation.id : (existingState?.current_export_generation_id ?? null),
    updated_at: new Date().toISOString(),
  };

  let formatState: ExportFormatStateRow;
  if (existingState) {
    const { data: updated, error: updateErr } = await supabase.from('export_format_states').update(statePayload).eq('id', existingState.id).select().single();
    if (updateErr || !updated) throw new Error(`Failed to update export format state: ${updateErr?.message}`);
    formatState = updated as ExportFormatStateRow;
  } else {
    const { data: inserted, error: insertErr } = await supabase.from('export_format_states').insert(statePayload).select().single();
    if (insertErr || !inserted) throw new Error(`Failed to insert export format state: ${insertErr?.message}`);
    formatState = inserted as ExportFormatStateRow;
  }

  const { error: projectStatusErr } = await supabase.from('projects').update({ status: 'export_generating' }).eq('id', projectId);
  if (projectStatusErr) throw new Error(`Failed to update project status: ${projectStatusErr.message}`);

  return { formatState, generation: generation as ExportGenerationRow };
}
