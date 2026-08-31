import { describe, it, expect } from 'vitest';
import { isPricingStale, hasReachedReconsiderCap, computeIsOverride, computePlatformIsOverride, RECONSIDER_CAP } from '../lib/pricing/rules';

describe('isPricingStale', () => {
  const baseSnapshot = {
    titleCandidateId: 'title-1',
    formatRecommendationId: 'format-1',
    exportPageCountSnapshot: 24,
  };

  it('returns not stale when all match', () => {
    const result = isPricingStale(baseSnapshot, {
      selectedCandidateId: 'title-1',
      currentFormatRecommendationId: 'format-1',
      currentExportPageCount: 24,
    });
    expect(result.isStale).toBe(false);
    expect(result.staleReason).toBeNull();
  });

  it('detects title change (highest precedence)', () => {
    const result = isPricingStale(baseSnapshot, {
      selectedCandidateId: 'title-2',
      currentFormatRecommendationId: 'format-2', // also changed, but title takes precedence
      currentExportPageCount: 30,
    });
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toBe('title_changed');
  });

  it('detects format change when title matches', () => {
    const result = isPricingStale(baseSnapshot, {
      selectedCandidateId: 'title-1',
      currentFormatRecommendationId: 'format-2',
      currentExportPageCount: 24,
    });
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toBe('format_changed');
  });

  it('detects export page count change when title and format match', () => {
    const result = isPricingStale(baseSnapshot, {
      selectedCandidateId: 'title-1',
      currentFormatRecommendationId: 'format-1',
      currentExportPageCount: 30,
    });
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toBe('export_changed');
  });

  it('is not stale when currentExportPageCount is null (no approved export yet)', () => {
    const result = isPricingStale(baseSnapshot, {
      selectedCandidateId: 'title-1',
      currentFormatRecommendationId: 'format-1',
      currentExportPageCount: null,
    });
    expect(result.isStale).toBe(false);
  });

  it('detects title staleness even when selectedCandidateId is null', () => {
    const result = isPricingStale(baseSnapshot, {
      selectedCandidateId: null,
      currentFormatRecommendationId: 'format-1',
      currentExportPageCount: 24,
    });
    expect(result.isStale).toBe(true);
    expect(result.staleReason).toBe('title_changed');
  });
});

describe('hasReachedReconsiderCap', () => {
  it('returns false below cap', () => {
    expect(hasReachedReconsiderCap(0)).toBe(false);
    expect(hasReachedReconsiderCap(RECONSIDER_CAP - 1)).toBe(false);
  });
  it('returns true at cap', () => {
    expect(hasReachedReconsiderCap(RECONSIDER_CAP)).toBe(true);
  });
  it('returns true above cap', () => {
    expect(hasReachedReconsiderCap(RECONSIDER_CAP + 1)).toBe(true);
  });
});

describe('computeIsOverride', () => {
  it('returns false when prices match', () => {
    expect(computeIsOverride(14.99, 14.99)).toBe(false);
  });
  it('returns true when prices differ', () => {
    expect(computeIsOverride(14.99, 9.99)).toBe(true);
  });
});

describe('computePlatformIsOverride', () => {
  it('returns false when prices match', () => {
    expect(computePlatformIsOverride(9.99, 9.99)).toBe(false);
  });
  it('returns true when prices differ', () => {
    expect(computePlatformIsOverride(9.99, 12.99)).toBe(true);
  });
});
