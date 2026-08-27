import { describe, it, expect } from 'vitest';
import { renderPdfDocument, countPdfPages } from '../lib/export/renderPdf';

// A minimal valid 1x1 PNG — deterministic, no network, proves the render pipeline's
// own mechanics without needing a real cover asset (mirrors renderCoverImage.test.ts's
// identical fixture from Step 9).
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('renderPdfDocument', () => {
  it('produces a real, valid PDF buffer with a real page count', async () => {
    const buffer = await renderPdfDocument({
      productTitle: 'Notion Budget Tracker for Freelancers',
      coverImageBase64: TINY_PNG_BASE64,
      coverImageMimeType: 'image/png',
      subtopics: [
        { title: 'Module 1: Monthly Income Log', body: 'Track every invoice by client and date.' },
        { title: 'Module 2: Tax Set-Aside Calculator', body: 'A formula-driven table for tax reserves.' },
      ],
    });

    // Real PDF magic bytes — %PDF
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');

    const pageCount = await countPdfPages(buffer);
    expect(pageCount).toBeGreaterThanOrEqual(2); // at least the cover page + one content page
  });

  it('handles an empty subtopics list without throwing (still produces the cover page)', async () => {
    const buffer = await renderPdfDocument({
      productTitle: 'Empty Product',
      coverImageBase64: TINY_PNG_BASE64,
      coverImageMimeType: 'image/png',
      subtopics: [],
    });
    const pageCount = await countPdfPages(buffer);
    expect(pageCount).toBeGreaterThanOrEqual(1);
  });
});
