// Live smoke test for recommendLeadMagnet — actually calls Groq, unlike
// tests/recommendLeadMagnet.test.ts which mocks it. Run with: npm run smoke:leadmagnet-ai
// (requires GROQ_API_KEY set in .env).
import { recommendLeadMagnet } from '../lib/leadmagnet/recommendLeadMagnet';

interface Case {
  label: string;
  expectSuitable: boolean;
  title: string;
  rationale: string;
  demandScore: number;
  demandSignalDetail: unknown;
  competitionScore: number;
  competitionSignalDetail: unknown;
  confirmedFormat: string;
  confirmedDeliveryMode: string | null;
}

// competitionScore is the inverted "gap" scale (decision 4): LOW score = crowded/
// competitive market. Cases 1-2 use a low competitionScore (3) to simulate a crowded
// market that should favor recommending a lead magnet for differentiation.
const cases: Case[] = [
  {
    label: 'Suitable + modular format -> expect stripped_sample',
    expectSuitable: true,
    title: 'Notion Budget Tracker for Freelancers',
    rationale: 'Freelancers want ongoing tracking; a smaller taste of the tracker would help build an audience before the paid ask.',
    demandScore: 8,
    demandSignalDetail: { avgFavorers: 220, avgViews: 5100 },
    competitionScore: 3, // crowded market
    competitionSignalDetail: { exactAngleMatchCount: 6, totalListingCount: 610 },
    confirmedFormat: 'tracker',
    confirmedDeliveryMode: 'fillable',
  },
  {
    label: 'Suitable + non-modular format -> expect standalone_funnel',
    expectSuitable: true,
    title: 'The Complete Guide to Freelance Taxes',
    rationale: 'Tax guidance feels sensitive, so a free complete resource on a smaller related topic would build trust before the paid deep-dive.',
    demandScore: 7,
    demandSignalDetail: { avgFavorers: 90, avgViews: 1800 },
    competitionScore: 3, // crowded market
    competitionSignalDetail: { exactAngleMatchCount: 6, totalListingCount: 610 },
    confirmedFormat: 'ebook',
    confirmedDeliveryMode: null,
  },
  {
    label: 'Low demand + white-space market -> expect not suitable',
    expectSuitable: false,
    title: '5-Minute Daily Gratitude Journal Prompts',
    rationale: 'A small, focused journal product for a specific niche audience I already have.',
    demandScore: 2,
    demandSignalDetail: { avgFavorers: 3, avgViews: 40 },
    competitionScore: 9, // lots of white space, no differentiation pressure
    competitionSignalDetail: { exactAngleMatchCount: 0, totalListingCount: 12 },
    confirmedFormat: 'workbook',
    confirmedDeliveryMode: 'printable',
  },
];

async function main() {
  for (const c of cases) {
    console.log(`\n=== ${c.label}: "${c.title}" ===`);
    const result = await recommendLeadMagnet(c);
    console.log(JSON.stringify(result, null, 2));

    if (result.recommendedSuitable !== c.expectSuitable) {
      console.warn(`  (note: expected suitable=${c.expectSuitable}, got ${result.recommendedSuitable} — model judgment call, not necessarily wrong)`);
    }
    if (!result.recommendedSuitable && (result.recommendedType !== null || result.alternateTypeConsidered !== null)) {
      throw new Error('Guardrail violation: not-suitable returned with a non-null type or alternate');
    }
    if (result.reasoningSignals.length === 0 && result.confidence !== 'low') {
      throw new Error('Empty reasoning_signals but confidence was not downgraded to low');
    }
  }

  console.log('\nSmoke test passed: live Groq calls returned valid, guardrail-conformant recommendations for all 3 cases.');
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
