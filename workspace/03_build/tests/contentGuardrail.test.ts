import { describe, it, expect } from 'vitest';
import { validateWriterOutput, validateReviewOutput, SLOP_HIT_THRESHOLD, SPECIFICITY_SCORE_THRESHOLD } from '../lib/content/guardrail';

describe('validateWriterOutput', () => {
  const target = { min: 200, max: 400 };

  it('passes through valid content with the correct word count', () => {
    const content = Array(250).fill('word').join(' ');
    const result = validateWriterOutput({ content }, target);
    expect(result.content).toBe(content);
    expect(result.wordCount).toBe(250);
    expect(result.meetsLengthTarget).toBe(true);
  });

  it('flags meetsLengthTarget=false without throwing when the count misses the tolerance band', () => {
    const content = Array(10).fill('word').join(' ');
    const result = validateWriterOutput({ content }, target);
    expect(result.wordCount).toBe(10);
    expect(result.meetsLengthTarget).toBe(false);
  });

  it('throws on empty content', () => {
    expect(() => validateWriterOutput({ content: '   ' }, target)).toThrow(/empty or non-string/);
  });

  it('throws on non-string content', () => {
    expect(() => validateWriterOutput({ content: 42 }, target)).toThrow(/empty or non-string/);
  });
});

function baseReviewRaw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    final_content: 'Clean, specific final content about freelance budgeting.',
    compliance_changes: [],
    specificity_score: 8,
    specificity_issues: [],
    ...overrides,
  };
}

describe('validateReviewOutput — field validation', () => {
  const draft = 'Original draft mentioning this cures everything.';

  it('passes through a clean valid response', () => {
    const result = validateReviewOutput(baseReviewRaw(), draft);
    expect(result.finalContent).toBe('Clean, specific final content about freelance budgeting.');
    expect(result.specificityScore).toBe(8);
    expect(result.complianceChanges).toEqual([]);
  });

  it('throws on missing/empty final_content', () => {
    expect(() => validateReviewOutput(baseReviewRaw({ final_content: '' }), draft)).toThrow(/final_content/);
  });

  it('throws on a non-integer specificity_score', () => {
    expect(() => validateReviewOutput(baseReviewRaw({ specificity_score: 7.5 }), draft)).toThrow(/specificity_score/);
  });

  it('throws on an out-of-range specificity_score', () => {
    expect(() => validateReviewOutput(baseReviewRaw({ specificity_score: 11 }), draft)).toThrow(/specificity_score/);
    expect(() => validateReviewOutput(baseReviewRaw({ specificity_score: 0 }), draft)).toThrow(/specificity_score/);
  });

  it('throws when compliance_changes is not an array', () => {
    expect(() => validateReviewOutput(baseReviewRaw({ compliance_changes: 'nope' }), draft)).toThrow(/compliance_changes/);
  });
});

describe('validateReviewOutput — per-item compliance_changes validation (drop, not throw)', () => {
  const draft = 'Original draft mentioning this cures everything and is guaranteed.';

  it('keeps a valid, substring-matched item', () => {
    const raw = baseReviewRaw({
      compliance_changes: [
        { original_text: 'this cures everything', rewritten_text: 'this may help', reason: 'Overstated claim.', risk_category: 'unsupported_claim' },
      ],
    });
    const result = validateReviewOutput(raw, draft);
    expect(result.complianceChanges).toHaveLength(1);
    expect(result.complianceChanges[0].detectedBy).toBe('ai_judgment');
  });

  it('drops an item whose original_text is not actually in the draft', () => {
    const raw = baseReviewRaw({
      compliance_changes: [
        { original_text: 'a phrase never in the draft', rewritten_text: 'x', reason: 'y', risk_category: 'other' },
      ],
    });
    expect(validateReviewOutput(raw, draft).complianceChanges).toHaveLength(0);
  });

  it('drops an item with an invalid risk_category', () => {
    const raw = baseReviewRaw({
      compliance_changes: [
        { original_text: 'this cures everything', rewritten_text: 'x', reason: 'y', risk_category: 'not_a_real_category' },
      ],
    });
    expect(validateReviewOutput(raw, draft).complianceChanges).toHaveLength(0);
  });

  it('keeps valid items alongside dropped invalid ones in the same response', () => {
    const raw = baseReviewRaw({
      compliance_changes: [
        { original_text: 'this cures everything', rewritten_text: 'this may help', reason: 'y', risk_category: 'unsupported_claim' },
        { original_text: 'not in draft', rewritten_text: 'x', reason: 'y', risk_category: 'other' },
      ],
    });
    expect(validateReviewOutput(raw, draft).complianceChanges).toHaveLength(1);
  });
});

describe('validateReviewOutput — deterministic scanner integration', () => {
  const draft = 'Draft text.';

  it('meetsSpecificityThreshold is true for a clean response at/above the score threshold', () => {
    const raw = baseReviewRaw({ final_content: 'Specific, concrete final content.', specificity_score: SPECIFICITY_SCORE_THRESHOLD });
    expect(validateReviewOutput(raw, draft).meetsSpecificityThreshold).toBe(true);
  });

  it('meetsSpecificityThreshold is false when the score is below threshold', () => {
    const raw = baseReviewRaw({ specificity_score: SPECIFICITY_SCORE_THRESHOLD - 1 });
    expect(validateReviewOutput(raw, draft).meetsSpecificityThreshold).toBe(false);
  });

  it('meetsSpecificityThreshold is false at the slop-hit threshold even with a high score', () => {
    const slopContent = 'It is crucial to leverage a robust system that is seamless.'; // 4 distinct slop phrases
    const raw = baseReviewRaw({ final_content: slopContent, specificity_score: 10 });
    const result = validateReviewOutput(raw, draft);
    expect(result.slopHitCount).toBeGreaterThanOrEqual(SLOP_HIT_THRESHOLD);
    expect(result.meetsSpecificityThreshold).toBe(false);
  });

  it('reports an uncovered absolutist phrase not addressed by any compliance change', () => {
    const raw = baseReviewRaw({ final_content: 'This routine guarantees great results.', compliance_changes: [] });
    const result = validateReviewOutput(raw, draft);
    expect(result.uncoveredAbsolutistPhrases).toContain('guarantee');
  });

  it('does not report an absolutist phrase already covered by a compliance change', () => {
    const raw = baseReviewRaw({
      final_content: 'This routine guarantees great results.',
      compliance_changes: [
        { original_text: 'guarantees great results', rewritten_text: 'may support good results', reason: 'y', risk_category: 'absolute_language' },
      ],
    });
    const result = validateReviewOutput(raw, 'Draft text mentioning guarantees great results.');
    expect(result.uncoveredAbsolutistPhrases).toHaveLength(0);
  });
});
