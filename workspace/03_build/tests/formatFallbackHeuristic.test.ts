import { describe, it, expect } from 'vitest';
import { fallbackFormatRecommendation } from '../lib/format/fallbackHeuristic';
import { applyFormatGuardrail } from '../lib/format/guardrail';

describe('fallbackFormatRecommendation — decision 1 keyword table', () => {
  it('matches tracker keywords', () => {
    expect(fallbackFormatRecommendation('Daily Habit Tracker', '').recommended_format).toBe('tracker');
    expect(fallbackFormatRecommendation('Workout Log', '').recommended_format).toBe('tracker');
  });

  it('matches workbook keywords', () => {
    expect(fallbackFormatRecommendation('Meal Planner', '').recommended_format).toBe('workbook');
    expect(fallbackFormatRecommendation('Budget Worksheet', '').recommended_format).toBe('workbook');
  });

  it('matches ebook keywords', () => {
    expect(fallbackFormatRecommendation('The Complete Guide to Freelancing', '').recommended_format).toBe('ebook');
    expect(fallbackFormatRecommendation('Freelancer Handbook', '').recommended_format).toBe('ebook');
  });

  it('matches quiz keywords', () => {
    expect(fallbackFormatRecommendation('Which Budgeting Style Are You?', '').recommended_format).toBe('quiz');
    expect(fallbackFormatRecommendation('Find Your Ideal Morning Routine', '').recommended_format).toBe('quiz');
  });

  it('defaults to workbook when nothing matches', () => {
    expect(fallbackFormatRecommendation('Notion Budget Dashboard for Freelancers', '').recommended_format).toBe('workbook');
  });

  it('matches against the rationale too, not just the title', () => {
    const result = fallbackFormatRecommendation('Freelance Finance Thing', 'I want a daily habit tracker for spending');
    expect(result.recommended_format).toBe('tracker');
  });

  it('first-match-wins when multiple keyword categories are present', () => {
    // Contains both a tracker keyword ("habit"/"tracker") and a workbook keyword ("workbook") —
    // tracker is checked first in the rule table, so it should win.
    const result = fallbackFormatRecommendation('Habit Tracker Workbook', '');
    expect(result.recommended_format).toBe('tracker');
  });

  it('always returns low confidence and empty signals, leaving delivery_mode for the guardrail to fill in', () => {
    const result = fallbackFormatRecommendation('Anything', '');
    expect(result.confidence).toBe('low');
    expect(result.reasoning_signals).toEqual([]);
    expect(result.recommended_delivery_mode).toBeNull();
  });
});

describe('fallbackFormatRecommendation composed with applyFormatGuardrail (integration)', () => {
  it('a matched non-ebook format ends up fillable + low confidence after the guardrail', () => {
    const result = applyFormatGuardrail(fallbackFormatRecommendation('Daily Habit Tracker', ''));
    expect(result.recommendedFormat).toBe('tracker');
    expect(result.recommendedDeliveryMode).toBe('fillable');
    expect(result.confidence).toBe('low');
  });

  it('a matched ebook format ends up with a null delivery mode after the guardrail', () => {
    const result = applyFormatGuardrail(fallbackFormatRecommendation('The Complete Guide to Freelancing', ''));
    expect(result.recommendedFormat).toBe('ebook');
    expect(result.recommendedDeliveryMode).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('the fallback reasoning_summary survives the guardrail unchanged', () => {
    const result = applyFormatGuardrail(fallbackFormatRecommendation('Anything', ''));
    expect(result.reasoningSummary).toMatch(/AI recommendation step was unavailable/);
  });
});
