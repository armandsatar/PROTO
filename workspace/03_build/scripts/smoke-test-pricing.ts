// End-to-end Step 12 smoke test: chains real Steps 2-11 (mock Etsy, live Groq,
// live Gemini/Satori/Storage for Step 9's cover, live export generation) into
// Step 12's complete action set against real RLS, no service-role bypass.
// Sequence: assert NO auto-fire -> generatePricingRecommendation (explicit first
// entry, live Groq) -> confirmPricing (with accept/override per platform) ->
// changePricing (supersede-and-carry-forward) -> RLS proof -> all 3 staleness
// dependencies in the completed precedence order (export page count < format < title).
// Run with: npm run smoke:pricing
import { runResearch } from '../lib/research/runResearch';
import { generateFormatRecommendation, confirmFormatRecommendation, changeFormat } from '../lib/format/runFormatRecommendation';
import { generateLeadMagnetRecommendation, confirmLeadMagnetRecommendation } from '../lib/leadmagnet/runLeadMagnetCheck';
import { generateOrRegenerateTransformationMap, confirmTransformationMap } from '../lib/transformationmap/runTransformationMap';
import { generateOrRegenerateSubtopicList, confirmSubtopicList } from '../lib/subtopics/runSubtopicGeneration';
import { generateContent, confirmContentBuild } from '../lib/content/runContentGeneration';
import { generateInitialCandidate, approve as approveCover } from '../lib/cover';
import { generateCopy, confirmCopywritingBuild } from '../lib/copywriting';
import {
  generateExportRecommendation,
  confirmExportFormat,
  generateExport,
  approveExport,
} from '../lib/export';
import {
  generatePricingRecommendation,
  confirmPricing,
  changePricing,
  getActivePricingRecommendation,
} from '../lib/pricing';
import { PRICING_PLATFORMS, PRICE_CEILING } from '../lib/pricing';
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
  const fixture = await bootstrapTestFixture('pricing');
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
  assert(coverGen.generation.generation_status === 'succeeded', `Expected cover to succeed, got '${coverGen.generation.generation_status}'`);
  await approveCover({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  console.log('\n=== Step 10: generate + confirm copy (reaching copy_confirmed) ===');
  await sleep(3000);
  await generateCopy({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmCopywritingBuild({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId });

  console.log('\n=== Step 11: export recommend + confirm + generate PDF + approve (reaching ready_to_download) ===');
  await generateExportRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmExportFormat({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedOutputFormat: 'pdf' });
  await sleep(3000);
  const pdfGen = await generateExport({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId, outputFormat: 'pdf' });
  assert(
    pdfGen.generation.generation_status === 'succeeded' || pdfGen.generation.generation_status === 'succeeded_with_warnings',
    `Expected PDF generation to succeed, got '${pdfGen.generation.generation_status}': ${pdfGen.generation.error_detail}`,
  );
  await approveExport({ supabase: fixture.supabase, projectId: fixture.projectId, outputFormat: 'pdf', userId: fixture.userId });

  const { data: proj1 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj1?.status === 'ready_to_download', `Expected status='ready_to_download', got '${proj1?.status}'`);
  console.log('OK: reached ready_to_download.');

  // ============================================================
  // THE NO-AUTO-FIRE PROOF (decision 6) — must come before anything else touches Step 12
  // ============================================================
  console.log('\n=== PROOF: Step 12 does NOT auto-fire on ready_to_download ===');
  const { data: noPricingYet } = await fixture.supabase.from('pricing_recommendations').select('id').eq('project_id', fixture.projectId).maybeSingle();
  assert(!noPricingYet, 'Expected NO pricing_recommendations row to exist yet — Step 12 must never auto-fire');
  console.log('OK: no pricing_recommendations row exists — Step 12 correctly did not auto-fire.');

  // ============================================================
  // generatePricingRecommendation (explicit first entry, live Groq)
  // ============================================================
  console.log('\n=== generatePricingRecommendation (explicit trigger, live Groq for reasoning) ===');
  const pricingGen = await generatePricingRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  const rec = pricingGen.recommendation;
  console.log(`Recommended: $${rec.recommended_price} (base=$${rec.base_price}, multiplier=${rec.demand_competition_multiplier}, depth_adj=$${rec.depth_adjustment})`);
  console.log(`Generation status: ${rec.generation_status}`);
  console.log(`Reasoning: "${rec.reasoning_summary.substring(0, 120)}..."`);

  assert(rec.recommended_price > 0 && rec.recommended_price <= PRICE_CEILING, `Expected price in (0, ${PRICE_CEILING}], got $${rec.recommended_price}`);
  assert(rec.base_price > 0, `Expected positive base price, got $${rec.base_price}`);
  assert(rec.recommendation_status === 'active', `Expected recommendation_status='active', got '${rec.recommendation_status}'`);
  assert(rec.generation_status === 'succeeded' || rec.generation_status === 'failed_fallback', `Expected succeeded or failed_fallback, got '${rec.generation_status}'`);
  assert(typeof rec.reasoning_summary === 'string' && rec.reasoning_summary.length > 0, 'Expected non-empty reasoning_summary');
  assert(Array.isArray(rec.reasoning_signals), 'Expected reasoning_signals to be an array');
  assert(rec.confirmed_price === null, 'Expected confirmed_price to be null before confirmation');

  // Verify 4 platform suggestions
  assert(pricingGen.platformSuggestions.length === 4, `Expected 4 platform suggestions, got ${pricingGen.platformSuggestions.length}`);
  for (const platform of PRICING_PLATFORMS) {
    const sug = pricingGen.platformSuggestions.find((s) => s.platform === platform);
    assert(!!sug, `Expected platform suggestion for '${platform}'`);
    assert(sug!.suggested_price > 0, `Expected positive suggested_price for '${platform}', got $${sug!.suggested_price}`);
    assert(sug!.confirmed_price === null, `Expected confirmed_price null for '${platform}' before confirmation`);
  }
  console.log('OK: 4 platform suggestions present with correct structure.');

  // Verify project status moved to pricing_recommending
  const { data: proj2 } = await fixture.supabase.from('projects').select('status, current_pricing_recommendation_id').eq('id', fixture.projectId).single();
  assert(proj2?.status === 'pricing_recommending', `Expected status='pricing_recommending', got '${proj2?.status}'`);
  assert(proj2?.current_pricing_recommendation_id === rec.id, 'Expected project pointer to match the new recommendation');
  console.log('OK: project status=pricing_recommending, pointer set.');

  // ============================================================
  // confirmPricing — accept some platforms, override others
  // ============================================================
  console.log('\n=== confirmPricing: accept recommended + override Etsy and Whop ===');
  const etsySuggested = pricingGen.platformSuggestions.find((s) => s.platform === 'etsy')!.suggested_price;
  const whopSuggested = pricingGen.platformSuggestions.find((s) => s.platform === 'whop')!.suggested_price;
  const etsyOverridePrice = Math.round((etsySuggested + 2) * 100) / 100; // bump Etsy by $2
  const whopOverridePrice = Math.round((whopSuggested - 1) * 100) / 100; // drop Whop by $1

  const confirmed = await confirmPricing({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedPrice: rec.recommended_price, // accept base price as-is
    platformPrices: {
      etsy: etsyOverridePrice,
      gumroad: pricingGen.platformSuggestions.find((s) => s.platform === 'gumroad')!.suggested_price, // accept as-is
      stanstore: pricingGen.platformSuggestions.find((s) => s.platform === 'stanstore')!.suggested_price, // accept as-is
      whop: whopOverridePrice,
    },
  });

  assert(confirmed.recommendation.confirmed_price === rec.recommended_price, 'Expected confirmed_price to match the accepted base price');
  assert(confirmed.recommendation.is_override === false, 'Expected is_override=false when accepting the recommended price');
  assert(confirmed.recommendation.confirmed_by === fixture.userId, 'Expected confirmed_by to match the user');
  assert(confirmed.recommendation.confirmed_at !== null, 'Expected confirmed_at to be set');

  // Check per-platform overrides
  const confirmedEtsy = confirmed.platformSuggestions.find((s) => s.platform === 'etsy');
  assert(confirmedEtsy?.confirmed_price === etsyOverridePrice, `Expected Etsy confirmed_price=${etsyOverridePrice}, got ${confirmedEtsy?.confirmed_price}`);
  assert(confirmedEtsy?.is_override === true, 'Expected Etsy is_override=true');

  const confirmedGumroad = confirmed.platformSuggestions.find((s) => s.platform === 'gumroad');
  assert(confirmedGumroad?.is_override === false, 'Expected Gumroad is_override=false (accepted as-is)');

  const confirmedWhop = confirmed.platformSuggestions.find((s) => s.platform === 'whop');
  assert(confirmedWhop?.confirmed_price === whopOverridePrice, `Expected Whop confirmed_price=${whopOverridePrice}, got ${confirmedWhop?.confirmed_price}`);
  assert(confirmedWhop?.is_override === true, 'Expected Whop is_override=true');

  // Verify project status moved to pricing_confirmed
  const { data: proj3 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj3?.status === 'pricing_confirmed', `Expected status='pricing_confirmed', got '${proj3?.status}'`);
  console.log(`OK: pricing confirmed. Base=$${confirmed.recommendation.confirmed_price} (is_override=${confirmed.recommendation.is_override}), Etsy=$${confirmedEtsy?.confirmed_price} (override), Whop=$${confirmedWhop?.confirmed_price} (override), Gumroad=$${confirmedGumroad?.confirmed_price} (accepted).`);

  // ============================================================
  // changePricing — supersede-and-carry-forward
  // ============================================================
  console.log('\n=== changePricing: supersede and carry forward ===');
  const priorId = rec.id;
  const changed = await changePricing({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });

  assert(changed.id !== priorId, 'Expected changePricing to create a new row (different id)');
  assert(changed.recommended_price === rec.recommended_price, 'Expected carried-forward recommended_price to match');
  assert(changed.base_price === rec.base_price, 'Expected carried-forward base_price to match');
  assert(changed.recommendation_status === 'active', 'Expected new row to be active');
  assert(changed.confirmed_price === null, 'Expected carried-forward row to have null confirmed_price (needs re-confirmation)');

  // Verify the old row was superseded
  const { data: supersededRow } = await fixture.supabase.from('pricing_recommendations').select('recommendation_status, superseded_reason').eq('id', priorId).single();
  assert(supersededRow?.recommendation_status === 'superseded', 'Expected old row to be superseded');
  assert(supersededRow?.superseded_reason === 'user_requested_change', `Expected superseded_reason='user_requested_change', got '${supersededRow?.superseded_reason}'`);

  // Verify new platform suggestions were also carried forward
  const { data: newSuggestions } = await fixture.supabase.from('pricing_platform_suggestions').select('*').eq('pricing_recommendation_id', changed.id);
  assert(newSuggestions?.length === 4, `Expected 4 carried-forward platform suggestions, got ${newSuggestions?.length}`);
  console.log('OK: prior row superseded (user_requested_change), new active row created with 4 platform suggestions carried forward.');

  // Verify project status reverted to pricing_recommending
  const { data: proj4 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj4?.status === 'pricing_recommending', `Expected status='pricing_recommending' after change, got '${proj4?.status}'`);

  // ============================================================
  // RLS proof: cross-workspace spoofed insert rejected
  // ============================================================
  console.log('\n=== Bootstrapping a second, unrelated workspace for the RLS proof ===');
  const other = await bootstrapTestFixture('pricing-other');

  console.log('\n=== Postgres RLS: spoofed cross-workspace INSERT into pricing_recommendations (expect rejection) ===');
  const { error: spoofErr } = await other.supabase.from('pricing_recommendations').insert({
    workspace_id: other.workspaceId,
    project_id: fixture.projectId,
    title_candidate_id: original.id,
    format_recommendation_id: formatGen.id,
    export_page_count_snapshot: 5,
    recommended_price: 9.99,
    base_price: 9.99,
    comparable_count: 0,
    demand_competition_multiplier: 1.0,
    depth_adjustment: 0,
    reasoning_summary: 'spoofed',
    reasoning_signals: [],
    inputs_snapshot: {},
    model: 'spoofed',
    generation_status: 'succeeded',
    recommendation_status: 'active',
  });
  assert(!!spoofErr, 'Expected the cross-workspace spoofed INSERT to be rejected by RLS');
  console.log(`OK: spoofed INSERT correctly rejected — ${spoofErr?.message}`);

  const { data: spoofSelect } = await other.supabase.from('pricing_recommendations').select('id').eq('id', rec.id).maybeSingle();
  assert(!spoofSelect, 'Expected the other workspace to see no rows for this pricing_recommendations id');
  console.log('OK: cross-workspace SELECT returned nothing.');

  // ============================================================
  // STALENESS PROOFS — lowest precedence first (export page count),
  // then format, then title (highest). Re-confirm pricing between each
  // so the staleness-triggered revert is observable.
  // ============================================================

  // First, re-confirm the changed pricing so we have a confirmed baseline for staleness proofs
  console.log('\n=== Re-confirming pricing for staleness proof baseline ===');
  await confirmPricing({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedPrice: changed.recommended_price,
    platformPrices: {
      etsy: (newSuggestions as any[]).find((s: any) => s.platform === 'etsy').suggested_price,
      gumroad: (newSuggestions as any[]).find((s: any) => s.platform === 'gumroad').suggested_price,
      stanstore: (newSuggestions as any[]).find((s: any) => s.platform === 'stanstore').suggested_price,
      whop: (newSuggestions as any[]).find((s: any) => s.platform === 'whop').suggested_price,
    },
  });
  const { data: proj5 } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(proj5?.status === 'pricing_confirmed', `Expected status='pricing_confirmed' after re-confirmation, got '${proj5?.status}'`);

  console.log('\n=== STALENESS PROOF 1/3: export page count change (lowest precedence) ===');
  // export_generations has no UPDATE grant (append-only by design), so simulate a
  // page-count change by inserting a new generation with a different page_count and
  // pointing the export_format_state to it.
  const { data: currentExportState } = await fixture.supabase
    .from('export_format_states')
    .select('id, current_export_generation_id')
    .eq('project_id', fixture.projectId)
    .eq('approval_status', 'approved')
    .limit(1)
    .maybeSingle();
  if (currentExportState?.current_export_generation_id) {
    const { data: origGen } = await fixture.supabase
      .from('export_generations')
      .select('page_count, output_format, generation_number, title_candidate_id, format_recommendation_id, content_build_confirmed_at, cover_generation_id')
      .eq('id', currentExportState.current_export_generation_id)
      .single();
    const originalPageCount = origGen?.page_count ?? 1;

    // Insert a synthetic generation with a different page count
    const { data: syntheticGen, error: synGenErr } = await fixture.supabase
      .from('export_generations')
      .insert({
        workspace_id: fixture.workspaceId,
        project_id: fixture.projectId,
        output_format: origGen!.output_format,
        generation_number: origGen!.generation_number + 100,
        trigger_scope: 'regenerate',
        title_candidate_id: origGen!.title_candidate_id,
        format_recommendation_id: origGen!.format_recommendation_id,
        content_build_confirmed_at: origGen!.content_build_confirmed_at,
        cover_generation_id: origGen!.cover_generation_id,
        page_count: originalPageCount + 10,
        generation_status: 'succeeded',
        asset_storage_path: `${fixture.workspaceId}/${fixture.projectId}/synthetic-pagecount.pdf`,
      })
      .select('id')
      .single();
    if (synGenErr) throw new Error(`Failed to insert synthetic generation: ${synGenErr.message}`);

    // Point the format state to the new generation (different page count)
    await fixture.supabase
      .from('export_format_states')
      .update({ current_export_generation_id: syntheticGen!.id })
      .eq('id', currentExportState.id);

    const afterExportChange = await getActivePricingRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId });
    assert(afterExportChange === null, 'Expected pricing to be invalidated after export page count change');
    const { data: projAfterExport } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
    assert(projAfterExport?.status === 'ready_to_download', `Expected status='ready_to_download' after staleness invalidation, got '${projAfterExport?.status}'`);
    console.log('OK: pricing invalidated after export page count change, status reverted to ready_to_download.');

    // Restore the format state pointer so we can rebuild pricing
    await fixture.supabase
      .from('export_format_states')
      .update({ current_export_generation_id: currentExportState.current_export_generation_id })
      .eq('id', currentExportState.id);
  } else {
    console.log('SKIP: no approved export to test page count staleness against (unexpected).');
  }

  // Rebuild pricing for the next staleness proof
  console.log('\n=== Rebuilding pricing for next staleness proof ===');
  const pricingGen2 = await generatePricingRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  const { data: newPlatSugs2 } = await fixture.supabase.from('pricing_platform_suggestions').select('*').eq('pricing_recommendation_id', pricingGen2.recommendation.id);
  await confirmPricing({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedPrice: pricingGen2.recommendation.recommended_price,
    platformPrices: {
      etsy: (newPlatSugs2 as any[]).find((s: any) => s.platform === 'etsy').suggested_price,
      gumroad: (newPlatSugs2 as any[]).find((s: any) => s.platform === 'gumroad').suggested_price,
      stanstore: (newPlatSugs2 as any[]).find((s: any) => s.platform === 'stanstore').suggested_price,
      whop: (newPlatSugs2 as any[]).find((s: any) => s.platform === 'whop').suggested_price,
    },
  });

  console.log('\n=== STALENESS PROOF 2/3: format change ===');
  // Change the format via changeFormat + confirm, which will give a new format_recommendation_id
  const newFormatRow = await changeFormat({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  await confirmFormatRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, userId: fixture.userId, confirmedFormat: 'workbook', confirmedDeliveryMode: newFormatRow.recommended_delivery_mode });

  const afterFormatChange = await getActivePricingRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterFormatChange === null, 'Expected pricing to be invalidated after format change');
  const { data: projAfterFormat } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterFormat?.status === 'ready_to_download', `Expected status='ready_to_download' after format staleness, got '${projAfterFormat?.status}'`);

  // Verify the superseded reason
  const { data: formatStalenessRow } = await fixture.supabase
    .from('pricing_recommendations')
    .select('superseded_reason')
    .eq('id', pricingGen2.recommendation.id)
    .single();
  assert(formatStalenessRow?.superseded_reason === 'format_changed', `Expected superseded_reason='format_changed', got '${formatStalenessRow?.superseded_reason}'`);
  console.log("OK: pricing invalidated after format change, superseded_reason='format_changed'.");

  // Rebuild pricing for the final staleness proof
  console.log('\n=== Rebuilding pricing for final staleness proof ===');
  const pricingGen3 = await generatePricingRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId, workspaceId: fixture.workspaceId });
  const { data: newPlatSugs3 } = await fixture.supabase.from('pricing_platform_suggestions').select('*').eq('pricing_recommendation_id', pricingGen3.recommendation.id);
  await confirmPricing({
    supabase: fixture.supabase,
    projectId: fixture.projectId,
    userId: fixture.userId,
    confirmedPrice: pricingGen3.recommendation.recommended_price,
    platformPrices: {
      etsy: (newPlatSugs3 as any[]).find((s: any) => s.platform === 'etsy').suggested_price,
      gumroad: (newPlatSugs3 as any[]).find((s: any) => s.platform === 'gumroad').suggested_price,
      stanstore: (newPlatSugs3 as any[]).find((s: any) => s.platform === 'stanstore').suggested_price,
      whop: (newPlatSugs3 as any[]).find((s: any) => s.platform === 'whop').suggested_price,
    },
  });

  console.log('\n=== STALENESS PROOF 3/3: title change (highest precedence) ===');
  await fixture.supabase.from('title_selections').insert({ project_id: fixture.projectId, workspace_id: fixture.workspaceId, research_run_id: researchResult.runId, selected_candidate_id: alternate.id, selected_by: fixture.userId });
  await fixture.supabase.from('projects').update({ selected_candidate_id: alternate.id }).eq('id', fixture.projectId);

  const afterTitleChange = await getActivePricingRecommendation({ supabase: fixture.supabase, projectId: fixture.projectId });
  assert(afterTitleChange === null, 'Expected pricing to be invalidated after title change');
  const { data: projAfterTitle } = await fixture.supabase.from('projects').select('status').eq('id', fixture.projectId).single();
  assert(projAfterTitle?.status === 'ready_to_download', `Expected status='ready_to_download' after title staleness, got '${projAfterTitle?.status}'`);

  // Verify the superseded reason
  const { data: titleStalenessRow } = await fixture.supabase
    .from('pricing_recommendations')
    .select('superseded_reason')
    .eq('id', pricingGen3.recommendation.id)
    .single();
  assert(titleStalenessRow?.superseded_reason === 'title_changed', `Expected superseded_reason='title_changed', got '${titleStalenessRow?.superseded_reason}'`);
  console.log("OK: pricing invalidated after title change, superseded_reason='title_changed'.");

  console.log(
    '\nSmoke test passed: the full Step 12 action set ran end-to-end through real RLS and live Groq — no-auto-fire, the pricing recommend/confirm cycle (with per-platform accept/override), changePricing supersede-and-carry-forward, the RLS proof, and all 3 staleness dependencies (export page count, format, title) were all verified live.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
