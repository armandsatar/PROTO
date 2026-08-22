// Live smoke test for generateTransformationMap — actually calls Groq, unlike
// tests/generateTransformationMap.test.ts which mocks it. Two different titles (one
// deliberately far from the prompt's own few-shot example) to check the model isn't
// just parroting the example's content. Run with: npm run smoke:transformationmap-ai
//
// NOTE: unlike every other smoke-test-*-ai.ts script, this one has no automated
// pass/fail on the thing that actually matters (decision 4 — "is this visceral" has
// no deterministic check by design). The guardrail's structural pass/fail is checked
// below, but the tone/specificity itself needs a human read-through of the printed output.
import { generateTransformationMap } from '../lib/transformationmap/generateTransformationMap';

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
    label: 'Same domain as the prompt\'s few-shot example (checking for parroting)',
    title: 'Notion Budget Tracker for Freelancers',
    rationale: 'Freelancers want ongoing tracking, and dread the unpredictability of irregular income.',
    demandScore: 8,
    demandSignalDetail: { avgFavorers: 220, avgViews: 5100 },
    competitionScore: 6,
    competitionSignalDetail: { exactAngleMatchCount: 2, totalListingCount: 340 },
  },
  {
    label: 'Deliberately different domain — no financial angle at all',
    title: '30-Day Beginner Strength Training Plan for Desk Workers',
    rationale: 'Desk workers feel stiff and weak from sitting all day but are intimidated by gym culture and don\'t know where to start.',
    demandScore: 6,
    demandSignalDetail: { avgFavorers: 60, avgViews: 900 },
    competitionScore: 4,
    competitionSignalDetail: { exactAngleMatchCount: 5, totalListingCount: 480 },
  },
];

async function main() {
  for (const c of cases) {
    console.log(`\n${'='.repeat(70)}\n${c.label}\nTitle: "${c.title}"\n${'='.repeat(70)}`);
    const result = await generateTransformationMap(c);
    console.log(JSON.stringify(result, null, 2));
  }

  console.log(
    '\nGuardrail structural checks passed for both cases (completeness, min-length, before!=after — otherwise this would have thrown).',
  );
  console.log('No automated "is this visceral" check exists by design (decision 4) — read the output above:');
  console.log('  - Does case 1 differ meaningfully from the prompt\'s embedded few-shot example, or does it look copied?');
  console.log('  - Does case 2 (strength training) show genuine sensory/emotional/identity specificity, or generic fitness-copy phrasing?');
  console.log('\nSmoke test passed (structurally) — manual read-through above is the real verification for this step.');
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
