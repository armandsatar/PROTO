import { describe, it, expect } from 'vitest';
import {
  RECONSIDER_CAP,
  hasReachedReconsiderCap,
  detectStalenessReason,
  assertValidConfirmation,
  computeIsOverride,
} from '../lib/leadmagnet/rules';

describe('hasReachedReconsiderCap (decision 11: cap of 5, own copy from Step 4)', () => {
  it('is false below the cap, true at and above it', () => {
    expect(hasReachedReconsiderCap(0)).toBe(false);
    expect(hasReachedReconsiderCap(4)).toBe(false);
    expect(hasReachedReconsiderCap(RECONSIDER_CAP)).toBe(true);
    expect(hasReachedReconsiderCap(RECONSIDER_CAP + 1)).toBe(true);
  });
});

describe('detectStalenessReason (§1.6 dual staleness — decision 13)', () => {
  const rec = { titleCandidateId: 'title-1', formatRecommendationId: 'format-1' };

  it('is not stale when both ids match current state', () => {
    expect(detectStalenessReason(rec, { selectedCandidateId: 'title-1', currentFormatRecommendationId: 'format-1' })).toBeNull();
  });

  it('reports title_changed when only the title diverges', () => {
    expect(
      detectStalenessReason(rec, { selectedCandidateId: 'title-2', currentFormatRecommendationId: 'format-1' }),
    ).toBe('title_changed');
  });

  it('reports format_changed when only the confirmed format diverges (title unchanged)', () => {
    expect(
      detectStalenessReason(rec, { selectedCandidateId: 'title-1', currentFormatRecommendationId: 'format-2' }),
    ).toBe('format_changed');
  });

  it('reports title_changed (not format_changed) when both have diverged — title takes priority', () => {
    expect(
      detectStalenessReason(rec, { selectedCandidateId: 'title-2', currentFormatRecommendationId: 'format-2' }),
    ).toBe('title_changed');
  });

  it('reports title_changed when the title was unlocked entirely (null selection)', () => {
    expect(
      detectStalenessReason(rec, { selectedCandidateId: null, currentFormatRecommendationId: 'format-1' }),
    ).toBe('title_changed');
  });
});

describe('assertValidConfirmation (mirrors migration 0003 CHECK constraints)', () => {
  it('accepts suitable=false with a null type', () => {
    expect(() => assertValidConfirmation(false, null)).not.toThrow();
  });

  it('rejects suitable=false with a non-null type', () => {
    expect(() => assertValidConfirmation(false, 'stripped_sample')).toThrow(/must be null/);
  });

  it('accepts suitable=true with a valid type', () => {
    expect(() => assertValidConfirmation(true, 'standalone_funnel')).not.toThrow();
  });

  it('rejects suitable=true with a null type', () => {
    expect(() => assertValidConfirmation(true, null)).toThrow(/is required/);
  });
});

describe('computeIsOverride (§3.2\'s 5-scenario table)', () => {
  it('scenario 1: PROTO yes/X, user accepts as-is -> not an override', () => {
    const recommended = { suitable: true, type: 'stripped_sample' as const };
    expect(computeIsOverride(recommended, { suitable: true, type: 'stripped_sample' })).toBe(false);
  });

  it('scenario 2: PROTO yes/X, user picks type Y instead -> override', () => {
    const recommended = { suitable: true, type: 'stripped_sample' as const };
    expect(computeIsOverride(recommended, { suitable: true, type: 'standalone_funnel' })).toBe(true);
  });

  it('scenario 3: PROTO yes, user picks None -> override', () => {
    const recommended = { suitable: true, type: 'stripped_sample' as const };
    expect(computeIsOverride(recommended, { suitable: false, type: null })).toBe(true);
  });

  it('scenario 4: PROTO no, user accepts as-is -> not an override', () => {
    const recommended = { suitable: false, type: null };
    expect(computeIsOverride(recommended, { suitable: false, type: null })).toBe(false);
  });

  it('scenario 5: PROTO no, user picks a type anyway -> override', () => {
    const recommended = { suitable: false, type: null };
    expect(computeIsOverride(recommended, { suitable: true, type: 'standalone_funnel' })).toBe(true);
  });
});
