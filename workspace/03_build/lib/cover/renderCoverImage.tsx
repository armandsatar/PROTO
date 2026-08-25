import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CoverLook } from './types';

// Real, open-source, OFL-licensed font files (Inter, Playfair Display — see the OFL.txt
// files in this directory), needed because Satori requires actual font binary data, not
// just a CSS font-family name string. Placeholder-template-only, same as templates.ts's
// 2 looks — Arman's real templates (decision 16) will bring their own font choices.
const FONT_DIR = path.join(__dirname, 'fonts');
const interData = fs.readFileSync(path.join(FONT_DIR, 'Inter.ttf'));
const playfairData = fs.readFileSync(path.join(FONT_DIR, 'PlayfairDisplay.ttf'));

const COVER_WIDTH = 1024;
const COVER_HEIGHT = 1365; // 3:4 aspect ratio, matching the Nano Banana 2 request in generateCoverCandidate.ts

// Both placeholder looks currently use Inter for body; only the "Editorial" look's
// heading uses Playfair Display. Registering both files unconditionally is simpler and
// harmless — Satori only uses the ones actually referenced by fontFamily in the JSX below.
const SATORI_FONTS = [
  { name: 'Inter', data: interData, weight: 400 as const, style: 'normal' as const },
  { name: 'Playfair Display', data: playfairData, weight: 700 as const, style: 'normal' as const },
];

export interface RenderCoverImageInput {
  look: CoverLook;
  title: string;
  /** Base64-encoded AI-generated background art (from generateCoverCandidate/generateCoverEdit). */
  artBase64: string;
  artMimeType: string;
}

/**
 * Composites the AI-generated art into a template layout (title text overlay, per
 * look's palette/font pairing) and rasterizes to a final PNG buffer — Satori converts
 * JSX+CSS to SVG (a flexbox layout engine, no headless browser), @resvg/resvg-js
 * rasterizes that SVG to PNG. First non-Supabase, non-AI dependency in this build;
 * verified live in this increment's own smoke test that it actually produces valid
 * image output in this stack, not assumed to just work from the library's own docs.
 */
export async function renderCoverImage(input: RenderCoverImageInput): Promise<Buffer> {
  const { look, title, artBase64, artMimeType } = input;

  const svg = await satori(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: look.palette.background,
        position: 'relative',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Satori rasterizes this
          JSX server-side into a PNG; it never touches a browser DOM, so Next's
          LCP/bandwidth optimization advice doesn't apply. */}
      <img
        src={`data:${artMimeType};base64,${artBase64}`}
        alt=""
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          padding: '48px 40px',
          backgroundColor: 'rgba(0, 0, 0, 0.45)',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontFamily: look.fontPairing.heading,
            fontWeight: 700,
            fontSize: 56,
            lineHeight: 1.15,
            color: '#FFFFFF',
          }}
        >
          {title}
        </div>
      </div>
    </div>,
    { width: COVER_WIDTH, height: COVER_HEIGHT, fonts: SATORI_FONTS },
  );

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: COVER_WIDTH } });
  const rendered = resvg.render();
  return rendered.asPng();
}
