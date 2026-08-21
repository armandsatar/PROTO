import { describe, it, expect } from 'vitest';
import { applyFormatGuardrail } from '../lib/format/guardrail';
import type { RawRecommendation } from '../lib/format/types';

function validRaw(overrides: Partial<RawRecommendation> = {}): RawRecommendation {
  return {
    recommended_format: 'workbook',
    recommended_delivery_mode: 'printable',
    confidence: 'high',
    reasoning_summary: 'Because the title implies hands-on worksheets.',
    reasoning_signals: [{ source: 'title', detail: 'Title uses "Plan Your..." framing' }],
    alternate_format_considered: 'tracker',
    ...overrides,
  };
}

describe('applyFormatGuardrail — required-field validation (rule 1, extended defensively)', () => {
  it('throws on an invalid recommended_format', () => {
    expect(() => applyFormatGuardrail(validRaw({ recommended_format: 'novel' }))).toThrow(/recommended_format/);
  });

  it('throws on an invalid confidence value', () => {
    expect(() => applyFormatGuardrail(validRaw({ confidence: 'very high' }))).toThrow(/confidence/);
  });

  it('throws on an empty reasoning_summary', () => {
    expect(() => applyFormatGuardrail(validRaw({ reasoning_summary: '   ' }))).toThrow(/reasoning_summary/);
  });

  it('throws on a missing/non-string reasoning_summary', () => {
    expect(() => applyFormatGuardrail(validRaw({ reasoning_summary: undefined }))).toThrow(/reasoning_summary/);
  });

  it('passes a fully valid input through unchanged', () => {
    const result = applyFormatGuardrail(validRaw());
    expect(result).toEqual({
      recommendedFormat: 'workbook',
      recommendedDeliveryMode: 'printable',
      confidence: 'high',
      reasoningSummary: 'Because the title implies hands-on worksheets.',
      reasoningSignals: [{ source: 'title', detail: 'Title uses "Plan Your..." framing' }],
      alternateFormatConsidered: 'tracker',
    });
  });
});

describe('applyFormatGuardrail — rule 2: ebook forces delivery_mode to null', () => {
  it('forces null even if the model returned a delivery mode for ebook', () => {
    const result = applyFormatGuardrail(validRaw({ recommended_format: 'ebook', recommended_delivery_mode: 'printable' }));
    expect(result.recommendedFormat).toBe('ebook');
    expect(result.recommendedDeliveryMode).toBeNull();
  });

  it('does not downgrade confidence for a valid ebook recommendation (rule 3 does not apply to ebook)', () => {
    const result = applyFormatGuardrail(validRaw({ recommended_format: 'ebook', recommended_delivery_mode: null }));
    expect(result.confidence).toBe('high');
  });
});

describe('applyFormatGuardrail — rule 3: non-ebook with no delivery mode defaults to fillable, low confidence', () => {
  it('defaults to fillable and downgrades confidence when delivery mode is null', () => {
    const result = applyFormatGuardrail(validRaw({ recommended_delivery_mode: null, confidence: 'high' }));
    expect(result.recommendedDeliveryMode).toBe('fillable');
    expect(result.confidence).toBe('low');
  });

  it('defaults to fillable when delivery mode is malformed (not a valid enum value)', () => {
    const result = applyFormatGuardrail(validRaw({ recommended_delivery_mode: 'sometimes' }));
    expect(result.recommendedDeliveryMode).toBe('fillable');
    expect(result.confidence).toBe('low');
  });

  it('leaves a valid, explicitly-provided delivery mode untouched, confidence unaffected', () => {
    const result = applyFormatGuardrail(validRaw({ recommended_delivery_mode: 'printable', confidence: 'medium' }));
    expect(result.recommendedDeliveryMode).toBe('printable');
    expect(result.confidence).toBe('medium');
  });
});

describe('applyFormatGuardrail — rule 4: empty reasoning_signals still persists, downgrades confidence', () => {
  it('downgrades confidence to low when reasoning_signals is an empty array', () => {
    const result = applyFormatGuardrail(validRaw({ reasoning_signals: [], confidence: 'high' }));
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });

  it('filters out malformed signal entries; if all are malformed, treats it as empty', () => {
    const result = applyFormatGuardrail(
      validRaw({
        reasoning_signals: [{ source: 'not_a_real_source', detail: 'x' }, { detail: 'missing source' }, {}],
        confidence: 'high',
      }),
    );
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });

  it('keeps only valid entries out of a mixed valid/invalid array, no downgrade if at least one survives', () => {
    const result = applyFormatGuardrail(
      validRaw({
        reasoning_signals: [
          { source: 'title', detail: 'valid entry' },
          { source: 'bogus', detail: 'invalid source' },
        ],
        confidence: 'high',
      }),
    );
    expect(result.reasoningSignals).toEqual([{ source: 'title', detail: 'valid entry' }]);
    expect(result.confidence).toBe('high');
  });

  it('treats a non-array reasoning_signals as empty rather than throwing', () => {
    const result = applyFormatGuardrail(validRaw({ reasoning_signals: 'not an array' }));
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });
});

describe('applyFormatGuardrail — alternate_format_considered', () => {
  it('passes through a valid value', () => {
    expect(applyFormatGuardrail(validRaw({ alternate_format_considered: 'quiz' })).alternateFormatConsidered).toBe('quiz');
  });

  it('defaults to null when missing or invalid', () => {
    expect(applyFormatGuardrail(validRaw({ alternate_format_considered: undefined })).alternateFormatConsidered).toBeNull();
    expect(applyFormatGuardrail(validRaw({ alternate_format_considered: 'novel' })).alternateFormatConsidered).toBeNull();
  });
});

describe('applyFormatGuardrail — multiple rules firing together', () => {
  it('stays low (not "more low") when both rule 3 and rule 4 trigger simultaneously', () => {
    const result = applyFormatGuardrail(
      validRaw({ recommended_delivery_mode: null, reasoning_signals: [], confidence: 'high' }),
    );
    expect(result.recommendedDeliveryMode).toBe('fillable');
    expect(result.reasoningSignals).toEqual([]);
    expect(result.confidence).toBe('low');
  });
});
