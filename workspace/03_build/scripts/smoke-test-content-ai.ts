// Live smoke test for generateWriterPass and generateReviewPass — actually calls Groq,
// unlike tests/generateWriterPass.test.ts and tests/generateReviewPass.test.ts, which
// mock it. Checks real word counts land near target across three format/depth
// combinations, then deliberately feeds the review pass a hand-crafted draft
// containing a real absolutist health claim to verify the compliance pass genuinely
// catches and rewrites something real, rather than only ever seeing clean input and
// trivially returning no_changes_needed. Run with: npm run smoke:content-ai
import { generateWriterPass, type GenerateWriterPassInput } from '../lib/content/generateWriterPass';
import { generateReviewPass } from '../lib/content/generateReviewPass';
import { wordCountTargetForFormatAndDepth } from '../lib/content/rules';
import { scanAbsolutistClaims } from '../lib/content/contentScanners';
import type { FormatType, SubtopicDepth } from '../lib/content/types';

const baseFields = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking, and dread the unpredictability of irregular income.',
  confirmedDeliveryMode: 'fillable',
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
  siblingSubtopicTitles: ['Automating Recurring Bill Reminders', 'Building a Realistic Emergency Buffer'],
};

interface Case {
  label: string;
  format: FormatType;
  depth: SubtopicDepth;
  subtopicTitle: string;
  subtopicDescription: string;
}

const cases: Case[] = [
  {
    label: 'Workbook / medium',
    format: 'workbook',
    depth: 'medium',
    subtopicTitle: 'Setting Up Your Weekly Budget Foundation',
    subtopicDescription: 'Defines fixed vs. variable expenses and sets a baseline weekly number before tracking begins.',
  },
  {
    label: 'Ebook / deep',
    format: 'ebook',
    depth: 'deep',
    subtopicTitle: 'Why Irregular Income Breaks Traditional Budgeting Advice',
    subtopicDescription: 'A full chapter exploring why monthly-budget advice fails freelancers and what to do instead.',
  },
  {
    label: 'Tracker / shallow',
    format: 'tracker',
    depth: 'shallow',
    subtopicTitle: 'Weekly Invoice Status Log',
    subtopicDescription: 'Short instructional copy for a tracker category logging invoice status.',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkWriterAndReviewPasses() {
  // Groq's free-tier TPM limit (8000/min at time of writing) is real and was hit live
  // during this smoke test's first run when a long ebook/deep draft's review call
  // stacked on top of prior calls in the same minute — a genuine signal that Step 8's
  // eventual N-subtopic orchestration (up to 2 calls x N per document) will need real
  // pacing, not just a smoke-test convenience. A short pause between cases here is
  // enough to get through this script's own verification; it doesn't stand in for that
  // production concern, which is out of scope for this increment.
  for (const c of cases) {
    const target = wordCountTargetForFormatAndDepth(c.format, c.depth);
    const input: GenerateWriterPassInput = {
      ...baseFields,
      confirmedFormat: c.format,
      subtopicTitle: c.subtopicTitle,
      subtopicDescription: c.subtopicDescription,
      subtopicDepth: c.depth,
    };

    console.log(`\n${'='.repeat(70)}\n${c.label} — target range [${target.min}, ${target.max}]\n${'='.repeat(70)}`);
    const writerResult = await generateWriterPass(input, target);
    console.log(`Writer pass: ${writerResult.wordCount} words, meetsLengthTarget=${writerResult.meetsLengthTarget}`);
    console.log(writerResult.content.slice(0, 300) + (writerResult.content.length > 300 ? '...' : ''));

    const reviewResult = await generateReviewPass({
      title: baseFields.title,
      subtopicTitle: c.subtopicTitle,
      subtopicDescription: c.subtopicDescription,
      draftContent: writerResult.content,
    });
    console.log(`\nReview pass: specificity_score=${reviewResult.specificityScore}, slopHitCount=${reviewResult.slopHitCount}, complianceChanges=${reviewResult.complianceChanges.length}`);

    if (!writerResult.meetsLengthTarget) {
      console.log(`NOTE: word count fell outside the tolerance band even after retry — real signal on whether the target table (decision 6/22) needs tuning.`);
    }

    await sleep(15000);
  }
}

async function checkComplianceCatchesARealClaim() {
  await sleep(15000);
  console.log(`\n${'='.repeat(70)}\nDeliberately risky input — checking the compliance pass against a real claim\n${'='.repeat(70)}`);

  const riskyDraft =
    'This 30-day breathing program guarantees you will completely eliminate anxiety symptoms, with no side effects. It is clinically proven to cure chronic stress for everyone who tries it.';

  console.log('Draft (hand-crafted, deliberately risky):');
  console.log(riskyDraft);

  const preScanHits = scanAbsolutistClaims(riskyDraft).map((h) => h.phrase);
  console.log(`\nDeterministic pre-scan of the draft found: ${preScanHits.join(', ')}`);

  const result = await generateReviewPass({
    title: 'Anxiety Relief Breathing Program',
    subtopicTitle: 'How the Program Works',
    subtopicDescription: 'Explains the breathing technique and what results to expect.',
    draftContent: riskyDraft,
  });

  console.log(`\nFinal content:\n${result.finalContent}`);
  console.log(`\nCompliance changes (${result.complianceChanges.length}):`);
  for (const c of result.complianceChanges) {
    console.log(`  [${c.detectedBy}] "${c.originalText}" -> "${c.rewrittenText}"\n    reason: ${c.reason}`);
  }

  const postScanHits = scanAbsolutistClaims(result.finalContent).map((h) => h.phrase);
  console.log(`\nDeterministic post-scan of final_content found: ${postScanHits.length === 0 ? 'none' : postScanHits.join(', ')}`);

  if (result.complianceChanges.length === 0) {
    throw new Error(
      'Compliance pass returned zero changes for a deliberately risky draft — either the AI silently fixed it without logging a change (a real problem) or the mechanism did not fire at all.',
    );
  }
  console.log('\nOK: the compliance pass produced at least one real, logged change against genuinely risky input.');
}

async function main() {
  await checkWriterAndReviewPasses();
  await checkComplianceCatchesARealClaim();

  console.log(
    '\nSmoke test passed: writer/review passes ran live for three format/depth combinations, and the compliance mechanism produced a real, logged rewrite against a deliberately risky draft — not just a clean pass-through.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
