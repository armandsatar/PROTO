import { describe, it, expect } from 'vitest';
import { validateNarrativeWriterOutput, validatePlatformWriterOutput, validateReviewOutput } from '../lib/copywriting/guardrail';
import type { RawNarrativeWriterResponse, RawPlatformWriterResponse, RawReviewResponse } from '../lib/copywriting/types';

describe('validateNarrativeWriterOutput', () => {
  const valid: RawNarrativeWriterResponse = { hook: 'A real hook.', transformation_story: 'A real story.', cta: 'Get it now.', summary: 'A real summary.' };

  it('returns validated fields for a complete response', () => {
    const result = validateNarrativeWriterOutput(valid);
    expect(result.fields).toEqual({ hook: 'A real hook.', transformationStory: 'A real story.', cta: 'Get it now.', summary: 'A real summary.' });
  });

  it('throws when any field is missing or empty', () => {
    expect(() => validateNarrativeWriterOutput({ ...valid, hook: '' })).toThrow(/hook/);
    expect(() => validateNarrativeWriterOutput({ ...valid, cta: undefined })).toThrow(/cta/);
  });
});

describe('validatePlatformWriterOutput', () => {
  it('requires a title for a platform whose spec says it has one (Etsy)', () => {
    const raw: RawPlatformWriterResponse = { title: undefined, body: 'A description.', platform_fields: {} };
    expect(() => validatePlatformWriterOutput(raw, 'etsy')).toThrow(/title/);
  });

  it('does not require a title for Instagram (caption-only)', () => {
    const raw: RawPlatformWriterResponse = { title: null, body: 'A real caption.', platform_fields: {} };
    const result = validatePlatformWriterOutput(raw, 'instagram');
    expect(result.title).toBeNull();
    expect(result.body).toBe('A real caption.');
  });

  it('extracts only the platform\'s own registered field keys, dropping unknowns', () => {
    const raw: RawPlatformWriterResponse = { title: 'Etsy Title', body: 'Etsy description', platform_fields: { tags: ['budget', 'freelancer'], headline: 'ignored, not etsy\'s field' } };
    const result = validatePlatformWriterOutput(raw, 'etsy');
    expect(result.platformFields).toEqual({ tags: ['budget', 'freelancer'] });
  });

  it('throws on an empty body regardless of platform', () => {
    expect(() => validatePlatformWriterOutput({ title: 'ok', body: '', platform_fields: {} }, 'etsy')).toThrow(/body/);
  });
});

describe('validateReviewOutput', () => {
  const draftFields = { title: 'Draft Title', body: 'Draft body with a guaranteed outcome claim.' };

  it('validates a clean response with matching field names', () => {
    const raw: RawReviewResponse = {
      final: { title: 'Draft Title', body: 'Draft body with a general-information claim.' },
      compliance_changes: [],
      specificity_score: 8,
    };
    const result = validateReviewOutput(raw, draftFields);
    expect(result.finalFields).toEqual({ title: 'Draft Title', body: 'Draft body with a general-information claim.' });
    expect(result.meetsSpecificityThreshold).toBe(true);
  });

  it('throws when "final" is missing a field the draft had', () => {
    const raw: RawReviewResponse = { final: { title: 'Draft Title' }, compliance_changes: [], specificity_score: 8 };
    expect(() => validateReviewOutput(raw, draftFields)).toThrow(/body/);
  });

  it('drops a compliance change whose original_text is not a real substring of the shipped text', () => {
    const raw: RawReviewResponse = {
      final: { title: 'Draft Title', body: 'Clean body now.' },
      compliance_changes: [{ original_text: 'never actually appeared anywhere', rewritten_text: 'x', reason: 'y', risk_category: 'unsupported_claim' }],
      specificity_score: 8,
    };
    const result = validateReviewOutput(raw, draftFields);
    expect(result.complianceChanges).toEqual([]);
  });

  it('flags an uncovered absolutist phrase the AI missed', () => {
    const raw: RawReviewResponse = {
      final: { title: 'Draft Title', body: 'This guaranteed to work every time.' },
      compliance_changes: [],
      specificity_score: 8,
    };
    const result = validateReviewOutput(raw, draftFields);
    expect(result.uncoveredAbsolutistPhrases.length).toBeGreaterThan(0);
  });

  it('meetsSpecificityThreshold is false below the score threshold or at/above the slop-hit threshold', () => {
    const lowScore = validateReviewOutput({ final: { title: 'T', body: 'ok' }, compliance_changes: [], specificity_score: 5 }, { title: 'T', body: 'ok' });
    expect(lowScore.meetsSpecificityThreshold).toBe(false);

    const slopHeavy = validateReviewOutput(
      { final: { title: 'T', body: 'This is crucial. A real game-changer. Say goodbye to problems.' }, compliance_changes: [], specificity_score: 9 },
      { title: 'T', body: 'ok' },
    );
    expect(slopHeavy.slopHitCount).toBeGreaterThanOrEqual(3);
    expect(slopHeavy.meetsSpecificityThreshold).toBe(false);
  });

  it('throws on an invalid specificity_score', () => {
    expect(() => validateReviewOutput({ final: { title: 'T', body: 'ok' }, compliance_changes: [], specificity_score: 11 }, { title: 'T', body: 'ok' })).toThrow(/specificity_score/);
  });
});
