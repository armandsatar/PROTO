import type { RawLeadMagnetRecommendation } from './types';

/**
 * AI-call-failure fallback. Build plan's flagged gap: phase3-requirements.md's
 * generation_status enum implies a fallback path exists (reused from Step 4's
 * 'failed_fallback' value), but the doc never defines what it recommends — unlike
 * Phase 2's decision 1, which had an explicit keyword table. Proposed engineering
 * default: always fall back to "not suitable," the conservative choice — guessing "no"
 * wrong just costs the user one manual override to yes; guessing "yes" wrong risks
 * them building a lead magnet nobody asked for. No keyword table needed here, unlike
 * Step 4's fallback, because there's no type to guess at when the safe answer is
 * always "no."
 */
export function fallbackLeadMagnetRecommendation(): RawLeadMagnetRecommendation {
  return {
    recommended_suitable: false,
    recommended_type: null,
    confidence: 'low',
    reasoning_summary:
      'The AI suitability check was unavailable, so no lead magnet is suggested by default. Please review and override if you believe one would help this product.',
    reasoning_signals: [],
    alternate_type_considered: null,
  };
}
