import { describe, it, expect } from 'vitest';
import { renderFillablePdfDocument, countRealFormFields } from '../lib/export/renderFillablePdf';
import type { FieldStructureBlock } from '../lib/export/types';

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const sampleBlocks: FieldStructureBlock[] = [
  { fieldType: 'heading', text: 'Week 1 Check-In', order: 0 },
  { fieldType: 'instructional_paragraph', text: 'Review last week before logging anything new.', order: 1 },
  { fieldType: 'checklist_item', text: 'Logged every invoice sent this week', order: 2 },
  { fieldType: 'checklist_item', text: 'Logged every payment received this week', order: 3 },
  { fieldType: 'user_input_blank', text: "This week's total income:", order: 4 },
];

describe('renderFillablePdfDocument', () => {
  it('produces a real, valid PDF with the expected number of real interactive form fields', async () => {
    const { buffer, fieldCount } = await renderFillablePdfDocument({
      productTitle: 'Notion Budget Tracker for Freelancers',
      coverImageBytes: Buffer.from(TINY_PNG_BASE64, 'base64'),
      coverImageMimeType: 'image/png',
      subtopics: [{ title: 'Week 1', blocks: sampleBlocks }],
    });

    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    // 2 checklist_item + 1 user_input_blank = 3 real fields, heading/paragraph create none.
    expect(fieldCount).toBe(3);

    const realFieldCount = await countRealFormFields(buffer);
    expect(realFieldCount).toBe(3);
  });

  it('never creates a form field for heading or instructional_paragraph blocks', async () => {
    const { fieldCount } = await renderFillablePdfDocument({
      productTitle: 'T',
      coverImageBytes: Buffer.from(TINY_PNG_BASE64, 'base64'),
      coverImageMimeType: 'image/png',
      subtopics: [
        {
          title: 'S',
          blocks: [
            { fieldType: 'heading', text: 'A heading', order: 0 },
            { fieldType: 'instructional_paragraph', text: 'Just prose.', order: 1 },
          ],
        },
      ],
    });
    expect(fieldCount).toBe(0);
  });

  it('paginates correctly across many blocks without losing any real fields', async () => {
    const manyBlocks: FieldStructureBlock[] = Array.from({ length: 40 }, (_, i) => ({
      fieldType: 'checklist_item' as const,
      text: `Checklist item number ${i + 1}`,
      order: i,
    }));
    const { buffer, fieldCount } = await renderFillablePdfDocument({
      productTitle: 'Long Tracker',
      coverImageBytes: Buffer.from(TINY_PNG_BASE64, 'base64'),
      coverImageMimeType: 'image/png',
      subtopics: [{ title: 'Many Items', blocks: manyBlocks }],
    });
    expect(fieldCount).toBe(40);
    const realFieldCount = await countRealFormFields(buffer);
    expect(realFieldCount).toBe(40);
  });
});
