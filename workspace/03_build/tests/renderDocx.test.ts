import { describe, it, expect } from 'vitest';
import { renderDocxDocument } from '../lib/export/renderDocx';

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('renderDocxDocument', () => {
  it('produces a real, valid Docx buffer (a ZIP container)', async () => {
    const buffer = await renderDocxDocument({
      productTitle: 'Notion Budget Tracker for Freelancers',
      coverImageBuffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
      coverImageMimeType: 'image/png',
      subtopics: [
        { title: 'Module 1: Monthly Income Log', body: 'Track every invoice by client and date.' },
        { title: 'Module 2: Tax Set-Aside Calculator', body: 'A formula-driven table for tax reserves.' },
      ],
    });

    // Docx files are ZIP archives — real ZIP magic bytes "PK\x03\x04".
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('handles a jpeg cover without throwing', async () => {
    const buffer = await renderDocxDocument({
      productTitle: 'JPEG Cover Product',
      coverImageBuffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
      coverImageMimeType: 'image/jpeg',
      subtopics: [{ title: 'Only Module', body: 'Some body text.' }],
    });
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
