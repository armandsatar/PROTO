import { describe, it, expect } from 'vitest';
import { applyLeadMagnetGuardrail } from '../lib/leadmagnet/guardrail';
import type { RawLeadMagnetRecommendation } from '../lib/leadmagnet/types';

function validRaw(overrides: Partial<RawLeadMagnetRecommendation> = {}): RawLeadMagnetRecommendation {
  return {
    recommended_suitable: true,
    recommended_type: 'standalone_funnel',
    confidence: 'high',
    reasoning_summary: 'Competitive niche, a free entry point builds trust before the paid ask.',
    reasoning_signals: [{ source: 'competition_signal_detail', detail: 'High exact-angle competition' }],
    alternate_type_considered: 'stripped_sample',
    ...overrides,
  };
}

describe('applyLeadMagnetGuardrail — required-field validation (rule 1, extended defensively)', () => {
  it('throws on a non-boolean recommended_suitable', () => {
    expect(() => applyLeadMagnetGuardrail(validRaw({ recommended_suitable: 'yes' }))).toThrow(/recommended_suitable/);
  });

  it('throws on an invalid confidence value', () => {
    expect(() => applyLeadMagnetGuardrail(validRaw({ confidence: 'super high' }))).toThrow(/confidence/);
  });

  it('throws on an empty reasoning_summary', () => {
    expect(() => applyLeadMagnetGuardrail(validRaw({ reasoning_summary: '  ' }))).toThrow(/reasoning_summary/);
  });

  it('passes a fully valid input through unchanged', () => {
    const result = applyLeadMagnetGuardrail(validRaw());
    expect(result).toEqual({
      recommendedSuitable: true,
      recommendedType: 'standalone_funnel',
      confidence: 'high',
      reasoningSummary: 'Competitive niche, a free entry point builds trust before the paid ask.',
      reasoningSignals: [{ source: 'competition_signal_detail', detail: 'High exact-angle competition' }],
      alternateTypeConsidered: 'stripped_sample',
    });
  });
});

describe('applyLeadMagnetGuardrail — rule 2 & 5: not-suitable forces type and alternate to null', () => {
  it('forces recommended_type to null even if the model returned one', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_suitable: false, recommended_type: 'stripped_sample' }));
    expect(result.recommendedSuitable).toBe(false);
    expect(result.recommendedType).toBeNull();
  });

  it('forces alternate_type_considered to null too', () => {
    const result = applyLeadMagnetGuardrail(
      validRaw({ recommended_suitable: false, alternate_type_considered: 'standalone_funnel' }),
    );
    expect(result.alternateTypeConsidered).toBeNull();
  });

  it('does not downgrade confidence for a valid not-suitable recommendation (rule 3 does not apply here)', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_suitable: false, confidence: 'high' }));
    expect(result.confidence).toBe('high');
  });
});

describe('applyLeadMagnetGuardrail — rule 3: suitable with no usable type defaults to stripped_sample, low confidence', () => {
  it('defaults to stripped_sample and downgrades confidence when type is null', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_type: null, confidence: 'high' }));
    expect(result.recommendedType).toBe('stripped_sample');
    expect(result.confidence).toBe('low');
  });

  it('defaults to stripped_sample when type is malformed (not a valid enum value)', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_type: 'full_course' }));
    expect(result.recommendedType).toBe('stripped_sample');
    expect(result.confidence).toBe('low');
  });

  it('leaves a valid, explicitly-provided type untouched, confidence unaffected', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_type: 'standalone_funnel', confidence: 'medium' }));
    expect(result.recommendedType).toBe('standalone_funnel');
    expect(result.confidence).toBe('medium');
  });
});

describe('applyLeadMagnetGuardrail — rule 4: empty reasoning_signals still persists, downgrades confidence', () => {
  it('downgrades confidence when reasoning_signals is empty, for a suitable=true recommendation', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ reasoning_signals: [], confidence: 'high' }));
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });

  it('downgrades confidence when reasoning_signals is empty, for a suitable=false recommendation too', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_suitable: false, reasoning_signals: [], confidence: 'high' }));
    expect(result.confidence).toBe('low');
  });

  it('filters out malformed signal entries; if all are malformed, treats it as empty', () => {
    const result = applyLeadMagnetGuardrail(
      validRaw({ reasoning_signals: [{ source: 'not_real', detail: 'x' }, { detail: 'missing source' }], confidence: 'high' }),
    );
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });

  it('keeps only valid entries out of a mixed array, no downgrade if at least one survives', () => {
    const result = applyLeadMagnetGuardrail(
      validRaw({
        reasoning_signals: [
          { source: 'confirmed_format', detail: 'Format is workbook, samples down well' },
          { source: 'bogus', detail: 'invalid' },
        ],
        confidence: 'high',
      }),
    );
    expect(result.reasoningSignals).toEqual([{ source: 'confirmed_format', detail: 'Format is workbook, samples down well' }]);
    expect(result.confidence).toBe('high');
  });
});

describe('applyLeadMagnetGuardrail — alternate_type_considered', () => {
  it('passes through a valid value when suitable', () => {
    expect(applyLeadMagnetGuardrail(validRaw({ alternate_type_considered: 'stripped_sample' })).alternateTypeConsidered).toBe(
      'stripped_sample',
    );
  });

  it('defaults to null when missing or invalid', () => {
    expect(applyLeadMagnetGuardrail(validRaw({ alternate_type_considered: undefined })).alternateTypeConsidered).toBeNull();
    expect(applyLeadMagnetGuardrail(validRaw({ alternate_type_considered: 'full_course' })).alternateTypeConsidered).toBeNull();
  });
});

describe('applyLeadMagnetGuardrail — multiple rules firing together', () => {
  it('stays low (not "more low") when both rule 3 and rule 4 trigger simultaneously', () => {
    const result = applyLeadMagnetGuardrail(validRaw({ recommended_type: null, reasoning_signals: [], confidence: 'high' }));
    expect(result.recommendedType).toBe('stripped_sample');
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });
});
