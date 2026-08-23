// Live smoke test for generateSubtopicList and regenerateSingleSubtopic — actually
// calls Groq, unlike tests/generateSubtopicList.test.ts and
// tests/regenerateSingleSubtopic.test.ts, which mock it. Checks real generated counts
// land inside each format's target range (not just the guardrail's forced-truncation
// path), across three different formats with genuinely different unit definitions, plus
// one single-item regenerate call checked for genuine non-duplication against real
// siblings. Run with: npm run smoke:subtopics-ai
import { generateSubtopicList, type GenerateSubtopicListInput } from '../lib/subtopics/generateSubtopicList';
import { regenerateSingleSubtopic } from '../lib/subtopics/regenerateSingleSubtopic';
import { targetCountForFormat, wordOverlapRatio } from '../lib/subtopics/rules';
import type { FormatType } from '../lib/subtopics/types';

const baseFields = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking, and dread the unpredictability of irregular income.',
  headlineBefore: 'Dreads opening her finances every Sunday night.',
  headlineAfter: 'Feels a calm, almost boring sense that money is handled.',
  dimEmotionalBefore: 'A knot in her stomach every Sunday night before the week\'s bills are due.',
  dimEmotionalAfter: 'Sunday nights are just Sunday nights again. No dread, no bracing.',
  dimPracticalBefore: 'Manually reconciling four spreadsheets and two banking apps, two hours a week.',
  dimPracticalAfter: 'Opens one dashboard that updates itself. Checks it in under five minutes, twice a week.',
  dimIdentityBefore: '"I\'m just bad with money. I\'ll never really get ahead, no matter how hard I try."',
  dimIdentityAfter: '"I\'m someone who has this handled. I\'m in control of my own future."',
  dimPainPointBefore: 'Opening the banking app and feeling a stomach-drop of dread before she\'s even looked.',
  dimPainPointAfter: 'Opening the banking app on autopilot — no bracing, no dread — no surprises left to find.',
  demandScore: 8,
  demandSignalDetail: { avgFavorers: 220, avgViews: 5100 },
  competitionScore: 6,
  competitionSignalDetail: { exactAngleMatchCount: 2, totalListingCount: 340 },
};

const formatsToCheck: { format: FormatType; deliveryMode: string | null }[] = [
  { format: 'tracker', deliveryMode: 'fillable' },
  { format: 'workbook', deliveryMode: 'fillable' },
  { format: 'quiz', deliveryMode: 'fillable' },
];

async function checkWholeListGeneration(): Promise<string[]> {
  let lastListTitles: string[] = [];

  for (const { format, deliveryMode } of formatsToCheck) {
    const target = targetCountForFormat(format);
    const input: GenerateSubtopicListInput = {
      ...baseFields,
      confirmedFormat: format,
      confirmedDeliveryMode: deliveryMode,
    };

    console.log(`\n${'='.repeat(70)}\nFormat: ${format} — target range [${target.min}, ${target.max}]\n${'='.repeat(70)}`);
    const result = await generateSubtopicList(input, target);
    console.log(JSON.stringify(result, null, 2));

    const count = result.subtopics.length;
    const inRange = count >= target.min && count <= target.max;
    console.log(
      `\n-> ${count} subtopics, status=${result.generationStatus}, ${inRange ? 'WITHIN' : 'OUTSIDE'} the target range without needing guardrail truncation.`,
    );
    if (!inRange && result.generationStatus === 'succeeded') {
      throw new Error(`Guardrail bug: status=succeeded but count ${count} is outside [${target.min}, ${target.max}]`);
    }

    if (format === 'workbook') {
      lastListTitles = result.subtopics.map((s) => s.title);
    }
  }

  return lastListTitles;
}

async function checkSingleItemRegenerate(siblingTitles: string[]) {
  console.log(`\n${'='.repeat(70)}\nSingle-item regenerate against ${siblingTitles.length} real siblings\n${'='.repeat(70)}`);
  console.log('Siblings:', siblingTitles);

  const result = await regenerateSingleSubtopic({
    ...baseFields,
    confirmedFormat: 'workbook',
    confirmedDeliveryMode: 'fillable',
    siblingTitles,
  });

  console.log('\nRegenerated item:', JSON.stringify(result, null, 2));

  const maxOverlap = Math.max(...siblingTitles.map((s) => wordOverlapRatio(s, result.title)));
  console.log(`\n-> Max word-overlap ratio against any sibling: ${maxOverlap.toFixed(3)} (threshold is > 0.8)`);
  if (maxOverlap > 0.8) {
    throw new Error('Guardrail bug: regenerated title should have been rejected/retried as a near-duplicate but was not');
  }
}

async function main() {
  const workbookTitles = await checkWholeListGeneration();
  if (workbookTitles.length === 0) {
    throw new Error('Workbook generation produced zero subtopics — cannot run the single-item regenerate check against real siblings');
  }
  await checkSingleItemRegenerate(workbookTitles);

  console.log('\nSmoke test passed: all formats generated within their target range (or honestly flagged below-target), and the regenerated single item did not duplicate a real sibling.');
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
