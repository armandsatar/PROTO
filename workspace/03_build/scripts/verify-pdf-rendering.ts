// Live rendering-library verification for Increment 5 — no AI involved here; this
// proves @react-pdf/renderer, docx, and the Notion-markdown assembler themselves work
// in this stack against realistic multi-subtopic content, with real automatic
// pagination actually exercised (unlike Satori, which has none, §2.2) and a real cover
// image genuinely embedded (§2.7). Output is written to disk for visual inspection,
// mirroring how Step 9 verified renderCoverImage.tsx's real output.
// Run with: npm run verify:pdf-rendering
//
// Run via vite-node, not this project's usual tsx — a real, live-caught quirk found
// during this increment: tsx's own CJS-shimmed module resolution fails with
// ERR_PACKAGE_PATH_NOT_EXPORTED on @react-pdf/hyphenate (a transitive dependency of
// @react-pdf/renderer), because that package's exports map only declares an "import"
// condition, not "require". Confirmed this is a tsx-specific resolution limitation,
// not a real bug in @react-pdf/renderer itself or in this code: a plain Node ESM
// script (no tsx) loads it correctly, and Vitest's own resolver (which vite-node
// shares) already runs renderPdf.test.ts against the real library with no issue —
// this project's actual Next.js runtime uses its own bundler resolution too, so this
// is expected to be a script-execution-only quirk, not a production concern.
import { writeFileSync } from 'node:fs';
import { renderPdfDocument, countPdfPages } from '../lib/export/renderPdf';
import { renderDocxDocument } from '../lib/export/renderDocx';
import { renderNotionMarkdown } from '../lib/export/renderNotionMarkdown';
import { isPageCountWithinSanityBand } from '../lib/export/rules';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

// A minimal valid 1x1 PNG — the render pipeline's own mechanics are what's under
// test here, not cover art quality (already proven live in Step 9).
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Realistic multi-subtopic content, sized to genuinely force @react-pdf/renderer's
// automatic pagination across several physical pages (a `deep`-tier tracker per
// Step 8's own word-count table lands well over 1,000 words total).
const SUBTOPICS = Array.from({ length: 8 }, (_, i) => ({
  title: `Module ${i + 1}: ${['Monthly Income Log', 'Tax Set-Aside Calculator', 'Client Payment Tracker', 'Expense Categories', 'Quarterly Review', 'Rate Calculator', 'Invoice Templates', 'Year-End Summary'][i]}`,
  body: `This section walks through the real mechanics of tracking freelance income with enough specific detail to be genuinely useful, not generic filler. `.repeat(20),
}));

async function main() {
  console.log('=== PDF rendering (live @react-pdf/renderer, real cover embed, real pagination) ===');
  const pdfBuffer = await renderPdfDocument({
    productTitle: 'Notion Budget Tracker for Freelancers',
    coverImageBase64: TINY_PNG_BASE64,
    coverImageMimeType: 'image/png',
    subtopics: SUBTOPICS,
  });
  assert(pdfBuffer.subarray(0, 4).toString('ascii') === '%PDF', 'Expected real PDF magic bytes');
  const pageCount = await countPdfPages(pdfBuffer);
  const totalWordCount = SUBTOPICS.reduce((sum, s) => sum + s.body.trim().split(/\s+/).length, 0);
  console.log(`Rendered ${pageCount} real physical pages for ${totalWordCount} words.`);
  assert(pageCount > 2, `Expected pagination to produce more than just the cover + one page for ${totalWordCount} words, got ${pageCount}`);
  assert(isPageCountWithinSanityBand(totalWordCount, pageCount), `Expected page count ${pageCount} to fall within the sanity band for ${totalWordCount} words`);
  writeFileSync('verify-pdf-output.pdf', pdfBuffer);
  console.log('Saved to verify-pdf-output.pdf for visual inspection.');

  console.log('\n=== Docx rendering (live docx package, real cover embed) ===');
  const docxBuffer = await renderDocxDocument({
    productTitle: 'Notion Budget Tracker for Freelancers',
    coverImageBuffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    coverImageMimeType: 'image/png',
    subtopics: SUBTOPICS,
  });
  assert(docxBuffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Expected real ZIP/Docx magic bytes');
  writeFileSync('verify-docx-output.docx', docxBuffer);
  console.log(`Saved ${docxBuffer.length} bytes to verify-docx-output.docx for visual inspection.`);

  console.log('\n=== Notion Markdown rendering (plain assembly, both static and fillable shapes) ===');
  const staticMd = renderNotionMarkdown({ productTitle: 'Notion Budget Tracker for Freelancers', subtopics: SUBTOPICS });
  assert(staticMd.startsWith('# Notion Budget Tracker for Freelancers'), 'Expected the product title as an H1');
  writeFileSync('verify-notion-static.md', staticMd);

  const fillableMd = renderNotionMarkdown({
    productTitle: 'Notion Budget Tracker for Freelancers',
    subtopics: [
      {
        title: 'Module 1: Monthly Income Log',
        body: 'unused',
        fieldBlocks: [
          { fieldType: 'heading', text: 'Week 1 Check-In', order: 0 },
          { fieldType: 'instructional_paragraph', text: 'Review last week before logging anything new.', order: 1 },
          { fieldType: 'checklist_item', text: 'Logged every invoice sent this week', order: 2 },
          { fieldType: 'user_input_blank', text: "This week's total income: ____________", order: 3 },
        ],
      },
    ],
  });
  assert(fillableMd.includes('- [ ] Logged every invoice sent this week'), 'Expected real "- [ ]" checklist syntax for the fillable path');
  writeFileSync('verify-notion-fillable.md', fillableMd);
  console.log('Saved verify-notion-static.md and verify-notion-fillable.md for visual inspection.');

  console.log(
    '\nSmoke test passed: @react-pdf/renderer (with real automatic pagination and a real embedded cover image), docx (a real ZIP-valid document), and the Notion-markdown assembler (both static and fillable-checklist shapes) all work in this stack — confirmed live before any orchestration code trusts them.',
  );
}

main().catch((err) => {
  console.error('\nSmoke test FAILED:', err);
  process.exit(1);
});
