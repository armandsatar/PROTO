// Live connector-shape check for decision 1's structure-extraction pass — a genuinely
// new AI-usage category for this codebase (classification/extraction over already-
// confirmed text, not prose generation and not a small-enum recommendation). Uses
// realistic hand-authored tracker content (mirroring what Step 8 would actually
// produce for a fillable-format product) rather than running the full Steps 2-8
// chain, since this is a focused connector spike, not the full end-to-end test.
// Run with: npm run verify:field-structure
import { generateFieldStructurePass } from '../lib/export/generateFieldStructure';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// Realistic tracker subtopic content: a heading, instructional prose, a checklist,
// and a real fill-in blank — the exact mix decision 1's classification needs to
// distinguish correctly to be useful at all.
const SAMPLE_BODY = `Week 1: Income Check-In

Before you log anything this week, take a moment to review last week's total. This section only takes two minutes but it's the habit that makes the rest of the tracker actually work.

- Logged every invoice sent this week
- Logged every payment received this week
- Reviewed the running 3-month average

This week's total income: ____________

Notes on anything unusual this week: ____________`;

async function main() {
  console.log('=== Structure-extraction pass (live Groq) against realistic tracker content ===');
  const result = await generateFieldStructurePass({
    subtopicTitle: 'Week 1: Income Check-In',
    body: SAMPLE_BODY,
    confirmedFormat: 'tracker',
  });

  console.log(`\nExtracted ${result.blocks.length} blocks:`);
  for (const block of result.blocks) {
    console.log(`  [${block.order}] ${block.fieldType.padEnd(24)} "${block.text.slice(0, 60)}${block.text.length > 60 ? '...' : ''}"`);
  }

  assert(result.blocks.length > 0, 'Expected at least one extracted block');
  assert(result.blocks.some((b) => b.fieldType === 'heading'), 'Expected at least one heading block');
  assert(result.blocks.some((b) => b.fieldType === 'checklist_item'), 'Expected at least one checklist_item block (the 3 bullet points)');
  assert(result.blocks.some((b) => b.fieldType === 'user_input_blank'), 'Expected at least one user_input_blank block (the two blanks)');
  assert(result.blocks.some((b) => b.fieldType === 'instructional_paragraph'), 'Expected at least one instructional_paragraph block');

  // Confirm the "never rewrite" constraint held live, not just in the mocked guardrail
  // test — every returned span should be traceable back to the real source text.
  const normalizedSource = SAMPLE_BODY.toLowerCase().replace(/\s+/g, ' ');
  for (const block of result.blocks) {
    const normalizedText = block.text.toLowerCase().replace(/\s+/g, ' ');
    assert(normalizedSource.includes(normalizedText), `Block text was not found verbatim in the source (rewriting occurred): "${block.text}"`);
  }

  console.log(
    '\nSmoke test passed: the structure-extraction connector correctly classified a realistic mix of headings, instructional prose, checklist items, and fill-in blanks, with every returned span verified as real, unaltered source text — decision 1 is confirmed working live before any orchestration code trusts it.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
