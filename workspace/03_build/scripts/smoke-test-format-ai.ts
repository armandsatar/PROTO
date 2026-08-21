// Live smoke test for recommendFormat — actually calls Groq, unlike tests/recommendFormat.test.ts
// which mocks it. Run with: npm run smoke:format-ai (requires GROQ_API_KEY set in .env).
import { recommendFormat } from '../lib/format/recommendFormat';

interface Case {
  label: string;
  title: string;
  rationale: string;
  demandScore: number;
  demandSignalDetail: unknown;
  competitionScore: number;
  competitionSignalDetail: unknown;
}

const cases: Case[] = [
  {
    label: 'Tracker-shaped title',
    title: 'Notion Budget Tracker for Freelancers',
    rationale: 'Freelancers want to log irregular income daily and see rolling totals.',
    demandScore: 8,
    demandSignalDetail: { avgFavorers: 220, avgViews: 5100 },
    competitionScore: 6,
    competitionSignalDetail: { exactAngleMatchCount: 2, totalListingCount: 340 },
  },
  {
    label: 'Ebook-shaped title',
    title: 'The Complete Guide to Freelance Taxes',
    rationale: 'Freelancers are confused by quarterly taxes and want a clear reference to read once and keep.',
    demandScore: 7,
    demandSignalDetail: { avgFavorers: 90, avgViews: 1800 },
    competitionScore: 4,
    competitionSignalDetail: { exactAngleMatchCount: 6, totalListingCount: 610 },
  },
  {
    label: 'Quiz-shaped title',
    title: 'Which Budgeting Style Are You? A Freelancer Money Quiz',
    rationale: 'Wanted as a fun, shareable lead-in before pointing people at the paid tracker.',
    demandScore: 5,
    demandSignalDetail: { avgFavorers: 30, avgViews: 400 },
    competitionScore: 8,
    competitionSignalDetail: { exactAngleMatchCount: 0, totalListingCount: 40 },
  },
];

async function main() {
  for (const c of cases) {
    console.log(`\n=== ${c.label}: "${c.title}" ===`);
    const result = await recommendFormat(c);
    console.log(JSON.stringify(result, null, 2));

    if (result.recommendedFormat === 'ebook' && result.recommendedDeliveryMode !== null) {
      throw new Error('Guardrail violation: ebook returned with a non-null delivery mode');
    }
    if (result.reasoningSignals.length === 0) {
      console.warn('  (note: reasoning_signals was empty, confidence should be low)');
      if (result.confidence !== 'low') throw new Error('Empty reasoning_signals but confidence was not downgraded to low');
    }
  }

  console.log('\nSmoke test passed: live Groq calls returned valid, guardrail-conformant recommendations for all 3 cases.');
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
