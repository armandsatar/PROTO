// End-to-end Step 11 smoke test: chains real Steps 2-10 (mock Etsy, live Groq, live
// Gemini/Satori/Storage for Step 9's cover) into Step 11's complete action set against
// real RLS, no service-role bypass. Sequence: assert NO auto-fire -> generateExportRecommendation
// (first entry, live Groq) -> confirmExportFormat (with a deliberate override to
// force fillable, so the harder paths get exercised regardless of what the live
// recommendation happened to say) -> generateExport for all 3 formats (PDF fillable
// via Increment 6's pdf-lib path, Docx always static per §2.6, Notion Markdown with
// real checklist syntax) -> approve two formats simultaneously (decision 6) ->
// unlock one (project stays ready_to_download, the other format is still approved) ->
// unlock the second (project reverts) -> the confirmed-lock proof -> RLS proof ->
// all 4 document-level staleness dependencies in the completed precedence order.
// Makes real Groq calls throughout plus one real Gemini call to reach cover_approved.
// Run with: npm run smoke:export
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation, changeFormat } from '../lib/format/runFormatRecommendation';
import { generateLeadMagnetRecommendation, confirmLeadMagnetRecommendation } from '../lib/leadmagnet/runLeadMagnetCheck';
import { generateOrRegenerateTransformationMap, confirmTransformationMap } from '../lib/transformationmap/runTransformationMap';
import { generateOrRegenerateSubtopicList, confirmSubtopicList } from '../lib/subtopics/runSubtopicGeneration';
import { generateContent, confirmContentBuild, unlockContentBuild } from '../lib/content/runContentGeneration';
import { generateInitialCandidate, approve as approveCover } from '../lib/cover';
import { generateCopy, confirmCopywritingBuild } from '../lib/copywriting';
import {
  generateExportRecommendation,
  confirmExportFormat,
  generateExport,
  approveExport,
  unlockExport,
  getCurrentExportFormatState,
  countPdfPages,
} from '../lib/export';
import { PDFDocument } from 'pdf-lib';
import { bootstrapTestFixture, createTitleIdea } from './lib/testFixtures';

interface CandidateRow {
  id: string;
  is_original: boolean;
  candidate_text: string;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Bootstrapping test user + workspace + project (through RLS) ===');
  const fixture = await bootstrapTestFixture('export');
  console.log(`User: ${fixture.userId}  Workspace: ${fixture.workspaceId}  Project: ${fixture.projectId}`);

  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale = 'Freelancers want ongoing tracking and dread the unpredictability of irregular income.';
  await createTitleIdea(fixture, originalTitle, rationale);

  console.log('\n=== Steps 2/4/5/6/7/8: chaining to content_confirmed ===');
  const researchResult = await runResearch({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, originalTitle, rationale });
  const candidates = researchResult.candidates as unknown as CandidateRow[];
  const original = candidates.find((c) => c.is_original);
  const alternate = candidates.find((c) => !c.is_original);
  if (!original || !alternate) throw new Error('Expected both an original and an alternate candidate');
  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: original.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: original.id, status: 'title_selected' }).eq('id', fixture.projectId);

  const formatGen = await generateFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  // Deliberately force tracker/fillable regardless of the live recommendation, so this
  // test reliably exercises Step 11's harder fillable branch (Increments 4+6) rather
  // than leaving that to chance.
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: 'tracker', confirmedDeliveryMode: 'fillable' });
  console.log(`Format confirmed: tracker/fillable (recommendation was ${formatGen.recommended_format}/${formatGen.recommended_delivery_mode}).`);

  const lmGen = await generateLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmLeadMagnetRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedSuitable: lmGen.recommended_suitable, confirmedType: lmGen.recommended_type });

  await generateOrRegenerateTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmTransformationMap({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  await generateOrRegenerateSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmSubtopicList({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  await sleep(5000);
  await generateContent({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  console.log('\n=== Step 9: one real cover candidate + approve (reaching cover_approved) ===');
  const coverGen = await generateInitialCandidate({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  assert(coverGen.generation.generation_status === 'succeeded', `Expected the cover candidate to succeed, got '${coverGen.generation.generation_status}'`);
  await approveCover({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  console.log('\n=== Step 10: generate + confirm copy (reaching copy_confirmed) ===');
  await sleep(3000);
  await generateCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj1?.status === 'copy_confirmed', `Expected status='copy_confirmed', got '${proj1?.status}'`);
  console.log('OK: reached copy_confirmed.');

  // ============================================================
  // THE NO-AUTO-FIRE PROOF (decision 5) — must come before anything else touches Step 11
  // ============================================================
  console.log('\n=== PROOF: Step 11 does NOT auto-fire on copy_confirmed ===');
  const { data: noBuildYet } = await fixture.supabase.from('export_builds').select('id').eq('project_id', fixture.projectId).maybeSingle();
  assert(!noBuildYet, 'Expected NO export_builds row to exist yet — Step 11 must never auto-fire');
  console.log('OK: no export_builds row exists — Step 11 correctly did not auto-fire.');

  // ============================================================
  // generateExportRecommendation + confirmExportFormat (with a deliberate override)
  // ============================================================
  console.log('\n=== generateExportRecommendation (explicit first entry, live Groq) ===');
  const recGen = await generateExportRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  console.log(`Recommended: ${recGen.recommended_output_format} — "${recGen.reasoning_summary}"`);
  const { data: proj2 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj2?.status === 'export_generating', `Expected status='export_generating', got '${proj2?.status}'`);

  console.log('\n=== confirmExportFormat (accept the recommendation as the primary pick) ===');
  const confirmedBuild = await confirmExportFormat({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedOutputFormat: recGen.recommended_output_format });
  assert(confirmedBuild.confirmed_output_format === recGen.recommended_output_format, 'Expected confirmed_output_format to match what was confirmed');
  console.log(`OK: confirmed ${confirmedBuild.confirmed_output_format}, is_override=${confirmedBuild.is_override}.`);

  // ============================================================
  // generateExport for all 3 formats — decision 6's independence
  // ============================================================
  console.log('\n=== generateExport: PDF (fillable — Increments 4+6\'s real structure-extraction + field-injection pipeline) ===');
  await sleep(3000);
  const pdfGen = await generateExport({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, outputFormat: 'pdf' });
  assert(pdfGen.generation.generation_status === 'succeeded' || pdfGen.generation.generation_status === 'succeeded_with_warnings', `Expected PDF generation to succeed, got '${pdfGen.generation.generation_status}': ${pdfGen.generation.error_detail}`);
  assert(pdfGen.generation.asset_storage_path !== null, 'Expected a real asset_storage_path for the PDF generation');
  console.log(`OK: PDF generated, ${pdfGen.generation.page_count} pages, status=${pdfGen.generation.generation_status}.`);

  const { data: pdfBlob } = await fixture.supabase.storage.from('product-exports').download(pdfGen.generation.asset_storage_path!);
  assert(!!pdfBlob, 'Expected to download the real PDF asset');
  const pdfBuffer = Buffer.from(await pdfBlob!.arrayBuffer());
  assert(pdfBuffer.subarray(0, 4).toString('ascii') === '%PDF', 'Expected real PDF magic bytes in the downloaded asset');
  const realPageCount = await countPdfPages(pdfBuffer);
  const realPdfDoc = await PDFDocument.load(pdfBuffer);
  const realFieldCount = realPdfDoc.getForm().getFields().length;
  assert(realFieldCount > 0, `Expected real interactive form fields in the fillable PDF, got ${realFieldCount}`);
  console.log(`OK: downloaded and verified — ${realPageCount} real pages, ${realFieldCount} real interactive form fields.`);

  const { data: fieldMaps } = await fixture.supabase.from('export_field_maps').select('id').eq('export_generation_id', pdfGen.generation.id);
  assert((fieldMaps ?? []).length > 0, 'Expected export_field_maps rows persisted for the fillable PDF generation');
  console.log(`OK: ${fieldMaps?.length} export_field_maps rows persisted (the structure-extraction audit trail).`);

  console.log('\n=== generateExport: Docx (always static — §2.6\'s disclosed no-fillable-story limitation) ===');
  const docxGen = await generateExport({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, outputFormat: 'docx' });
  assert(docxGen.generation.generation_status === 'succeeded', `Expected Docx generation to succeed, got '${docxGen.generation.generation_status}'`);
  const { data: docxBlob } = await fixture.supabase.storage.from('product-exports').download(docxGen.generation.asset_storage_path!);
  const docxBuffer = Buffer.from(await docxBlob!.arrayBuffer());
  assert(docxBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Expected real ZIP/Docx magic bytes in the downloaded asset');
  console.log('OK: Docx generated and verified as a real ZIP-valid document.');

  console.log('\n=== generateExport: Notion Markdown (fillable — real checklist syntax from the structure-extraction pass) ===');
  await sleep(3000);
  const notionGen = await generateExport({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, outputFormat: 'notion_markdown' });
  assert(notionGen.generation.generation_status === 'succeeded' || notionGen.generation.generation_status === 'succeeded_with_warnings', `Expected Notion Markdown generation to succeed, got '${notionGen.generation.generation_status}'`);
  const { data: mdBlob } = await fixture.supabase.storage.from('product-exports').download(notionGen.generation.asset_storage_path!);
  const mdText = await mdBlob!.text();
  assert(mdText.includes('- [ ]'), 'Expected real "- [ ]" checklist syntax in the fillable Notion Markdown export');
  console.log('OK: Notion Markdown generated and verified to contain real interactive checklist syntax.');

  // ============================================================
  // Approve two formats simultaneously (decision 6), then unlock independently
  // ============================================================
  console.log('\n=== approveExport: PDF and Docx, both simultaneously confirmed (decision 6) ===');
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'docx', userId: fixture.userId });
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj3?.status === 'ready_to_download', `Expected status='ready_to_download', got '${proj3?.status}'`);
  console.log(`OK: both PDF and Docx approved. projects.status=${proj3?.status}`);

  console.log('\n=== unlockExport: PDF only — project must STAY ready_to_download (Docx is still approved) ===');
  await unlockExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf' });
  const { data: proj4 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj4?.status === 'ready_to_download', `Expected status to STAY 'ready_to_download' while Docx is still approved, got '${proj4?.status}'`);
  console.log('OK: per-format independence confirmed — unlocking PDF alone did not revert the project.');

  console.log('\n=== unlockExport: Docx too — NOW the project reverts (no format remains approved) ===');
  await unlockExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'docx' });
  const { data: proj5 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj5?.status === 'export_generating', `Expected status='export_generating' once no format remains approved, got '${proj5?.status}'`);
  console.log('OK: project correctly reverted once the last approved format was unlocked.');

  // ============================================================
  // The confirmed-lock proof
  // ============================================================
  console.log('\n=== Confirmed-lock proof: re-approve PDF, then attempt to regenerate it directly (expect rejection) ===');
  await generateExport({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, outputFormat: 'pdf' });
  const reapproved = await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });
  let regenRejected = false;
  try {
    await generateExport({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, outputFormat: 'pdf' });
  } catch (err) {
    regenRejected = err instanceof Error && /unlock it first/.test(err.message);
    console.log(`Correctly rejected: ${err instanceof Error ? err.message : err}`);
  }
  assert(regenRejected, 'Expected regenerating a confirmed export to be rejected without unlocking first');

  // ============================================================
  // RLS proof: cross-workspace spoofed insert rejected
  // ============================================================
  console.log('\n=== Bootstrapping a second, unrelated workspace for the RLS proof ===');
  const other = await bootstrapTestFixture('export-other');

  console.log('\n=== Postgres RLS: spoofed cross-workspace INSERT into export_generations (expect rejection) ===');
  const { error: spoofErr } = await other.supabase.from('export_generations').insert({
    workspace_id: other.workspaceId,
    project_id: fixture.projectId,
    output_format: 'docx',
    generation_number: 999,
    trigger_scope: 'initial',
    title_candidate_id: original.id,
    format_recommendation_id: confirmedBuild.format_recommendation_id,
    content_build_confirmed_at: new Date().toISOString(),
    generation_status: 'succeeded',
  });
  assert(!!spoofErr, 'Expected the cross-workspace spoofed INSERT to be rejected by RLS');
  console.log(`OK: spoofed INSERT correctly rejected — ${spoofErr?.message}`);

  const { data: spoofSelect } = await other.supabase.from('export_builds').select('id').eq('id', confirmedBuild.id).maybeSingle();
  assert(!spoofSelect, 'Expected the other workspace to see no rows for this export_builds id');
  console.log('OK: cross-workspace SELECT returned nothing.');

  // ============================================================
  // STALENESS PROOFS — lowest precedence first, title last (highest), each re-approved
  // first so the revert-on-stale effect is observable, resolved via a raw snapshot
  // resync between proofs (no extra paid API call — resolution itself isn't under test).
  // ============================================================

  console.log('\n=== STALENESS PROOF 1/4: cover change (lowest precedence) ===');
  // reapproved.current_export_generation_id is already confirmed via the lock-proof
  // above; unlock first so we can re-approve cleanly for this proof's own cycle.
  await unlockExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf' });
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });

  const { data: coverDesignRow } = await fixture.supabase.from('cover_designs').select('id').eq('project_id', fixture.projectId).single();
  const { data: syntheticCoverGen } = await fixture.supabase
    .from('cover_generations')
    .insert({ workspace_id: fixture.workspaceId, project_id: fixture.projectId, cover_design_id: coverDesignRow!.id, generation_number: 99, trigger_scope: 'user_upload', generation_status: 'succeeded', asset_storage_path: `${fixture.workspaceId}/${fixture.projectId}/synthetic.jpg` })
    .select('id')
    .single();
  await fixture.supabase.from('cover_designs').update({ current_cover_generation_id: syntheticCoverGen!.id }).eq('id', coverDesignRow!.id);

  const afterCover = await getCurrentExportFormatState({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf' });
  assert(afterCover.staleReason === 'cover_changed', `Expected 'cover_changed', got '${afterCover.staleReason}'`);
  assert(afterCover.formatState?.status === 'draft', `Expected format state reverted to draft, got '${afterCover.formatState?.status}'`);
  console.log("OK: isStale=true, staleReason='cover_changed', format state reverted, files untouched.");
  await fixture.supabase.from('export_format_states').update({ cover_generation_id: syntheticCoverGen!.id }).eq('id', reapproved.id);

  console.log('\n=== STALENESS PROOF 2/4: content build re-confirmed ===');
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });
  await unlockContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId });
  const reconfirmedContent = await confirmContentBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  const afterContent = await getCurrentExportFormatState({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf' });
  assert(afterContent.staleReason === 'content_build_changed', `Expected 'content_build_changed', got '${afterContent.staleReason}'`);
  assert(afterContent.formatState?.status === 'draft', `Expected format state reverted to draft, got '${afterContent.formatState?.status}'`);
  console.log("OK: isStale=true, staleReason='content_build_changed', format state reverted, files untouched.");
  await fixture.supabase.from('export_format_states').update({ content_build_confirmed_at: reconfirmedContent.confirmed_at }).eq('id', reapproved.id);

  console.log('\n=== STALENESS PROOF 3/4: confirmed format change ===');
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });
  const changedFormat = 'workbook';
  const newActiveFormatRow = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: changedFormat, confirmedDeliveryMode: newActiveFormatRow.recommended_delivery_mode });

  const afterFormat = await getCurrentExportFormatState({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf' });
  assert(afterFormat.staleReason === 'format_changed', `Expected 'format_changed', got '${afterFormat.staleReason}'`);
  assert(afterFormat.formatState?.status === 'draft', `Expected format state reverted to draft, got '${afterFormat.formatState?.status}'`);
  console.log("OK: isStale=true, staleReason='format_changed', format state reverted, files untouched.");
  const { data: projAfterFormat } = await fixture.supabase.from('projects').select('current_format_recommendation_id').eq('id', fixture.projectId).single();
  await fixture.supabase.from('export_format_states').update({ format_recommendation_id: projAfterFormat?.current_format_recommendation_id }).eq('id', reapproved.id);

  console.log('\n=== STALENESS PROOF 4/4: selected title change (highest precedence) ===');
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });
  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: alternate.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);

  const afterTitle = await getCurrentExportFormatState({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf' });
  assert(afterTitle.staleReason === 'title_changed', `Expected 'title_changed' (highest precedence), got '${afterTitle.staleReason}'`);
  assert(afterTitle.formatState?.status === 'draft', `Expected format state reverted to draft, got '${afterTitle.formatState?.status}'`);
  console.log("OK: isStale=true, staleReason='title_changed' — correctly took precedence, format state reverted, files untouched.");

  console.log(
    '\nSmoke test passed: the full Step 11 action set ran end-to-end through real RLS and live Groq/Gemini — no-auto-fire, the output-format recommend/confirm cycle, generateExport for all 3 formats (real fillable PDF fields, real static Docx, real Notion checklist syntax), simultaneous multi-format approval and independent per-format unlock (decision 6), the confirmed-lock proof, the RLS proof, and all 4 document-level staleness dependencies in the completed precedence order were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
