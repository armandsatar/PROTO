import { describe, it, expect } from 'vitest';
import { applyTransformationMapGuardrail } from '../lib/transformationmap/guardrail';
import type { RawTransformationMapContent } from '../lib/transformationmap/types';

const LONG_BEFORE = 'A knot in her stomach every Sunday night before the bills are due.'; // 67 chars
const LONG_AFTER = 'Sunday nights are just Sunday nights again, no dread at all now.'; // 66 chars

function validRaw(overrides: Partial<RawTransformationMapContent> = {}): RawTransformationMapContent {
  return {
    headline_before: 'Dreads opening her finances every single week without fail.',
    headline_after: 'Feels a calm, boring sense that her money is fully handled.',
    dim_emotional_before: LONG_BEFORE,
    dim_emotional_after: LONG_AFTER,
    dim_practical_before: 'Manually reconciling four spreadsheets, about two hours every week without fail.',
    dim_practical_after: 'Opens one dashboard that updates itself, checks it in under five minutes now.',
    dim_identity_before: "\"I'm just bad with money, I'll never really get ahead no matter what I try.\"",
    dim_identity_after: "\"I'm someone who has this handled, I'm in control of my own future now.\"",
    dim_pain_point_before: 'Opening the banking app and feeling a stomach-drop of dread before the number.',
    dim_pain_point_after: 'Opening the banking app on autopilot now, no dread, no surprises left to find.',
    ...overrides,
  };
}

describe('applyTransformationMapGuardrail — rule 1: all fields present and non-empty', () => {
  it('throws on a missing field', () => {
    expect(() => applyTransformationMapGuardrail(validRaw({ headline_before: undefined }))).toThrow(/headline_before/);
  });

  it('throws on a non-string field', () => {
    expect(() => applyTransformationMapGuardrail(validRaw({ dim_emotional_after: 42 }))).toThrow(/dim_emotional_after/);
  });

  it('throws on a whitespace-only field', () => {
    expect(() => applyTransformationMapGuardrail(validRaw({ dim_practical_before: '   ' }))).toThrow(/dim_practical_before/);
  });

  it('passes a fully valid input through, trimmed and mapped to camelCase', () => {
    const result = applyTransformationMapGuardrail(validRaw());
    expect(result.headlineBefore).toBe('Dreads opening her finances every single week without fail.');
    expect(result.dimEmotionalBefore).toBe(LONG_BEFORE);
    expect(result.dimPainPointAfter).toContain('autopilot');
  });
});

describe('applyTransformationMapGuardrail — rule 2: minimum length (decision 13, 30 chars)', () => {
  it('throws on a field under 30 characters', () => {
    expect(() => applyTransformationMapGuardrail(validRaw({ headline_before: 'Feels bad about money.' }))).toThrow(/too short/);
  });

  it('accepts a field at exactly 30 characters (boundary inclusive)', () => {
    const exactly30 = 'x'.repeat(30);
    expect(() => applyTransformationMapGuardrail(validRaw({ headline_before: exactly30, headline_after: 'y'.repeat(30) }))).not.toThrow();
  });

  it('rejects a field at 29 characters (one under the boundary)', () => {
    expect(() => applyTransformationMapGuardrail(validRaw({ headline_before: 'x'.repeat(29) }))).toThrow(/too short/);
  });
});

describe('applyTransformationMapGuardrail — rule 3: before != after per pair', () => {
  it('throws when a dimension pair is literally identical', () => {
    const same = 'This exact same sentence appears in both before and after fields.';
    expect(() => applyTransformationMapGuardrail(validRaw({ dim_identity_before: same, dim_identity_after: same }))).toThrow(
      /identical.*"identity"/,
    );
  });

  it('throws when the headline pair is identical too, not just the 4 named dimensions', () => {
    const same = 'This exact same headline sentence appears in both before and after.';
    expect(() => applyTransformationMapGuardrail(validRaw({ headline_before: same, headline_after: same }))).toThrow(
      /identical.*"headline"/,
    );
  });

  it('does not throw when pairs differ only slightly (not a semantic check, just string equality)', () => {
    const before = 'A knot in her stomach every Sunday night before the bills are due.';
    const after = 'A knot in her stomach every Sunday night before the bills are due!'; // one char different
    expect(() => applyTransformationMapGuardrail(validRaw({ dim_emotional_before: before, dim_emotional_after: after }))).not.toThrow();
  });
});
