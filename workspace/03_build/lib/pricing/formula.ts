import type { FormatType, DeliveryMode, PricingPlatform, PlatformPriceSuggestion, PricingFormulaResult, ScoreBucket } from './types';
import { FORMAT_PRICE_FLOORS, PLATFORM_MULTIPLIERS, PRICING_PLATFORMS, PRICE_CEILING } from './types';

/**
 * Score → bucket conversion. Same thresholds as scoring/colors.ts (green ≥ 7,
 * amber 5–6, red ≤ 4), but returns the bucket label for multiplier lookup.
 */
export function scoreToBucket(score: number): ScoreBucket {
  if (score >= 7) return 'green';
  if (score >= 5) return 'amber';
  return 'red';
}

/**
 * Decision 3: demand/competition multiplier (§4.2). The two scores are bucketed
 * independently, then the pair maps to a multiplier. Both-green is the premium
 * case (high demand + low competition = white space); both-red is the competitive-
 * pressure case.
 */
const MULTIPLIER_TABLE: Record<`${ScoreBucket}_${ScoreBucket}`, number> = {
  green_green: 1.3,
  green_amber: 1.1,
  green_red: 1.0,
  amber_green: 1.1,
  amber_amber: 1.0,
  amber_red: 0.9,
  red_green: 1.0,
  red_amber: 0.9,
  red_red: 0.7,
};

export function computeDemandCompetitionMultiplier(demandScore: number, competitionScore: number): number {
  const demandBucket = scoreToBucket(demandScore);
  const competitionBucket = scoreToBucket(competitionScore);
  return MULTIPLIER_TABLE[`${demandBucket}_${competitionBucket}`];
}

/**
 * Base price: median of comparable Etsy listing prices from Step 2's research.
 * Falls back to a format-specific floor if no comparable data exists.
 */
export function computeBasePrice(comparablePrices: number[], format: FormatType): number {
  if (comparablePrices.length === 0) {
    return FORMAT_PRICE_FLOORS[format];
  }
  const sorted = [...comparablePrices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Depth adjustment: page count + fillable premium (§4.2).
 * +$1 per 10 additional pages over 20, capped at +$5.
 * +15% fillable premium (applied to the base × multiplier, not to this adjustment).
 */
export function computeDepthAdjustment(pageCount: number): number {
  if (pageCount <= 20) return 0;
  const extraPages = pageCount - 20;
  const adjustment = Math.floor(extraPages / 10);
  return Math.min(adjustment, 5);
}

/**
 * Decision 10: round to nearest .99 ending at or below the input price.
 * $0 stays $0. Otherwise find the largest X.99 ≤ price.
 * E.g. $14.37 → $13.99, $15.00 → $14.99, $14.99 → $14.99, $0.50 → $0.99.
 */
export function roundTo99(price: number): number {
  if (price <= 0) return 0;
  if (price < 0.99) return 0.99;
  // If price is already X.99 (within floating-point tolerance), keep it
  const cents = Math.round(price * 100);
  if (cents % 100 === 99) return price;
  // Otherwise, find the largest X.99 ≤ price
  return Math.floor(price) - 0.01;
}

/**
 * Compute per-platform suggested prices from the base recommended price.
 */
export function computePlatformPrices(recommendedPrice: number): PlatformPriceSuggestion[] {
  return PRICING_PLATFORMS.map((platform) => {
    const multiplier = PLATFORM_MULTIPLIERS[platform];
    const raw = recommendedPrice * multiplier;
    return {
      platform,
      multiplier,
      suggestedPrice: roundTo99(raw),
    };
  });
}

export interface ComputePricingInput {
  comparablePrices: number[];
  demandScore: number;
  competitionScore: number;
  pageCount: number;
  deliveryMode: DeliveryMode | null;
  format: FormatType;
}

/**
 * The full pricing formula (§4.2). Deterministic — no AI involved.
 *
 * recommended_price = round99(clamp(base × multiplier + depth_adjustment + fillable_premium, ceiling))
 *
 * The fillable premium is applied as +15% of (base × multiplier), not of the depth adjustment.
 */
export function computeRecommendedPrice(input: ComputePricingInput): PricingFormulaResult {
  const basePrice = computeBasePrice(input.comparablePrices, input.format);
  const multiplier = computeDemandCompetitionMultiplier(input.demandScore, input.competitionScore);
  const depthAdj = computeDepthAdjustment(input.pageCount);

  let adjusted = basePrice * multiplier;
  const fillablePremium = input.deliveryMode === 'fillable' ? adjusted * 0.15 : 0;
  adjusted = adjusted + depthAdj + fillablePremium;

  // Decision 5: clamp to ceiling before rounding
  const clamped = Math.min(adjusted, PRICE_CEILING);
  const recommendedPrice = roundTo99(clamped);

  const platformPrices = computePlatformPrices(recommendedPrice);

  return {
    recommendedPrice,
    basePrice: Math.round(basePrice * 100) / 100,
    comparableCount: input.comparablePrices.length,
    demandCompetitionMultiplier: multiplier,
    depthAdjustment: Math.round((depthAdj + fillablePremium) * 100) / 100,
    platformPrices,
  };
}
