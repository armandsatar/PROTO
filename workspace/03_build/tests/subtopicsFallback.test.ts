import { describe, it, expect } from 'vitest';
import { fullListFallback } from '../lib/subtopics/fallback';
import { applyFullListGuardrail } from '../lib/subtopics/guardrail';

describe('fullListFallback (decision 10: honest empty list, never fabricated)', () => {
  it('returns an empty subtopics array', () => {
    expect(fullListFallback()).toEqual({ subtopics: [] });
  });

  it('composes cleanly through the guardrail: empty input, no fields to validate, flagged below-target', () => {
    const result = applyFullListGuardrail(fullListFallback(), { min: 8, max: 12 });
    expect(result.subtopics).toEqual([]);
    expect(result.generationStatus).toBe('succeeded_below_target');
  });
});
