import type { SupabaseClient } from '@supabase/supabase-js';
import { generateSubtopicList, type GenerateSubtopicListInput } from './generateSubtopicList';
import { regenerateSingleSubtopic } from './regenerateSingleSubtopic';
import { fullListFallback } from './fallback';
import { validateSubtopicFields } from './guardrail';
import { GROQ_MODEL } from '../ai/groq';
import { hasReachedRegenerateCap, targetCountForFormat, detectStalenessReason, type StalenessReason } from './rules';
import type { FormatType, Subtopic, SubtopicDepth, SubtopicGenerationStatus } from './types';

export interface SubtopicListRow {
  id: string;
  workspace_id: string;
  project_id: string;
  title_candidate_id: string;
  format_recommendation_id: string;
  transformation_map_snapshot_at: string;
  confirmed_format: FormatType;
  target_count_min: number;
  target_count_max: number;
  status: 'draft' | 'confirmed';
  confirmed_at: string | null;
  confirmed_by: string | null;
  regenerate_count: number;
  current_generation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtopicRow {
  id: string;
  workspace_id: string;
  project_id: string;
  subtopic_list_id: string;
  title: string;
  description: string;
  display_order: number;
  depth: 'shallow' | 'medium' | 'deep';
  source: 'ai_generated' | 'manual' | 'ai_regenerated';
  source_generation_id: string | null;
  is_edited: boolean;
  last_edited_at: string | null;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

interface LoadedGenerationContext {
  project: { selected_candidate_id: string | null; current_format_recommendation_id: string | null };
  candidate: {
    id: string;
    candidate_text: string;
    demand_score: number;
    demand_signal_detail: unknown;
    competition_score: number;
    competition_signal_detail: unknown;
  };
  rationale: string;
  formatRec: { id: string; confirmed_format: FormatType; confirmed_delivery_mode: string | null };
  map: { updated_at: string } & Omit<GenerateSubtopicListInput, 'title' | 'rationale' | 'confirmedFormat' | 'confirmedDeliveryMode' | 'demandScore' | 'demandSignalDetail' | 'competitionScore' | 'competitionSignalDetail'>;
}

/**
 * §3.1's inputs, loaded fresh from live upstream state every time — first-entry and
 * regenerate share this exact same loader, so a regenerate naturally re-snapshots
 * against whatever title/format/map are current right now, not the list's old values.
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
    .select('id, candidate_text, demand_score, demand_signal_detail, competition_score, competition_signal_detail')
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

  return {
    project,
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
  };
}

function buildGenerateInput(ctx: LoadedGenerationContext): GenerateSubtopicListInput {
  return {
    title: ctx.candidate.candidate_text,
    rationale: ctx.rationale,
    confirmedFormat: ctx.formatRec.confirmed_format,
    confirmedDeliveryMode: ctx.formatRec.confirmed_delivery_mode,
    ...ctx.map,
    demandScore: ctx.candidate.demand_score,
    demandSignalDetail: ctx.candidate.demand_signal_detail,
    competitionScore: ctx.candidate.competition_score,
    competitionSignalDetail: ctx.candidate.competition_signal_detail,
  };
}

/**
 * §1.4: generation_number increments across ALL generation attempts for a list —
 * both full_list and single_item — a single unambiguous sequence, not two separate
 * counters (see migration 0005's comments for the reasoning behind this reading).
 */
async function nextGenerationNumber(supabase: SupabaseClient, projectId: string): Promise<number> {
  const { data: lastGen } = await supabase
    .from('subtopic_generations')
    .select('generation_number')
    .eq('project_id', projectId)
    .order('generation_number', { ascending: false })
    .limit(1);
  return (lastGen?.[0]?.generation_number ?? 0) + 1;
}

/** Shared draft-status guard for every collection-management action in §1.7's table. */
async function requireDraftList(supabase: SupabaseClient, projectId: string): Promise<SubtopicListRow> {
  const { data: list, error } = await supabase.from('subtopic_lists').select('*').eq('project_id', projectId).single();
  if (error || !list) throw new Error(`No subtopic list found for project: ${error?.message}`);
  if (list.status !== 'draft') throw new Error('Subtopic list is confirmed — unlock it first');
  return list as SubtopicListRow;
}

async function loadSubtopics(supabase: SupabaseClient, subtopicListId: string): Promise<SubtopicRow[]> {
  const { data, error } = await supabase
    .from('subtopics')
    .select('*')
    .eq('subtopic_list_id', subtopicListId)
    .order('display_order', { ascending: true });
  if (error) throw new Error(`Failed to load subtopics: ${error.message}`);
  return (data ?? []) as SubtopicRow[];
}

interface GenerateOrRegenerateParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  /** Required (must be true) to regenerate over a list where any row is edited/manual/ai_regenerated — decision 12's safety rail. */
  acknowledgeOverwrite?: boolean;
}

export interface GenerateOrRegenerateResult {
  list: SubtopicListRow;
  subtopics: SubtopicRow[];
}

/**
 * Handles both first-entry auto-fire and explicit whole-list Regenerate through one
 * function (§1.7), same dual-purpose shape Step 6 used — except here "the row" is an
 * entire child collection, not a single record, so this also owns deleting/reinserting
 * the `subtopics` rows rather than just overwriting 10 columns in place.
 */
export async function generateOrRegenerateSubtopicList(params: GenerateOrRegenerateParams): Promise<GenerateOrRegenerateResult> {
  const { supabase, projectId, workspaceId, acknowledgeOverwrite } = params;

  const { data: existingList, error: existingErr } = await supabase
    .from('subtopic_lists')
    .select('id, status, regenerate_count')
    .eq('project_id', projectId)
    .maybeSingle();
  if (existingErr) throw new Error(`Failed to check for existing subtopic list: ${existingErr.message}`);

  const isRegenerate = !!existingList;
  if (isRegenerate) {
    if (existingList.status === 'confirmed') {
      throw new Error('Cannot regenerate a confirmed subtopic list directly — unlock it first');
    }
    if (hasReachedRegenerateCap(existingList.regenerate_count)) {
      throw new Error('Whole-list regenerate cap reached for this project (decision 14)');
    }

    const { data: existingRows, error: rowsErr } = await supabase
      .from('subtopics')
      .select('is_edited, source')
      .eq('subtopic_list_id', existingList.id);
    if (rowsErr) throw new Error(`Failed to check existing subtopics for hand-edits: ${rowsErr.message}`);

    const hasHandCuration = (existingRows ?? []).some((row) => row.is_edited || row.source !== 'ai_generated');
    if (hasHandCuration && acknowledgeOverwrite !== true) {
      throw new Error('This list has edited, manual, or regenerated rows — pass acknowledgeOverwrite=true to confirm overwriting them (decision 12)');
    }
  }

  const ctx = await loadGenerationContext(supabase, projectId);
  const target = targetCountForFormat(ctx.formatRec.confirmed_format);
  const generateInput = buildGenerateInput(ctx);

  let generationStatus: SubtopicGenerationStatus;
  let subtopics: Subtopic[];
  try {
    const result = await generateSubtopicList(generateInput, target);
    subtopics = result.subtopics;
    generationStatus = result.generationStatus;
  } catch {
    // Decision 10: honest empty list on total failure, never a fabricated placeholder
    // count — the fallback's [] is always a valid Subtopic[] vacuously.
    subtopics = fullListFallback().subtopics as Subtopic[];
    generationStatus = 'failed_fallback';
  }

  const listId = isRegenerate ? existingList.id : undefined;
  const generationNumber = await nextGenerationNumber(supabase, projectId);

  const inputsSnapshot = {
    title: generateInput.title,
    rationale: generateInput.rationale,
    confirmed_format: generateInput.confirmedFormat,
    confirmed_delivery_mode: generateInput.confirmedDeliveryMode,
    transformation_map: {
      headline_before: generateInput.headlineBefore,
      headline_after: generateInput.headlineAfter,
      dim_emotional_before: generateInput.dimEmotionalBefore,
      dim_emotional_after: generateInput.dimEmotionalAfter,
      dim_practical_before: generateInput.dimPracticalBefore,
      dim_practical_after: generateInput.dimPracticalAfter,
      dim_identity_before: generateInput.dimIdentityBefore,
      dim_identity_after: generateInput.dimIdentityAfter,
      dim_pain_point_before: generateInput.dimPainPointBefore,
      dim_pain_point_after: generateInput.dimPainPointAfter,
    },
    demand_score: generateInput.demandScore,
    demand_signal_detail: generateInput.demandSignalDetail,
    competition_score: generateInput.competitionScore,
    competition_signal_detail: generateInput.competitionSignalDetail,
    target_count_min: target.min,
    target_count_max: target.max,
  };

  // First-entry: subtopic_lists must exist before subtopic_generations can reference
  // it (the FK is not-null) — insert the header first with everything already known
  // deterministically, then patch current_generation_id once the generation row exists.
  let listRowId = listId;
  if (!isRegenerate) {
    const { data: inserted, error: insertListErr } = await supabase
      .from('subtopic_lists')
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title_candidate_id: ctx.candidate.id,
        format_recommendation_id: ctx.formatRec.id,
        transformation_map_snapshot_at: ctx.map.updated_at,
        confirmed_format: ctx.formatRec.confirmed_format,
        target_count_min: target.min,
        target_count_max: target.max,
      })
      .select('id')
      .single();
    if (insertListErr || !inserted) throw new Error(`Failed to create subtopic list: ${insertListErr?.message}`);
    listRowId = inserted.id;
  }
  if (!listRowId) throw new Error('Internal error: no subtopic list id available');

  const { data: newGeneration, error: genInsertErr } = await supabase
    .from('subtopic_generations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      subtopic_list_id: listRowId,
      generation_number: generationNumber,
      generation_type: 'full_list',
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      inputs_snapshot: inputsSnapshot,
      output_snapshot: subtopics,
      model: generationStatus === 'failed_fallback' ? 'fallback-empty-list' : GROQ_MODEL,
      generation_status: generationStatus,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genInsertErr || !newGeneration) throw new Error(`Failed to persist generation row: ${genInsertErr?.message}`);

  if (isRegenerate) {
    const { error: deleteErr } = await supabase.from('subtopics').delete().eq('subtopic_list_id', listRowId);
    if (deleteErr) throw new Error(`Failed to clear existing subtopics before regenerate: ${deleteErr.message}`);
  }

  let insertedSubtopics: SubtopicRow[] = [];
  if (subtopics.length > 0) {
    const { data: insertedRows, error: subtopicsInsertErr } = await supabase
      .from('subtopics')
      .insert(
        subtopics.map((s, i) => ({
          workspace_id: workspaceId,
          project_id: projectId,
          subtopic_list_id: listRowId,
          title: s.title,
          description: s.description,
          display_order: i + 1,
          depth: s.depth,
          source: 'ai_generated' as const,
          source_generation_id: newGeneration.id,
          is_edited: false,
        })),
      )
      .select();
    if (subtopicsInsertErr || !insertedRows) throw new Error(`Failed to insert subtopics: ${subtopicsInsertErr?.message}`);
    insertedSubtopics = insertedRows as SubtopicRow[];
  }

  const { data: updatedList, error: listUpdateErr } = await supabase
    .from('subtopic_lists')
    .update({
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      confirmed_format: ctx.formatRec.confirmed_format,
      target_count_min: target.min,
      target_count_max: target.max,
      current_generation_id: newGeneration.id,
      regenerate_count: isRegenerate ? existingList.regenerate_count + 1 : 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listRowId)
    .select()
    .single();
  if (listUpdateErr || !updatedList) throw new Error(`Failed to update subtopic list: ${listUpdateErr?.message}`);

  const { error: projectUpdateErr } = await supabase.from('projects').update({ status: 'subtopic_generating' }).eq('id', projectId);
  if (projectUpdateErr) throw new Error(`Failed to update project status: ${projectUpdateErr.message}`);

  return { list: updatedList as SubtopicListRow, subtopics: insertedSubtopics };
}

interface ConfirmParams {
  supabase: SupabaseClient;
  projectId: string;
  userId: string;
}

export async function confirmSubtopicList(params: ConfirmParams): Promise<SubtopicListRow> {
  const { supabase, projectId, userId } = params;

  const { data: existing, error: existingErr } = await supabase
    .from('subtopic_lists')
    .select('id, status')
    .eq('project_id', projectId)
    .single();
  if (existingErr || !existing) throw new Error(`No subtopic list found for project: ${existingErr?.message}`);
  if (existing.status !== 'draft') throw new Error('List is not in draft status — nothing to confirm');

  const { data: updated, error: updateErr } = await supabase
    .from('subtopic_lists')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: userId })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to confirm subtopic list: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'subtopics_confirmed' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as SubtopicListRow;
}

interface UnlockParams {
  supabase: SupabaseClient;
  projectId: string;
}

/** Content-preserving unlock (§1.7) — nothing in `subtopics` is cleared or re-checked. */
export async function unlockSubtopicList(params: UnlockParams): Promise<SubtopicListRow> {
  const { supabase, projectId } = params;

  const { data: existing, error: existingErr } = await supabase
    .from('subtopic_lists')
    .select('id, status')
    .eq('project_id', projectId)
    .single();
  if (existingErr || !existing) throw new Error(`No subtopic list found for project: ${existingErr?.message}`);
  if (existing.status !== 'confirmed') throw new Error('List is not confirmed — nothing to unlock');

  const { data: updated, error: updateErr } = await supabase
    .from('subtopic_lists')
    .update({ status: 'draft', confirmed_at: null, confirmed_by: null })
    .eq('id', existing.id)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to unlock subtopic list: ${updateErr?.message}`);

  const { error: statusErr } = await supabase.from('projects').update({ status: 'subtopic_generating' }).eq('id', projectId);
  if (statusErr) throw new Error(`Failed to update project status: ${statusErr.message}`);

  return updated as SubtopicListRow;
}

interface GetCurrentParams {
  supabase: SupabaseClient;
  projectId: string;
}

export interface GetCurrentSubtopicListResult {
  list: SubtopicListRow | null;
  subtopics: SubtopicRow[];
  isStale: boolean;
  staleReason: StalenessReason;
}

/**
 * §4's three-dependency soft staleness check — computed live, never persisted. If
 * stale and currently confirmed, reverts to draft (list + project status) per §4.3's
 * effect table, leaving every `subtopics` row completely untouched either way.
 */
export async function getCurrentSubtopicList(params: GetCurrentParams): Promise<GetCurrentSubtopicListResult> {
  const { supabase, projectId } = params;

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('selected_candidate_id, current_format_recommendation_id')
    .eq('id', projectId)
    .single();
  if (projectErr || !project) throw new Error(`Failed to load project: ${projectErr?.message ?? 'not found'}`);

  const { data: list, error: listErr } = await supabase.from('subtopic_lists').select('*').eq('project_id', projectId).maybeSingle();
  if (listErr) throw new Error(`Failed to load subtopic list: ${listErr.message}`);
  if (!list) return { list: null, subtopics: [], isStale: false, staleReason: null };

  const { data: map, error: mapErr } = await supabase
    .from('transformation_maps')
    .select('updated_at')
    .eq('project_id', projectId)
    .maybeSingle();
  if (mapErr) throw new Error(`Failed to load transformation map for staleness check: ${mapErr.message}`);

  const staleReason = detectStalenessReason(
    {
      titleCandidateId: list.title_candidate_id,
      formatRecommendationId: list.format_recommendation_id,
      transformationMapSnapshotAt: list.transformation_map_snapshot_at,
    },
    {
      selectedCandidateId: project.selected_candidate_id,
      currentFormatRecommendationId: project.current_format_recommendation_id,
      transformationMapUpdatedAt: map?.updated_at ?? null,
    },
  );

  let currentList = list as SubtopicListRow;
  if (staleReason !== null && currentList.status === 'confirmed') {
    const { data: reverted, error: revertErr } = await supabase
      .from('subtopic_lists')
      .update({ status: 'draft', confirmed_at: null, confirmed_by: null })
      .eq('id', currentList.id)
      .select()
      .single();
    if (revertErr || !reverted) throw new Error(`Failed to revert stale confirmed list: ${revertErr?.message}`);
    currentList = reverted as SubtopicListRow;

    const { error: statusErr } = await supabase.from('projects').update({ status: 'subtopic_generating' }).eq('id', projectId);
    if (statusErr) throw new Error(`Failed to revert project status for stale list: ${statusErr.message}`);
  }

  const { data: subtopicRows, error: subtopicsErr } = await supabase
    .from('subtopics')
    .select('*')
    .eq('subtopic_list_id', currentList.id)
    .order('display_order', { ascending: true });
  if (subtopicsErr) throw new Error(`Failed to load subtopics: ${subtopicsErr.message}`);

  return { list: currentList, subtopics: (subtopicRows ?? []) as SubtopicRow[], isStale: staleReason !== null, staleReason };
}

interface ReorderParams {
  supabase: SupabaseClient;
  projectId: string;
  /** Full new order, list-id-scoped. Every id currently in the list must appear exactly once. */
  orderedSubtopicIds: string[];
}

/**
 * §1.7's Reorder action — draft status only, no `is_edited` change (reordering is
 * not content editing). Two update passes to negative temp values then final 1..N
 * values: `subtopics` has a `unique (subtopic_list_id, display_order)` constraint
 * that isn't deferrable, so an arbitrary reorder (e.g. swapping items 1 and 2) would
 * collide mid-update in a single pass — negative temp values can never collide with
 * any remaining positive value, so the second pass is always collision-free.
 */
export async function reorderSubtopics(params: ReorderParams): Promise<SubtopicRow[]> {
  const { supabase, projectId, orderedSubtopicIds } = params;
  const list = await requireDraftList(supabase, projectId);

  for (let i = 0; i < orderedSubtopicIds.length; i++) {
    const { error } = await supabase
      .from('subtopics')
      .update({ display_order: -(i + 1) })
      .eq('id', orderedSubtopicIds[i])
      .eq('subtopic_list_id', list.id);
    if (error) throw new Error(`Failed to reorder subtopics (temp pass): ${error.message}`);
  }
  for (let i = 0; i < orderedSubtopicIds.length; i++) {
    const { error } = await supabase
      .from('subtopics')
      .update({ display_order: i + 1, updated_at: new Date().toISOString() })
      .eq('id', orderedSubtopicIds[i])
      .eq('subtopic_list_id', list.id);
    if (error) throw new Error(`Failed to reorder subtopics (final pass): ${error.message}`);
  }

  return loadSubtopics(supabase, list.id);
}

interface DeleteParams {
  supabase: SupabaseClient;
  projectId: string;
  subtopicId: string;
}

/**
 * §1.7's Delete action — draft status only. Remaining rows are re-sequenced to close
 * the gap (the spec leaves render-time resequencing as an equally valid alternative;
 * closing it here keeps `display_order` dense in the DB). Resequencing in ascending
 * display_order order is collision-safe without a temp-value pass — compaction only
 * ever moves a row to a value <= its own old value, and by the time each row is
 * reassigned, no remaining row still holds that target value.
 */
export async function deleteSubtopic(params: DeleteParams): Promise<SubtopicRow[]> {
  const { supabase, projectId, subtopicId } = params;
  const list = await requireDraftList(supabase, projectId);

  const { error: deleteErr, count } = await supabase
    .from('subtopics')
    .delete({ count: 'exact' })
    .eq('id', subtopicId)
    .eq('subtopic_list_id', list.id);
  if (deleteErr) throw new Error(`Failed to delete subtopic: ${deleteErr.message}`);
  if (!count) throw new Error('Subtopic not found in this list');

  const remaining = await loadSubtopics(supabase, list.id);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].display_order === i + 1) continue;
    const { error } = await supabase.from('subtopics').update({ display_order: i + 1 }).eq('id', remaining[i].id);
    if (error) throw new Error(`Failed to resequence subtopics after delete: ${error.message}`);
  }

  return loadSubtopics(supabase, list.id);
}

interface AddManualParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  title: string;
  description: string;
  depth: SubtopicDepth;
}

/** §1.7's Manual add action — draft status only, appended at the end, no AI call/log row involved. */
export async function addManualSubtopic(params: AddManualParams): Promise<SubtopicRow> {
  const { supabase, projectId, workspaceId, title, description, depth } = params;
  const list = await requireDraftList(supabase, projectId);
  const validated = validateSubtopicFields({ title, description, depth });

  const { data: lastRow } = await supabase
    .from('subtopics')
    .select('display_order')
    .eq('subtopic_list_id', list.id)
    .order('display_order', { ascending: false })
    .limit(1);
  const nextDisplayOrder = (lastRow?.[0]?.display_order ?? 0) + 1;

  const { data: inserted, error: insertErr } = await supabase
    .from('subtopics')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      subtopic_list_id: list.id,
      title: validated.title,
      description: validated.description,
      depth: validated.depth,
      display_order: nextDisplayOrder,
      source: 'manual',
      source_generation_id: null,
      is_edited: false,
    })
    .select()
    .single();
  if (insertErr || !inserted) throw new Error(`Failed to add manual subtopic: ${insertErr?.message}`);

  return inserted as SubtopicRow;
}

interface EditSubtopicParams {
  supabase: SupabaseClient;
  projectId: string;
  subtopicId: string;
  userId: string;
  updates: Partial<{ title: string; description: string; depth: SubtopicDepth }>;
}

/**
 * §1.7's Edit action — draft status only. Sets `is_edited=true` unless the row is
 * `manual` (§1.3: a manual row has no "original AI content" to have diverged from,
 * so it stays false permanently by definition, not tracked as an edit).
 */
export async function editSubtopic(params: EditSubtopicParams): Promise<SubtopicRow> {
  const { supabase, projectId, subtopicId, userId, updates } = params;
  const list = await requireDraftList(supabase, projectId);

  const { data: existing, error: existingErr } = await supabase
    .from('subtopics')
    .select('*')
    .eq('id', subtopicId)
    .eq('subtopic_list_id', list.id)
    .single();
  if (existingErr || !existing) throw new Error(`Subtopic not found in this list: ${existingErr?.message}`);

  const validated = validateSubtopicFields({
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    depth: updates.depth ?? existing.depth,
  });

  const { data: updated, error: updateErr } = await supabase
    .from('subtopics')
    .update({
      title: validated.title,
      description: validated.description,
      depth: validated.depth,
      is_edited: existing.source !== 'manual',
      last_edited_at: new Date().toISOString(),
      last_edited_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subtopicId)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to edit subtopic: ${updateErr?.message}`);

  return updated as SubtopicRow;
}

interface RegenerateOneParams {
  supabase: SupabaseClient;
  projectId: string;
  workspaceId: string;
  subtopicId: string;
  /** Required (must be true) when the target row is edited or manual — decision 13's safety rail, scoped to just this row. */
  acknowledgeOverwrite?: boolean;
  hint?: string;
}

/**
 * §1.7's single-item Regenerate action — draft status only, does not require
 * unlocking the whole list and does not touch `subtopic_lists.regenerate_count`
 * (that cap is whole-list only, decision 14). The acknowledgment gate here is
 * deliberately narrower than the whole-list gate: `ai_regenerated` alone does NOT
 * require acknowledgment (re-rolling AI output that was never hand-edited since
 * discards nothing a human authored), only `is_edited` or `source='manual'` does.
 */
export async function regenerateOneSubtopic(params: RegenerateOneParams): Promise<SubtopicRow> {
  const { supabase, projectId, workspaceId, subtopicId, acknowledgeOverwrite, hint } = params;
  const list = await requireDraftList(supabase, projectId);

  const { data: target, error: targetErr } = await supabase
    .from('subtopics')
    .select('*')
    .eq('id', subtopicId)
    .eq('subtopic_list_id', list.id)
    .single();
  if (targetErr || !target) throw new Error(`Subtopic not found in this list: ${targetErr?.message}`);

  if ((target.is_edited || target.source === 'manual') && acknowledgeOverwrite !== true) {
    throw new Error('This subtopic has unsaved manual edits — pass acknowledgeOverwrite=true to confirm overwriting it (decision 13)');
  }

  const siblings = await loadSubtopics(supabase, list.id);
  const siblingTitles = siblings.filter((s) => s.id !== subtopicId).map((s) => s.title);

  const ctx = await loadGenerationContext(supabase, projectId);
  const generationNumber = await nextGenerationNumber(supabase, projectId);
  const inputsSnapshot = {
    ...buildGenerateInput(ctx),
    sibling_subtopic_titles: siblingTitles,
    hint: hint ?? null,
  };

  let regenerated: Subtopic;
  try {
    regenerated = await regenerateSingleSubtopic({ ...buildGenerateInput(ctx), siblingTitles, hint });
  } catch (err) {
    // Decision 11: on total failure, leave the target row untouched — no fallback
    // scaffolding needed since there's always pre-existing content to fall back to
    // by simply not changing it. Still logged for audit (§1.1), then re-thrown so
    // the caller's toast/error surfaces exactly like every other AI-call failure.
    await supabase.from('subtopic_generations').insert({
      workspace_id: workspaceId,
      project_id: projectId,
      subtopic_list_id: list.id,
      generation_number: generationNumber,
      generation_type: 'single_item',
      target_subtopic_id: subtopicId,
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      inputs_snapshot: inputsSnapshot,
      output_snapshot: null,
      model: GROQ_MODEL,
      generation_status: 'failed_fallback',
      error_detail: err instanceof Error ? err.message : 'Single-item regeneration failed',
      completed_at: new Date().toISOString(),
    });
    throw new Error(`Failed to regenerate subtopic: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  const { data: newGeneration, error: genInsertErr } = await supabase
    .from('subtopic_generations')
    .insert({
      workspace_id: workspaceId,
      project_id: projectId,
      subtopic_list_id: list.id,
      generation_number: generationNumber,
      generation_type: 'single_item',
      target_subtopic_id: subtopicId,
      title_candidate_id: ctx.candidate.id,
      format_recommendation_id: ctx.formatRec.id,
      transformation_map_snapshot_at: ctx.map.updated_at,
      inputs_snapshot: inputsSnapshot,
      output_snapshot: regenerated,
      model: GROQ_MODEL,
      generation_status: 'succeeded',
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (genInsertErr || !newGeneration) throw new Error(`Failed to persist single-item generation row: ${genInsertErr?.message}`);

  const { data: updated, error: updateErr } = await supabase
    .from('subtopics')
    .update({
      title: regenerated.title,
      description: regenerated.description,
      depth: regenerated.depth,
      source: 'ai_regenerated',
      source_generation_id: newGeneration.id,
      is_edited: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subtopicId)
    .select()
    .single();
  if (updateErr || !updated) throw new Error(`Failed to overwrite subtopic on regenerate: ${updateErr?.message}`);

  return updated as SubtopicRow;
}
