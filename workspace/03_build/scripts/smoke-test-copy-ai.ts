// Live Groq connector-shape check for Step 10's two-phase call shape (decision 14),
// before any orchestration code (Increment 4+) trusts it: the narrative writer+review
// pass, then two representative platform adaptations — Etsy (the most novel shape:
// title + tags[] + a real hard limit to retry against) and Instagram (the simplest:
// caption-only, no title field at all). Run with: npm run smoke:copy-ai
import { generateNarrativeWriterPass, generatePlatformAdaptationWriterPass } from '../lib/copywriting/generateWriterPass';
import { generateReviewPass } from '../lib/copywriting/generateReviewPass';
import { checkHardLimits } from '../lib/copywriting/rules';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  console.log('=== Narrative writer pass (live Groq) ===');
  const narrativeDraft = await generateNarrativeWriterPass({
    title: 'Notion Budget Tracker for Freelancers',
    rationale: 'Freelancers want ongoing tracking and dread the unpredictability of irregular income.',
    confirmedFormat: 'workbook',
    confirmedDeliveryMode: 'fillable',
    headlineBefore: 'Dreading every invoice cycle, no idea what\'s actually coming in',
    headlineAfter: 'Calm, in control, and never blindsided by a slow month',
    dimEmotionalBefore: 'Anxious about money most days',
    dimEmotionalAfter: 'Steady and confident',
    dimPracticalBefore: 'Tracking income in scattered notes',
    dimPracticalAfter: 'One real system that updates itself',
    dimIdentityBefore: 'Feels like a hobbyist freelancer',
    dimIdentityAfter: 'Runs it like a real business',
    dimPainPointBefore: 'Missed a tax deadline last year',
    dimPainPointAfter: 'Deadlines tracked automatically',
    subtopics: [
      { title: 'Monthly Income Log', description: 'Track every invoice and payment by client and date.' },
      { title: 'Tax Set-Aside Calculator', description: 'Automatically calculates what to set aside per payment.' },
    ],
    contentBodies: [
      {
        subtopicTitle: 'Monthly Income Log',
        body: 'This section walks through logging each invoice as it comes in, categorized by client, with a running 3-month average to spot slow periods before they become a crisis.',
      },
      {
        subtopicTitle: 'Tax Set-Aside Calculator',
        body: 'A formula-driven table that takes your logged income and calculates a 25-30% set-aside recommendation per payment, adjustable by your own effective tax rate.',
      },
    ],
    coverLookMoodDescriptor: 'editorial and serif-driven, calm and organized',
  });
  console.log('Narrative draft:', JSON.stringify(narrativeDraft.fields, null, 2));
  assert(narrativeDraft.fields.hook.length > 0, 'Expected a non-empty hook');

  console.log('\n=== Narrative review pass (live Groq) ===');
  const narrativeReview = await generateReviewPass({
    title: 'Notion Budget Tracker for Freelancers',
    draftFields: {
      hook: narrativeDraft.fields.hook,
      transformationStory: narrativeDraft.fields.transformationStory,
      cta: narrativeDraft.fields.cta,
      summary: narrativeDraft.fields.summary,
    },
    groundingText:
      'Monthly Income Log: track every invoice and payment by client and date, with a running 3-month average. Tax Set-Aside Calculator: a formula-driven table calculating a 25-30% set-aside recommendation per payment.',
  });
  console.log(`Specificity score: ${narrativeReview.specificityScore}/10, compliance changes: ${narrativeReview.complianceChanges.length}, slop hits: ${narrativeReview.slopHitCount}`);
  assert(narrativeReview.finalFields.hook.length > 0, 'Expected a non-empty final hook');

  const narrative = {
    hook: narrativeReview.finalFields.hook,
    transformationStory: narrativeReview.finalFields.transformationStory,
    cta: narrativeReview.finalFields.cta,
    summary: narrativeReview.finalFields.summary,
  };

  console.log('\n=== Etsy adaptation writer pass (live Groq) — the most novel shape: title + tags[] + a real hard limit ===');
  const etsyDraft = await generatePlatformAdaptationWriterPass({
    platform: 'etsy',
    narrative,
    title: 'Notion Budget Tracker for Freelancers',
    confirmedFormat: 'workbook',
    confirmedDeliveryMode: 'fillable',
  });
  console.log('Etsy draft:', JSON.stringify(etsyDraft, null, 2));
  assert(etsyDraft.title !== null, 'Expected Etsy to have a title (hasTitle=true)');
  assert(etsyDraft.title!.length <= 140, `Expected Etsy title within the 140-char hard limit, got ${etsyDraft.title!.length}`);
  const etsyHardLimitCheck = checkHardLimits('etsy', etsyDraft);
  console.log(`Etsy hard-limit status: ${etsyHardLimitCheck.status}`);

  console.log('\n=== Etsy adaptation review pass (live Groq) ===');
  const etsyReview = await generateReviewPass({
    title: 'Notion Budget Tracker for Freelancers',
    draftFields: { title: etsyDraft.title!, body: etsyDraft.body },
    groundingText: JSON.stringify(narrative),
  });
  console.log(`Etsy specificity score: ${etsyReview.specificityScore}/10`);
  assert(etsyReview.finalFields.title.length > 0, 'Expected a non-empty final Etsy title');

  console.log('\n=== Instagram adaptation writer pass (live Groq) — the simplest shape: caption-only, no title ===');
  const instagramDraft = await generatePlatformAdaptationWriterPass({
    platform: 'instagram',
    narrative,
    title: 'Notion Budget Tracker for Freelancers',
    confirmedFormat: 'workbook',
    confirmedDeliveryMode: 'fillable',
  });
  console.log('Instagram draft:', JSON.stringify(instagramDraft, null, 2));
  assert(instagramDraft.title === null, 'Expected Instagram to have no title (hasTitle=false)');
  assert(instagramDraft.body.length <= 2200, `Expected Instagram caption within the 2,200-char hard limit, got ${instagramDraft.body.length}`);

  console.log('\n=== Instagram adaptation review pass (live Groq) ===');
  const instagramReview = await generateReviewPass({
    title: 'Notion Budget Tracker for Freelancers',
    draftFields: { body: instagramDraft.body },
    groundingText: JSON.stringify(narrative),
  });
  console.log(`Instagram specificity score: ${instagramReview.specificityScore}/10`);
  assert(instagramReview.finalFields.body.length > 0, 'Expected a non-empty final Instagram caption');

  console.log(
    '\nSmoke test passed: the narrative writer+review pass and both representative platform adaptations (Etsy\'s title+tags+hard-limit shape, Instagram\'s caption-only shape) all ran live against real Groq — the two-phase call shape (decision 14) is confirmed working before any orchestration code trusts it.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
