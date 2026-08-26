import type { RealCopyPlatform } from './types';

export interface PlatformHardLimits {
  titleMaxChars?: number;
  bodyMaxChars?: number;
  tagMaxCount?: number;
  tagMaxCharsEach?: number;
}

export interface PlatformSoftTargets {
  titleMaxChars?: number;
  bodyMaxChars?: number;
}

export interface PlatformSpec {
  id: RealCopyPlatform;
  label: string;
  hasTitle: boolean;
  hasTags: boolean;
  /** Which keys of PlatformFields this platform actually uses. */
  platformFieldKeys: readonly string[];
  /**
   * `undefined` means no hard ceiling is enforced for this platform at all (decision 5,
   * StanStore/Whop deferred pending Arman's own account verification) — the hard-limit
   * check trivially passes when this is undefined, not an empty/zero limit.
   */
  hardLimits: PlatformHardLimits | undefined;
  softTargets: PlatformSoftTargets;
  /** Content-type/tone guidance for the adaptation writer prompt — §2.7's own framing. */
  adaptationGuidance: string;
}

// §2.7's confirmed summary table. StanStore/Whop intentionally carry `hardLimits:
// undefined` — decision 5 stays deferred until Arman verifies real account behavior;
// this is not a placeholder to fill in later, it's the correct value until that happens.
export const PLATFORM_REGISTRY: Record<RealCopyPlatform, PlatformSpec> = {
  etsy: {
    id: 'etsy',
    label: 'Etsy',
    hasTitle: true,
    hasTags: true,
    platformFieldKeys: ['tags'],
    hardLimits: { titleMaxChars: 140, tagMaxCount: 13, tagMaxCharsEach: 20 },
    softTargets: { titleMaxChars: 50 },
    adaptationGuidance:
      'Etsy listing copy: a title (max 140 chars, front-load the most important keywords in the first ~50 chars since search results truncate there), a long-form description, and up to 13 tags (max 20 chars each, single words or short phrases, no hashtags).',
  },
  gumroad: {
    id: 'gumroad',
    label: 'Gumroad',
    hasTitle: true,
    hasTags: false,
    platformFieldKeys: [],
    hardLimits: undefined,
    softTargets: {},
    adaptationGuidance:
      'Gumroad listing copy: a title and a description. No confirmed character limit either way. Write in clean, scannable, short-paragraph prose — do not rely on literal Markdown syntax (**bold**, # heading) rendering, since that is unconfirmed (decision 6); use plain line breaks and short paragraphs instead.',
  },
  stanstore: {
    id: 'stanstore',
    label: 'Stan Store',
    hasTitle: true,
    hasTags: false,
    platformFieldKeys: ['subtitle', 'buttonText'],
    hardLimits: undefined,
    softTargets: {},
    adaptationGuidance:
      'Stan Store listing copy: a title, a short subtitle, a description, and button text (defaults to "Download now" if not specified). No confirmed character limits (decision 5) — write concisely regardless, since this platform is optimized for short, scannable product pages.',
  },
  whop: {
    id: 'whop',
    label: 'Whop',
    hasTitle: true,
    hasTags: false,
    platformFieldKeys: ['headline'],
    hardLimits: undefined,
    softTargets: {},
    adaptationGuidance:
      'Whop marketplace listing copy: a product name, a headline, and a description. No confirmed character limits (decision 5) — write concisely regardless.',
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest',
    hasTitle: true,
    hasTags: false,
    platformFieldKeys: [],
    hardLimits: { titleMaxChars: 100, bodyMaxChars: 500 },
    softTargets: { titleMaxChars: 60, bodyMaxChars: 260 },
    adaptationGuidance:
      'Pinterest pin copy: a title (max 100 chars, aim for 40-60) and a description (max 500 chars, aim for ~220-260, front-load keywords in the first ~50-60 chars before the truncation point).',
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    hasTitle: false,
    hasTags: false,
    platformFieldKeys: [],
    hardLimits: { bodyMaxChars: 2200 },
    softTargets: { bodyMaxChars: 800 },
    adaptationGuidance:
      'Instagram caption copy: a caption only, no title (max 2,200 chars, but feed captions truncate at ~125 chars before a "...more" cutoff — put the strongest hook in the first ~125 chars, then continue for those who tap through). Aim for 125-800 chars total for promotional copy.',
  },
};

export function getPlatformSpec(platform: RealCopyPlatform): PlatformSpec {
  return PLATFORM_REGISTRY[platform];
}
