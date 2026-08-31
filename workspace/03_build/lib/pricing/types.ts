import type { FormatType, DeliveryMode } from '../format/types';

export type { FormatType, DeliveryMode };

export type PricingSupersedeReason =
  | 'title_changed'
  | 'format_changed'
  | 'export_changed'
  | 'user_requested_reconsider'
  | 'user_requested_change';

// Only the 4 storefront platforms — not pinterest/instagram/narrative (those have
// no pricing dimension). Reuses copy_platform enum values from migration 0008.
export type PricingPlatform = 'etsy' | 'gumroad' | 'stanstore' | 'whop';

export const PRICING_PLATFORMS: readonly PricingPlatform[] = ['etsy', 'gumroad', 'stanstore', 'whop'];

// Decision 2: per-platform multipliers reflecting real market-context differences
// (phase10-requirements.md §4.2).
export const PLATFORM_MULTIPLIERS: Record<PricingPlatform, number> = {
  etsy: 0.7,
  gumroad: 1.0,
  stanstore: 1.0,
  whop: 1.2,
};

// Decision 4: format-specific default price floors when no comparable Etsy data exists.
export const FORMAT_PRICE_FLOORS: Record<FormatType, number> = {
  tracker: 4.99,
  workbook: 6.99,
  ebook: 9.99,
  quiz: 3.99,
};

// Decision 5: hard ceiling for formula output. User can override to any price.
export const PRICE_CEILING = 99.99;

// Decision 9: reconsider cap, matching Steps 4/5.
export const RECONSIDER_CAP = 5;

// Decision 3: demand/competition multiplier lookup (§4.2).
// Green = score ≥ 7, Amber = 5–6, Red = ≤ 4 (same buckets as scoring/colors.ts).
export type ScoreBucket = 'green' | 'amber' | 'red';

export interface PlatformPriceSuggestion {
  platform: PricingPlatform;
  multiplier: number;
  suggestedPrice: number;
}

export interface PricingFormulaResult {
  recommendedPrice: number;
  basePrice: number;
  comparableCount: number;
  demandCompetitionMultiplier: number;
  depthAdjustment: number;
  platformPrices: PlatformPriceSuggestion[];
}

// Signal sources for reasoning — same pattern as Steps 4/5 but with pricing-specific sources.
export type PricingSignalSource =
  | 'comparable_prices'
  | 'demand_score'
  | 'competition_score'
  | 'page_count'
  | 'delivery_mode'
  | 'format';

export interface PricingReasoningSignal {
  source: PricingSignalSource;
  detail: string;
}

export interface PricingReasoningResult {
  reasoningSummary: string;
  reasoningSignals: PricingReasoningSignal[];
}

// Unvalidated shape from AI — deliberately `unknown` throughout;
// guardrail.ts validates this into a trustworthy PricingReasoningResult.
export interface RawPricingReasoningResponse {
  reasoning_summary: unknown;
  reasoning_signals: unknown;
}
