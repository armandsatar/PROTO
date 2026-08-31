import { describe, it, expect } from 'vitest';
import {
  scoreToBucket,
  computeDemandCompetitionMultiplier,
  computeBasePrice,
  computeDepthAdjustment,
  roundTo99,
  computePlatformPrices,
  computeRecommendedPrice,
} from '../lib/pricing/formula';

describe('scoreToBucket', () => {
  it('returns green for scores ≥ 7', () => {
    expect(scoreToBucket(7)).toBe('green');
    expect(scoreToBucket(10)).toBe('green');
  });
  it('returns amber for scores 5–6', () => {
    expect(scoreToBucket(5)).toBe('amber');
    expect(scoreToBucket(6)).toBe('amber');
  });
  it('returns red for scores ≤ 4', () => {
    expect(scoreToBucket(4)).toBe('red');
    expect(scoreToBucket(1)).toBe('red');
  });
});

describe('computeDemandCompetitionMultiplier', () => {
  it('returns 1.3 for both green (premium territory)', () => {
    expect(computeDemandCompetitionMultiplier(8, 9)).toBe(1.3);
  });
  it('returns 0.7 for both red (competitive pressure)', () => {
    expect(computeDemandCompetitionMultiplier(2, 3)).toBe(0.7);
  });
  it('returns 1.0 for both amber (no adjustment)', () => {
    expect(computeDemandCompetitionMultiplier(5, 6)).toBe(1.0);
  });
  it('returns 1.1 for green demand + amber competition', () => {
    expect(computeDemandCompetitionMultiplier(8, 5)).toBe(1.1);
  });
  it('returns 0.9 for amber demand + red competition', () => {
    expect(computeDemandCompetitionMultiplier(5, 3)).toBe(0.9);
  });
  it('returns 1.0 for green demand + red competition (opposing forces cancel)', () => {
    expect(computeDemandCompetitionMultiplier(8, 3)).toBe(1.0);
  });
});

describe('computeBasePrice', () => {
  it('returns median of odd-count prices', () => {
    expect(computeBasePrice([5, 10, 15], 'tracker')).toBe(10);
  });
  it('returns average of two middle values for even-count prices', () => {
    expect(computeBasePrice([5, 10, 15, 20], 'tracker')).toBe(12.5);
  });
  it('handles single price', () => {
    expect(computeBasePrice([7.99], 'workbook')).toBe(7.99);
  });
  it('returns format-specific floor when no comparable prices', () => {
    expect(computeBasePrice([], 'tracker')).toBe(4.99);
    expect(computeBasePrice([], 'workbook')).toBe(6.99);
    expect(computeBasePrice([], 'ebook')).toBe(9.99);
    expect(computeBasePrice([], 'quiz')).toBe(3.99);
  });
  it('sorts before computing median (input order does not matter)', () => {
    expect(computeBasePrice([20, 5, 15, 10, 25], 'tracker')).toBe(15);
  });
});

describe('computeDepthAdjustment', () => {
  it('returns 0 for page counts ≤ 20', () => {
    expect(computeDepthAdjustment(20)).toBe(0);
    expect(computeDepthAdjustment(1)).toBe(0);
  });
  it('returns $1 for 30 pages (10 extra)', () => {
    expect(computeDepthAdjustment(30)).toBe(1);
  });
  it('returns $3 for 50 pages (30 extra)', () => {
    expect(computeDepthAdjustment(50)).toBe(3);
  });
  it('caps at $5 regardless of page count', () => {
    expect(computeDepthAdjustment(100)).toBe(5);
    expect(computeDepthAdjustment(200)).toBe(5);
  });
});

describe('roundTo99', () => {
  it('rounds $14.37 → $13.99', () => {
    expect(roundTo99(14.37)).toBe(13.99);
  });
  it('rounds $15.00 → $14.99', () => {
    expect(roundTo99(15.0)).toBe(14.99);
  });
  it('rounds $0.50 → $0.99 (minimum $0.99)', () => {
    expect(roundTo99(0.5)).toBe(0.99);
  });
  it('returns 0 for 0 or negative', () => {
    expect(roundTo99(0)).toBe(0);
    expect(roundTo99(-5)).toBe(0);
  });
  it('rounds $1.00 → $0.99', () => {
    expect(roundTo99(1.0)).toBe(0.99);
  });
  it('preserves $9.99 (already ends in .99)', () => {
    expect(roundTo99(9.99)).toBe(9.99);
  });
});

describe('computePlatformPrices', () => {
  it('applies platform multipliers and rounds each to .99', () => {
    const result = computePlatformPrices(14.99);
    expect(result).toHaveLength(4);

    const etsy = result.find((p) => p.platform === 'etsy')!;
    expect(etsy.multiplier).toBe(0.7);
    expect(etsy.suggestedPrice).toBe(roundTo99(14.99 * 0.7));

    const gumroad = result.find((p) => p.platform === 'gumroad')!;
    expect(gumroad.multiplier).toBe(1.0);
    expect(gumroad.suggestedPrice).toBe(14.99);

    const whop = result.find((p) => p.platform === 'whop')!;
    expect(whop.multiplier).toBe(1.2);
    expect(whop.suggestedPrice).toBe(roundTo99(14.99 * 1.2));
  });
});

describe('computeRecommendedPrice (full formula)', () => {
  it('produces a complete PricingFormulaResult', () => {
    const result = computeRecommendedPrice({
      comparablePrices: [8, 10, 12, 14, 16],
      demandScore: 8,
      competitionScore: 7,
      pageCount: 30,
      deliveryMode: 'fillable',
      format: 'tracker',
    });

    expect(result.basePrice).toBe(12);
    expect(result.comparableCount).toBe(5);
    expect(result.demandCompetitionMultiplier).toBe(1.3);
    // base 12 × 1.3 = 15.6; fillable premium = 15.6 × 0.15 = 2.34; depth = 1
    // total = 15.6 + 2.34 + 1 = 18.94 → roundTo99 = 17.99
    expect(result.recommendedPrice).toBe(17.99);
    expect(result.platformPrices).toHaveLength(4);
  });

  it('uses format floor when no comparable prices exist', () => {
    const result = computeRecommendedPrice({
      comparablePrices: [],
      demandScore: 5,
      competitionScore: 5,
      pageCount: 10,
      deliveryMode: 'printable',
      format: 'workbook',
    });

    expect(result.basePrice).toBe(6.99);
    expect(result.comparableCount).toBe(0);
    expect(result.demandCompetitionMultiplier).toBe(1.0);
    // 6.99 × 1.0 = 6.99, no depth, no fillable → already .99
    expect(result.recommendedPrice).toBe(6.99);
  });

  it('clamps to ceiling before rounding', () => {
    const result = computeRecommendedPrice({
      comparablePrices: [90, 95, 100, 105, 110],
      demandScore: 10,
      competitionScore: 10,
      pageCount: 200,
      deliveryMode: 'fillable',
      format: 'ebook',
    });

    expect(result.recommendedPrice).toBeLessThanOrEqual(99.99);
  });

  it('does not apply fillable premium for null delivery mode (ebook)', () => {
    const result = computeRecommendedPrice({
      comparablePrices: [10, 15, 20],
      demandScore: 5,
      competitionScore: 5,
      pageCount: 10,
      deliveryMode: null,
      format: 'ebook',
    });

    // base 15 × 1.0 = 15, no depth, no fillable → roundTo99 = 14.99
    expect(result.recommendedPrice).toBe(14.99);
  });
});
