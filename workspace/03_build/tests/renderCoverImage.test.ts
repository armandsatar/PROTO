import { describe, it, expect } from 'vitest';
import { renderCoverImage } from '../lib/cover/renderCoverImage';
import { COVER_LOOKS } from '../lib/cover/templates';

// A minimal valid 1x1 transparent PNG — deterministic, no network, no real Nano
// Banana content needed for verifying the render pipeline's own mechanics (this test
// exists to prove Satori + resvg produce valid output in this stack, not to judge art
// quality — that's the live smoke test's job, and ultimately Arman's via approval).
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// PNG file signature bytes — the first 8 bytes of any valid PNG.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('renderCoverImage', () => {
  it('produces a valid PNG buffer for each placeholder look (real font files, real fontFamily match)', async () => {
    for (const look of COVER_LOOKS) {
      const buffer = await renderCoverImage({
        look,
        title: 'Notion Budget Tracker for Freelancers',
        artBase64: TINY_PNG_BASE64,
        artMimeType: 'image/png',
      });
      expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);
      expect(buffer.length).toBeGreaterThan(1000);
    }
  });

  it('renders a longer title without throwing', async () => {
    const buffer = await renderCoverImage({
      look: COVER_LOOKS[0],
      title: 'A Genuinely Long Product Title That Might Wrap Across Multiple Lines In The Layout',
      artBase64: TINY_PNG_BASE64,
      artMimeType: 'image/png',
    });
    expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });
});
