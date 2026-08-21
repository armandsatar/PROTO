import { describe, it, expect } from 'vitest';
import {
  RECONSIDER_CAP,
  hasReachedReconsiderCap,
  isRecommendationStale,
  assertValidConfirmation,
  computeIsOverride,
} from '../lib/format/rules';

describe('hasReachedReconsiderCap (decision 8: cap of 5)', () => {
  it('is false below the cap', () => {
    expect(hasReachedReconsiderCap(0)).toBe(false);
    expect(hasReachedReconsiderCap(4)).toBe(false);
  });

  it('is true at and above the cap', () => {
    expect(hasReachedReconsiderCap(RECONSIDER_CAP)).toBe(true);
    expect(hasReachedReconsiderCap(RECONSIDER_CAP + 1)).toBe(true);
  });
});

describe('isRecommendationStale (§1.6 lazy staleness detection)', () => {
  it('is not stale when the title candidate ids match', () => {
    expect(isRecommendationStale('candidate-1', 'candidate-1')).toBe(false);
  });

  it('is stale when the project has selected a different candidate since', () => {
    expect(isRecommendationStale('candidate-1', 'candidate-2')).toBe(true);
  });

  it('is stale when the project has no selected candidate at all (title unlocked)', () => {
    expect(isRecommendationStale('candidate-1', null)).toBe(true);
  });
});

describe('assertValidConfirmation (§1.4 hard business rule)', () => {
  it('accepts ebook with a null delivery mode', () => {
    expect(() => assertValidConfirmation('ebook', null)).not.toThrow();
  });

  it('rejects ebook with a non-null delivery mode', () => {
    expect(() => assertValidConfirmation('ebook', 'printable')).toThrow(/ebook cannot have a delivery mode/);
  });

  it('accepts a non-ebook format with a delivery mode', () => {
    expect(() => assertValidConfirmation('tracker', 'fillable')).not.toThrow();
    expect(() => assertValidConfirmation('workbook', 'printable')).not.toThrow();
    expect(() => assertValidConfirmation('quiz', 'fillable')).not.toThrow();
  });

  it('rejects a non-ebook format with a null delivery mode', () => {
    expect(() => assertValidConfirmation('tracker', null)).toThrow(/required for format "tracker"/);
  });
});

describe('computeIsOverride (§3.2)', () => {
  it('is false when confirmed matches recommended exactly', () => {
    const recommended = { format: 'workbook' as const, deliveryMode: 'fillable' as const };
    expect(computeIsOverride(recommended, { format: 'workbook', deliveryMode: 'fillable' })).toBe(false);
  });

  it('is true when the format differs', () => {
    const recommended = { format: 'workbook' as const, deliveryMode: 'fillable' as const };
    expect(computeIsOverride(recommended, { format: 'tracker', deliveryMode: 'fillable' })).toBe(true);
  });

  it('is true when only the delivery mode differs', () => {
    const recommended = { format: 'workbook' as const, deliveryMode: 'fillable' as const };
    expect(computeIsOverride(recommended, { format: 'workbook', deliveryMode: 'printable' })).toBe(true);
  });

  it('is true when both differ', () => {
    const recommended = { format: 'workbook' as const, deliveryMode: 'fillable' as const };
    expect(computeIsOverride(recommended, { format: 'ebook', deliveryMode: null })).toBe(true);
  });

  it('is false for two ebook recommendations both with null delivery mode', () => {
    const recommended = { format: 'ebook' as const, deliveryMode: null };
    expect(computeIsOverride(recommended, { format: 'ebook', deliveryMode: null })).toBe(false);
  });
});
