import type { CoverLook } from './types';

/**
 * §7.5's code-level look registry. **These 2 entries are explicitly placeholder
 * scaffolding, not real designs** — decision 16 confirms Arman will design the real
 * 4-8 templates himself once the build reaches that stage. These exist only so
 * renderCoverImage.ts (increment 4) has something concrete to prove the rendering
 * pipeline against, the same "labeled placeholder, not fabricated content" posture
 * Step 6's original fallback scaffold used. Renamed/replaced wholesale later — nothing
 * downstream should assume these ids are permanent.
 */
export const COVER_LOOKS: readonly CoverLook[] = [
  {
    id: 'placeholder-editorial-01',
    name: 'Placeholder — Editorial (scaffold, not a final design)',
    palette: {
      background: '#F5F1E8',
      accent: '#1B2A4A',
      text: '#1B2A4A',
    },
    fontPairing: {
      heading: 'Georgia, serif',
      body: 'Helvetica, Arial, sans-serif',
    },
  },
  {
    id: 'placeholder-bold-01',
    name: 'Placeholder — Bold Contrast (scaffold, not a final design)',
    palette: {
      background: '#14161A',
      accent: '#F2C94C',
      text: '#FFFFFF',
    },
    fontPairing: {
      heading: 'Helvetica, Arial, sans-serif',
      body: 'Helvetica, Arial, sans-serif',
    },
  },
];

export function getLookById(id: string): CoverLook | undefined {
  return COVER_LOOKS.find((look) => look.id === id);
}

export function isValidLookId(id: string): boolean {
  return getLookById(id) !== undefined;
}

// The default recommended look until real format/tone-based recommendation logic
// exists — every project starts here, same "one deterministic default" posture as
// every prior phase's initial-state field.
export const DEFAULT_LOOK_ID = COVER_LOOKS[0].id;
