// Live end-to-end spike for §2.3's geometry-bridging problem — the single most
// consequential unverified technical claim in phase9-requirements.md. Chains the real
// structure-extraction connector (Increment 4, live Groq) directly into the fillable
// PDF renderer (Increment 6): real classification -> real interactive AcroForm fields
// at real coordinates, in one run, against realistic multi-subtopic tracker content.
//
// Resolution decided here, live: rather than extracting computed layout geometry from
// @react-pdf/renderer and translating it into pdf-lib coordinates (the bridging step
// no library in this ecosystem solves, per the locked doc's own research), fillable
// PDFs are laid out directly in pdf-lib — one coordinate system throughout, so there is
// no geometry to bridge. The disclosed fallback (a static, non-interactive PDF for
// fillable products) is NOT needed if this script passes.
//
// Run with: npm run verify:fillable-pdf. This script only touches pdf-lib and the
// structure-extraction connector, not @react-pdf/renderer — so it does NOT hit
// Increment 5's tsx/@react-pdf-hyphenate resolution quirk and can run via this
// project's normal tsx convention.
import { writeFileSync } from 'node:fs';
import { generateFieldStructurePass } from '../lib/export/generateFieldStructure';
import { renderFillablePdfDocument, countRealFormFields } from '../lib/export/renderFillablePdf';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Two realistic tracker subtopics, each with a genuine mix of headings, prose,
// checklists, and fill-in blanks — the same mix Increment 4's own connector spike
// proved it can classify correctly.
const SUBTOPICS = [
  {
    title: 'Week 1: Income Check-In',
    body: `Week 1: Income Check-In

Before you log anything this week, take a moment to review last week's total. This section only takes two minutes but it's the habit that makes the rest of the tracker actually work.

- Logged every invoice sent this week
- Logged every payment received this week
- Reviewed the running 3-month average

This week's total income: ____________

Notes on anything unusual this week: ____________`,
  },
  {
    title: 'Week 2: Tax Set-Aside',
    body: `Week 2: Tax Set-Aside

Apply your own effective tax rate to this week's income to figure out what to set aside. Most freelancers use somewhere between 25% and 30% as a starting point.

- Calculated this week's set-aside amount
- Transferred the set-aside amount to a separate account
- Logged the transfer date

Amount set aside this week: ____________`,
  },
];

async function main() {
  console.log('=== Structure-extraction pass (live Groq) for both subtopics ===');
  const extracted = [];
  for (const subtopic of SUBTOPICS) {
    const result = await generateFieldStructurePass({ subtopicTitle: subtopic.title, body: subtopic.body, confirmedFormat: 'tracker' });
    console.log(`  "${subtopic.title}": ${result.blocks.length} blocks extracted`);
    extracted.push({ title: subtopic.title, blocks: result.blocks });
  }

  const totalChecklistAndBlanks = extracted.reduce((sum, s) => sum + s.blocks.filter((b) => b.fieldType === 'checklist_item' || b.fieldType === 'user_input_blank').length, 0);
  assert(totalChecklistAndBlanks >= 6, `Expected at least 6 fillable blocks across both subtopics (3 checklist + 1 blank each), got ${totalChecklistAndBlanks}`);

  console.log('\n=== Fillable PDF rendering (pdf-lib, one coordinate system, no cross-library bridging) ===');
  const { buffer, fieldCount } = await renderFillablePdfDocument({
    productTitle: 'Notion Budget Tracker for Freelancers',
    coverImageBytes: Buffer.from(TINY_PNG_BASE64, 'base64'),
    coverImageMimeType: 'image/png',
    subtopics: extracted,
  });

  assert(buffer.subarray(0, 4).toString('ascii') === '%PDF', 'Expected real PDF magic bytes');
  assert(fieldCount === totalChecklistAndBlanks, `Expected the renderer to create exactly ${totalChecklistAndBlanks} fields, got ${fieldCount}`);

  const realFieldCount = await countRealFormFields(buffer);
  assert(realFieldCount === fieldCount, `Expected ${fieldCount} real AcroForm fields when the saved file is reloaded, got ${realFieldCount}`);

  writeFileSync('verify-fillable-pdf-output.pdf', buffer);
  console.log(`\nRendered a real PDF with ${realFieldCount} real, interactive AcroForm fields (checkboxes + text inputs). Saved to verify-fillable-pdf-output.pdf for visual inspection.`);

  console.log(
    '\nSmoke test passed: the geometry-bridging problem is resolved by not bridging at all — pdf-lib computes and consumes its own layout coordinates in one pass, chained directly from a real live structure-extraction call. The disclosed static-PDF fallback for fillable products is not needed.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
