import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCompletion } = vi.hoisted(() => ({ mockCompletion: vi.fn() }));
vi.mock('../lib/copywriting/aiProvider', () => ({ copywritingJsonCompletion: mockCompletion }));

import { generateReviewPass } from '../lib/copywriting/generateReviewPass';

const baseInput = {
  title: 'Notion Budget Tracker',
  draftFields: { hook: 'Draft hook', transformationStory: 'Draft story', cta: 'Draft cta', summary: 'Draft summary' },
  groundingText: 'Real confirmed content about invoice tracking and cash flow.',
};

describe('generateReviewPass', () => {
  beforeEach(() => mockCompletion.mockReset());

  it('returns a clean result on the first attempt', async () => {
    mockCompletion.mockResolvedValueOnce({
      final: { hook: 'Final hook', transformationStory: 'Final story', cta: 'Final cta', summary: 'Final summary' },
      compliance_changes: [],
      specificity_score: 9,
    });
    const result = await generateReviewPass(baseInput);
    expect(result.finalFields.hook).toBe('Final hook');
    expect(result.meetsSpecificityThreshold).toBe(true);
    expect(mockCompletion).toHaveBeenCalledTimes(1);
  });

  it('retries once when specificity is below threshold, feeding back the score', async () => {
    mockCompletion
      .mockResolvedValueOnce({ final: { hook: 'h', transformationStory: 's', cta: 'c', summary: 'sm' }, compliance_changes: [], specificity_score: 4 })
      .mockResolvedValueOnce({ final: { hook: 'h2', transformationStory: 's2', cta: 'c2', summary: 'sm2' }, compliance_changes: [], specificity_score: 9 });
    const result = await generateReviewPass(baseInput);
    expect(result.specificityScore).toBe(9);
    expect(mockCompletion).toHaveBeenCalledTimes(2);
    expect(mockCompletion.mock.calls[1][0].userPrompt).toContain('specificity');
  });

  it('force-flags an uncovered absolutist phrase still present after the retry budget settles', async () => {
    mockCompletion.mockResolvedValue({
      final: { hook: 'This guaranteed to work every time.', transformationStory: 's', cta: 'c', summary: 'sm' },
      compliance_changes: [],
      specificity_score: 9,
    });
    const result = await generateReviewPass(baseInput);
    const forceFlagged = result.complianceChanges.find((c) => c.detectedBy === 'deterministic_keyword_catch');
    expect(forceFlagged).toBeDefined();
    expect(forceFlagged?.rewrittenText).toBe(forceFlagged?.originalText);
  });

  it('drops a compliance change whose original_text does not really appear in the shipped text', async () => {
    mockCompletion.mockResolvedValueOnce({
      final: { hook: 'Clean hook', transformationStory: 's', cta: 'c', summary: 'sm' },
      compliance_changes: [{ original_text: 'fabricated span never in the text', rewritten_text: 'x', reason: 'y', risk_category: 'other' }],
      specificity_score: 9,
    });
    const result = await generateReviewPass(baseInput);
    expect(result.complianceChanges.filter((c) => c.detectedBy === 'ai_judgment')).toEqual([]);
  });

  it('throws after retry when the response stays malformed', async () => {
    mockCompletion.mockResolvedValue({ final: null, compliance_changes: [], specificity_score: 9 });
    await expect(generateReviewPass(baseInput)).rejects.toThrow(/failed after retry/);
    expect(mockCompletion).toHaveBeenCalledTimes(2);
  });
});
