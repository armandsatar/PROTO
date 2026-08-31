import { describe, it, expect } from 'vitest';
import { validatePricingReasoningOutput, assertValidPrice } from '../lib/pricing/guardrail';

describe('validatePricingReasoningOutput', () => {
  it('accepts valid reasoning output', () => {
    const result = validatePricingReasoningOutput({
      reasoning_summary: 'Based on a median price of $10.00 across 8 comparable Etsy listings.',
      reasoning_signals: [
        { source: 'comparable_prices', detail: 'Median of 8 exact-angle-match listings: $10.00' },
        { source: 'demand_score', detail: 'Demand score 8/10 (green) — high buyer interest' },
      ],
    });
    expect(result.reasoningSummary).toContain('$10.00');
    expect(result.reasoningSignals).toHaveLength(2);
    expect(result.reasoningSignals[0].source).toBe('comparable_prices');
  });

  it('throws on empty reasoning_summary', () => {
    expect(() =>
      validatePricingReasoningOutput({
        reasoning_summary: '',
        reasoning_signals: [],
      }),
    ).toThrow('empty or non-string');
  });

  it('throws on non-string reasoning_summary', () => {
    expect(() =>
      validatePricingReasoningOutput({
        reasoning_summary: 42,
        reasoning_signals: [],
      }),
    ).toThrow('empty or non-string');
  });

  it('filters out invalid reasoning signals (wrong source)', () => {
    const result = validatePricingReasoningOutput({
      reasoning_summary: 'Valid summary.',
      reasoning_signals: [
        { source: 'comparable_prices', detail: 'Valid signal' },
        { source: 'invalid_source', detail: 'This should be filtered' },
        { source: 'demand_score', detail: '' }, // empty detail, filtered
      ],
    });
    expect(result.reasoningSignals).toHaveLength(1);
  });

  it('returns empty signals array if none are valid', () => {
    const result = validatePricingReasoningOutput({
      reasoning_summary: 'Valid summary.',
      reasoning_signals: [{ source: 'bad', detail: 'bad' }],
    });
    expect(result.reasoningSignals).toHaveLength(0);
  });

  it('handles null reasoning_signals gracefully', () => {
    const result = validatePricingReasoningOutput({
      reasoning_summary: 'Valid summary.',
      reasoning_signals: null,
    });
    expect(result.reasoningSignals).toHaveLength(0);
  });

  it('trims whitespace from reasoning_summary', () => {
    const result = validatePricingReasoningOutput({
      reasoning_summary: '  trimmed  ',
      reasoning_signals: [],
    });
    expect(result.reasoningSummary).toBe('trimmed');
  });
});

describe('assertValidPrice', () => {
  it('does not throw for valid price within ceiling', () => {
    expect(() => assertValidPrice(14.99, 99.99)).not.toThrow();
  });

  it('throws for zero price', () => {
    expect(() => assertValidPrice(0, 99.99)).toThrow('must be positive');
  });

  it('throws for negative price', () => {
    expect(() => assertValidPrice(-5, 99.99)).toThrow('must be positive');
  });

  it('throws for price above ceiling', () => {
    expect(() => assertValidPrice(100, 99.99)).toThrow('exceeds ceiling');
  });

  it('accepts price exactly at ceiling', () => {
    expect(() => assertValidPrice(99.99, 99.99)).not.toThrow();
  });
});
