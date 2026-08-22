import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { recommendLeadMagnet } from '../lib/leadmagnet/recommendLeadMagnet';

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking, and building an audience with a smaller taste first would help.',
  demandScore: 8,
  demandSignalDetail: { avgFavorers: 120 },
  competitionScore: 3,
  competitionSignalDetail: { exactAngleMatchCount: 6 },
  confirmedFormat: 'tracker',
  confirmedDeliveryMode: 'fillable',
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const validSuitableJson = JSON.stringify({
  recommended_suitable: true,
  recommended_type: 'stripped_sample',
  confidence: 'high',
  reasoning_summary: 'Tracker format samples down cleanly and the market is crowded.',
  reasoning_signals: [{ source: 'confirmed_format', detail: 'Tracker is modular' }],
  alternate_type_considered: null,
});

describe('recommendLeadMagnet', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a validated LeadMagnetRecommendationResult on a valid first response', async () => {
    mockGroqResponse(validSuitableJson);
    const result = await recommendLeadMagnet(baseInput);
    expect(result.recommendedSuitable).toBe(true);
    expect(result.recommendedType).toBe('stripped_sample');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output, then succeeds on the second attempt', async () => {
    mockGroqResponse(JSON.stringify({ recommended_suitable: 'not a boolean' }));
    mockGroqResponse(validSuitableJson);

    const result = await recommendLeadMagnet(baseInput);
    expect(result.recommendedSuitable).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive malformed responses (retry exhausted)', async () => {
    mockGroqResponse(JSON.stringify({ recommended_suitable: 'nope' }));
    mockGroqResponse(JSON.stringify({ recommended_suitable: 'still nope' }));

    await expect(recommendLeadMagnet(baseInput)).rejects.toThrow(/Lead magnet recommendation failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('propagates a guardrail-applied result for a not-suitable response (type forced null)', async () => {
    mockGroqResponse(
      JSON.stringify({
        recommended_suitable: false,
        recommended_type: null,
        confidence: 'high',
        reasoning_summary: 'Demand is too low to justify a two-tier funnel.',
        reasoning_signals: [{ source: 'demand_signal_detail', detail: 'Low favorites/views' }],
        alternate_type_considered: null,
      }),
    );
    const result = await recommendLeadMagnet(baseInput);
    expect(result.recommendedSuitable).toBe(false);
    expect(result.recommendedType).toBeNull();
  });
});
