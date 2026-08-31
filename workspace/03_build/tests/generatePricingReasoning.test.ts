import { describe, it, expect, vi } from 'vitest';
import { fallbackPricingReasoning } from '../lib/pricing/generatePricingReasoning';
import type { GeneratePricingReasoningInput } from '../lib/pricing/generatePricingReasoning';

const BASE_INPUT: GeneratePricingReasoningInput = {
  recommendedPrice: 14.99,
  basePrice: 10.0,
  comparableCount: 8,
  demandCompetitionMultiplier: 1.3,
  depthAdjustment: 2.34,
  platformPrices: [
    { platform: 'etsy', multiplier: 0.7, suggestedPrice: 9.99 },
    { platform: 'gumroad', multiplier: 1.0, suggestedPrice: 14.99 },
    { platform: 'stanstore', multiplier: 1.0, suggestedPrice: 14.99 },
    { platform: 'whop', multiplier: 1.2, suggestedPrice: 17.99 },
  ],
  demandScore: 8,
  competitionScore: 7,
  pageCount: 24,
  deliveryMode: 'fillable',
  format: 'tracker',
  title: 'Notion Budget Tracker for Freelancers',
};

describe('fallbackPricingReasoning', () => {
  it('produces a valid reasoning result with comparable data', () => {
    const result = fallbackPricingReasoning(BASE_INPUT);
    expect(result.reasoningSummary).toContain('$14.99');
    expect(result.reasoningSummary).toContain('$10.00');
    expect(result.reasoningSummary).toContain('8 comparable');
    expect(result.reasoningSummary).toContain('demand (8/10)');
    expect(result.reasoningSummary).toContain('competition (7/10)');
    expect(result.reasoningSignals).toHaveLength(3);
    expect(result.reasoningSignals[0].source).toBe('comparable_prices');
    expect(result.reasoningSignals[1].source).toBe('demand_score');
    expect(result.reasoningSignals[2].source).toBe('competition_score');
  });

  it('adjusts summary when no comparable data exists', () => {
    const input: GeneratePricingReasoningInput = {
      ...BASE_INPUT,
      basePrice: 4.99,
      comparableCount: 0,
    };
    const result = fallbackPricingReasoning(input);
    expect(result.reasoningSummary).toContain('format floor');
    expect(result.reasoningSummary).toContain('no comparable Etsy data');
    expect(result.reasoningSignals[0].detail).toContain('No comparable Etsy data');
  });

  it('includes per-platform prices in the summary', () => {
    const result = fallbackPricingReasoning(BASE_INPUT);
    expect(result.reasoningSummary).toContain('$9.99 on etsy');
    expect(result.reasoningSummary).toContain('$17.99 on whop');
  });

  it('describes demand level correctly for each bucket', () => {
    const high = fallbackPricingReasoning({ ...BASE_INPUT, demandScore: 8 });
    expect(high.reasoningSignals[1].detail).toContain('strong');

    const mid = fallbackPricingReasoning({ ...BASE_INPUT, demandScore: 5 });
    expect(mid.reasoningSignals[1].detail).toContain('moderate');

    const low = fallbackPricingReasoning({ ...BASE_INPUT, demandScore: 3 });
    expect(low.reasoningSignals[1].detail).toContain('limited');
  });

  it('describes competition level correctly for each bucket', () => {
    const low = fallbackPricingReasoning({ ...BASE_INPUT, competitionScore: 8 });
    expect(low.reasoningSignals[2].detail).toContain('limited');

    const mid = fallbackPricingReasoning({ ...BASE_INPUT, competitionScore: 5 });
    expect(mid.reasoningSignals[2].detail).toContain('moderate');

    const crowded = fallbackPricingReasoning({ ...BASE_INPUT, competitionScore: 3 });
    expect(crowded.reasoningSignals[2].detail).toContain('crowded');
  });

  it('handles singular comparable count', () => {
    const input: GeneratePricingReasoningInput = {
      ...BASE_INPUT,
      comparableCount: 1,
    };
    const result = fallbackPricingReasoning(input);
    expect(result.reasoningSummary).toContain('1 comparable Etsy listing,');
    expect(result.reasoningSummary).not.toContain('listings,');
  });
});
