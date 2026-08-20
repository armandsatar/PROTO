// Live smoke test — actually calls the Groq API, unlike tests/ai.test.ts which mocks it.
// Run with: npm run smoke:ai (requires GROQ_API_KEY set in .env)
import { MockEtsyDataSource } from '../lib/data-sources/etsy/mock';
import { classifyExactAngleMatches } from '../lib/ai/classify';
import { generateTitleVariants } from '../lib/ai/generateCandidates';

async function main() {
  const originalTitle = 'Notion Budget Tracker for Freelancers';
  const rationale =
    'Seeing rising interest in freelancer-specific finance tools, and existing Etsy budget templates are generic — not tailored to irregular freelance income.';

  console.log(`\n=== Original title: "${originalTitle}" ===\n`);

  const etsy = new MockEtsyDataSource();
  const searchResult = await etsy.searchListings(originalTitle.split(' '), { limit: 10 });
  console.log(`Mock Etsy search: totalCount=${searchResult.totalCount}, returned ${searchResult.listings.length} listings`);
  console.log('Sample listing titles:', searchResult.listings.slice(0, 3).map((l) => l.title));

  console.log('\n--- Calling Groq: classifyExactAngleMatches (live) ---');
  const classifications = await classifyExactAngleMatches(originalTitle, searchResult.listings);
  console.log('Classifications:', JSON.stringify(classifications, null, 2));

  const exactAngleListings = searchResult.listings.filter((l) =>
    classifications.some((c) => c.listingId === l.listingId && c.label === 'exact_angle'),
  );
  console.log(`\n${exactAngleListings.length} of ${searchResult.listings.length} listings classified exact_angle`);

  console.log('\n--- Calling Groq: generateTitleVariants (live) ---');
  const variants = await generateTitleVariants({
    originalTitle,
    rationale,
    exactAngleMatchListingTitles: exactAngleListings.map((l) => l.title),
  });
  console.log('Generated variants:', JSON.stringify(variants, null, 2));

  console.log('\n=== Full 4-candidate pool (original + 3 generated) ===');
  console.log('1. [original]          ', originalTitle);
  for (const v of variants) {
    console.log(`   [${v.axis}]`.padEnd(24), v.text);
  }

  console.log('\nSmoke test passed: live Groq calls returned structured, valid JSON for both classification and generation.');
}

main().catch((err) => {
  console.error('Smoke test FAILED:', err);
  process.exit(1);
});
