// End-to-end Step 0 smoke test: curated seed library structure validation,
// batch scoring on 5 seeds (mock Etsy + live Groq classification), AI seed
// generation (live Groq), and scoring of AI-generated seeds. No Supabase
// required — Step 0 is ephemeral (decision 12).
// Run with: npm run smoke:discovery
import { CURATED_SEEDS, SEED_CATEGORIES } from '../lib/discovery/seeds';
import { runDiscovery } from '../lib/discovery/runDiscovery';
import { generateSeeds } from '../lib/discovery/generateSeeds';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  // ============================================================
  // 1. Validate curated seed library structure
  // ============================================================
  console.log('=== Curated seed library validation ===');
  assert(CURATED_SEEDS.length >= 50, `Expected at least 50 seeds, got ${CURATED_SEEDS.length}`);
  console.log(`OK: ${CURATED_SEEDS.length} curated seeds across ${SEED_CATEGORIES.length} categories.`);
  console.log(`Categories: ${SEED_CATEGORIES.join(', ')}`);

  for (const cat of SEED_CATEGORIES) {
    const count = CURATED_SEEDS.filter((s) => s.category === cat).length;
    assert(count >= 3, `Category '${cat}' has only ${count} seeds (expected at least 3)`);
  }
  console.log('OK: all categories have at least 3 seeds.');

  // ============================================================
  // 2. Batch score 5 curated seeds (mock Etsy + live Groq classification)
  // ============================================================
  console.log('\n=== Batch scoring 5 curated seeds (live Groq) ===');
  const sampleSeeds = CURATED_SEEDS.slice(0, 5);
  console.log(`Scoring: ${sampleSeeds.map((s) => `"${s.title}"`).join(', ')}`);

  const result = await runDiscovery({ seeds: [...sampleSeeds], concurrency: 3 });

  assert(result.scoredCount === 5, `Expected 5 scored niches, got ${result.scoredCount}`);
  assert(result.niches.length === 5, `Expected 5 niches in results, got ${result.niches.length}`);
  assert(result.elapsedMs > 0, 'Expected positive elapsed time');
  console.log(`OK: ${result.scoredCount} niches scored in ${(result.elapsedMs / 1000).toFixed(1)}s.`);

  // Verify sorting (descending by combinedScore)
  for (let i = 1; i < result.niches.length; i++) {
    assert(
      result.niches[i - 1].combinedScore >= result.niches[i].combinedScore,
      `Results not sorted: ${result.niches[i - 1].combinedScore} < ${result.niches[i].combinedScore}`,
    );
  }
  console.log('OK: results sorted by combined score descending.');

  // Verify enhanced context on each niche
  for (const niche of result.niches) {
    assert(niche.demand.score >= 1 && niche.demand.score <= 10, `Invalid demand score: ${niche.demand.score}`);
    assert(niche.competition.score >= 1 && niche.competition.score <= 10, `Invalid competition score: ${niche.competition.score}`);
    assert(typeof niche.combinedScore === 'number', 'Expected numeric combined score');
    assert(typeof niche.marketSize.exactAngleCount === 'number', 'Expected numeric exactAngleCount');
    assert(typeof niche.marketSize.totalCount === 'number', 'Expected numeric totalCount');
    assert(Array.isArray(niche.exampleListings), 'Expected exampleListings array');
    assert(niche.rationale.length > 0, 'Expected non-empty rationale');
    assert(niche.category.length > 0, 'Expected non-empty category');
  }
  console.log('OK: all enhanced context fields present and valid.');

  // Print results as readable niche cards
  console.log('\n--- Scored Niche Cards ---');
  for (const niche of result.niches) {
    console.log(`\n  ${niche.seed}`);
    console.log(`  Demand: ${niche.demand.score}/10 (${niche.demand.color}) | Competition: ${niche.competition.score}/10 (${niche.competition.color}) | Overall: ${niche.combinedScore}/10`);
    console.log(`  Market: ${niche.marketSize.exactAngleCount} exact-angle listings, ${niche.marketSize.totalCount} total`);
    if (niche.priceRange) {
      console.log(`  Prices: $${niche.priceRange.min.toFixed(2)}–$${niche.priceRange.max.toFixed(2)}`);
    }
    if (niche.exampleListings.length > 0) {
      console.log(`  Examples: ${niche.exampleListings.slice(0, 2).join(' | ')}`);
    }
  }

  // ============================================================
  // 3. AI seed generation (live Groq brainstorm)
  // ============================================================
  console.log('\n=== AI seed generation (live Groq) ===');
  const aiSeeds = await generateSeeds({ count: 10 });
  assert(aiSeeds.length >= 5, `Expected at least 5 valid AI-generated seeds, got ${aiSeeds.length}`);
  console.log(`OK: ${aiSeeds.length} AI-generated seeds returned.`);

  for (const seed of aiSeeds) {
    assert(seed.title.length >= 10, `AI seed title too short: "${seed.title}"`);
    assert(seed.title.length <= 100, `AI seed title too long: "${seed.title}"`);
    assert(seed.rationale.length > 0, `AI seed has empty rationale: "${seed.title}"`);
  }
  console.log('OK: all AI seeds pass validation (10-100 char titles, non-empty rationales).');

  console.log('\n--- AI-Generated Seeds ---');
  for (const seed of aiSeeds.slice(0, 5)) {
    console.log(`  "${seed.title}" — ${seed.rationale}`);
  }

  // ============================================================
  // 4. Score 3 AI-generated seeds (verify scoring works on AI output)
  // ============================================================
  console.log('\n=== Scoring 3 AI-generated seeds (live Groq) ===');
  const aiSeedsToScore = aiSeeds.slice(0, 3).map((s) => ({
    ...s,
    category: 'ai-generated',
  }));

  const aiResult = await runDiscovery({ seeds: aiSeedsToScore, concurrency: 3 });
  assert(aiResult.scoredCount === 3, `Expected 3 scored AI niches, got ${aiResult.scoredCount}`);
  console.log(`OK: ${aiResult.scoredCount} AI-generated niches scored in ${(aiResult.elapsedMs / 1000).toFixed(1)}s.`);

  console.log('\n--- AI-Generated Niche Cards ---');
  for (const niche of aiResult.niches) {
    console.log(`\n  ${niche.seed}`);
    console.log(`  Demand: ${niche.demand.score}/10 (${niche.demand.color}) | Competition: ${niche.competition.score}/10 (${niche.competition.color}) | Overall: ${niche.combinedScore}/10`);
    console.log(`  Market: ${niche.marketSize.exactAngleCount} exact-angle, ${niche.marketSize.totalCount} total`);
  }

  console.log(
    '\nSmoke test passed: curated seed library validated (50+ seeds, 10 categories), batch scoring produced sorted results with enhanced context, AI seed generation returned valid niches, and AI-generated seeds scored successfully.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
