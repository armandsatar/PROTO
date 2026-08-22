import { describe, it, expect } from 'vitest';
import { fallbackLeadMagnetRecommendation } from '../lib/leadmagnet/fallbackRecommendation';
import { applyLeadMagnetGuardrail } from '../lib/leadmagnet/guardrail';

describe('fallbackLeadMagnetRecommendation', () => {
  it('always recommends not-suitable, with a null type and low confidence', () => {
    const raw = fallbackLeadMagnetRecommendation();
    expect(raw.recommended_suitable).toBe(false);
    expect(raw.recommended_type).toBeNull();
    expect(raw.confidence).toBe('low');
    expect(raw.reasoning_signals).toEqual([]);
    expect(raw.alternate_type_considered).toBeNull();
  });

  it('explains the AI step was unavailable in its reasoning', () => {
    const raw = fallbackLeadMagnetRecommendation();
    expect(String(raw.reasoning_summary)).toMatch(/AI suitability check was unavailable/);
  });
});

describe('fallbackLeadMagnetRecommendation composed with applyLeadMagnetGuardrail (integration)', () => {
  it('produces a fully valid, guardrail-conformant result', () => {
    const result = applyLeadMagnetGuardrail(fallbackLeadMagnetRecommendation());
    expect(result.recommendedSuitable).toBe(false);
    expect(result.recommendedType).toBeNull();
    expect(result.alternateTypeConsidered).toBeNull();
    expect(result.confidence).toBe('low');
    expect(result.reasoningSummary).toMatch(/AI suitability check was unavailable/);
  });
});
