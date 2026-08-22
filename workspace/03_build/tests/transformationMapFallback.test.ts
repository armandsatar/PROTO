import { describe, it, expect } from 'vitest';
import { transformationMapFallbackScaffold } from '../lib/transformationmap/fallbackScaffold';
import { applyTransformationMapGuardrail } from '../lib/transformationmap/guardrail';

describe('transformationMapFallbackScaffold', () => {
  it('returns labeled placeholder text for all 10 fields, not blank or fabricated content', () => {
    const raw = transformationMapFallbackScaffold();
    for (const [key, value] of Object.entries(raw)) {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
      expect(value).toMatch(/^\[.*\]$/); // bracketed placeholder convention
      void key;
    }
  });

  it('every before/after pair is distinct text (not literally identical)', () => {
    const raw = transformationMapFallbackScaffold();
    expect(raw.headline_before).not.toBe(raw.headline_after);
    expect(raw.dim_emotional_before).not.toBe(raw.dim_emotional_after);
    expect(raw.dim_practical_before).not.toBe(raw.dim_practical_after);
    expect(raw.dim_identity_before).not.toBe(raw.dim_identity_after);
    expect(raw.dim_pain_point_before).not.toBe(raw.dim_pain_point_after);
  });
});

describe('transformationMapFallbackScaffold composed with applyTransformationMapGuardrail (integration)', () => {
  it('the fallback scaffold cleanly passes the same guardrail the AI path uses', () => {
    const result = applyTransformationMapGuardrail(transformationMapFallbackScaffold());
    expect(result.headlineBefore).toMatch(/\[Describe/);
    expect(result.dimPainPointAfter).toMatch(/\[Describe/);
  });
});
