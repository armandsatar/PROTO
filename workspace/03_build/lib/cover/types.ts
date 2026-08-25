export type CoverApprovalStatus = 'pending' | 'approved';
export type CoverTriggerScope = 'initial_candidate' | 'style_edit' | 'user_upload';
export type CoverGenerationStatus = 'succeeded' | 'failed_fallback' | 'failed_blocked';

// §7.5's code-level registry entry — a complete, non-mixable "look": layout + palette
// + font pairing bundled as one unit, never independently combinable (the anti-slop
// safeguard against incoherent combinations). `renderLayout` is deliberately absent
// here — the actual JSX/rendering construction lives in renderCoverImage.ts
// (increment 4, where Satori is wired up and tested together), not in this
// deterministic-layer type. This file only describes the data a look carries.
export interface CoverLook {
  id: string;
  name: string;
  palette: {
    background: string;
    accent: string;
    text: string;
  };
  fontPairing: {
    heading: string;
    body: string;
  };
}

// Real token-usage numbers from a Gemini response's own `usage` field — the basis for
// computeCostUsd (rules.ts), confirmed live per phase7-requirements.md §3.2/§4.1.
export interface GeminiUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
}

// Unvalidated shapes as they come back from the Gemini Interactions API — deliberately
// loose here; the generation-call modules (increment 3) are what actually validate these.
export interface RawInteractionResponse {
  id?: unknown;
  status?: unknown;
  usage?: unknown;
  output_image?: unknown;
}
