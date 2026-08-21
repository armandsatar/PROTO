import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { recommendFormat } from '../lib/format/recommendFormat';

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Rising demand for freelancer-specific finance tools.',
  demandScore: 8,
  demandSignalDetail: { avgFavorers: 120 },
  competitionScore: 7,
  competitionSignalDetail: { exactAngleMatchCount: 1 },
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const validRecommendationJson = JSON.stringify({
  recommended_format: 'tracker',
  recommended_delivery_mode: 'fillable',
  confidence: 'high',
  reasoning_summary: 'Title implies ongoing logging, matching a tracker format.',
  reasoning_signals: [{ source: 'title', detail: 'Uses "Tracker" explicitly' }],
  alternate_format_considered: null,
});

describe('recommendFormat', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a validated RecommendationResult on a valid first response', async () => {
    mockGroqResponse(validRecommendationJson);
    const result = await recommendFormat(baseInput);
    expect(result.recommendedFormat).toBe('tracker');
    expect(result.recommendedDeliveryMode).toBe('fillable');
    expect(result.confidence).toBe('high');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output, then succeeds on the second attempt', async () => {
    mockGroqResponse(JSON.stringify({ recommended_format: 'not_a_real_format' }));
    mockGroqResponse(validRecommendationJson);

    const result = await recommendFormat(baseInput);
    expect(result.recommendedFormat).toBe('tracker');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive malformed responses (retry exhausted)', async () => {
    mockGroqResponse(JSON.stringify({ recommended_format: 'not_a_real_format' }));
    mockGroqResponse(JSON.stringify({ recommended_format: 'still_not_real' }));

    await expect(recommendFormat(baseInput)).rejects.toThrow(/Format recommendation failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('propagates a guardrail-applied result even when the model omits delivery_mode (ebook case)', async () => {
    mockGroqResponse(
      JSON.stringify({
        recommended_format: 'ebook',
        recommended_delivery_mode: null,
        confidence: 'medium',
        reasoning_summary: 'Reference-style content, no interactivity implied.',
        reasoning_signals: [{ source: 'rationale', detail: 'User wants a reference doc' }],
        alternate_format_considered: 'workbook',
      }),
    );
    const result = await recommendFormat(baseInput);
    expect(result.recommendedFormat).toBe('ebook');
    expect(result.recommendedDeliveryMode).toBeNull();
    expect(result.alternateFormatConsidered).toBe('workbook');
  });
});
