import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks only the Groq-backed classification call — MockEtsyDataSource is already a
// pure, deterministic, no-network implementation, so it runs for real here.
const { mockClassify } = vi.hoisted(() => ({ mockClassify: vi.fn() }));

vi.mock('../lib/ai/classify', () => ({
  classifyExactAngleMatches: mockClassify,
}));

import { researchTitle } from '../lib/research/researchTitle';

describe('researchTitle', () => {
  beforeEach(() => {
    mockClassify.mockReset();
    delete process.env.ETSY_API_KEY;
    delete process.env.ETSY_DATA_SOURCE; // falls back to mock by default
  });

  it('scores only against listings classified exact_angle, ignoring broad_topic/unrelated', async () => {
    mockClassify.mockImplementation(async (_title: string, listings: Array<{ listingId: string }>) =>
      listings.map((l, i) => ({
        listingId: l.listingId,
        label: i === 0 ? 'exact_angle' : 'broad_topic',
      })),
    );

    const result = await researchTitle('Notion Budget Tracker for Freelancers');

    expect(result.demand.score).toBeGreaterThanOrEqual(1);
    expect(result.demand.score).toBeLessThanOrEqual(10);
    expect(result.competition.score).toBeGreaterThanOrEqual(1);
    expect(result.competition.score).toBeLessThanOrEqual(10);
    expect(result.exactAngleMatchListingTitles).toHaveLength(1);
  });

  it('degrades to the lowest demand bucket when nothing classifies as exact_angle', async () => {
    mockClassify.mockImplementation(async (_title: string, listings: Array<{ listingId: string }>) =>
      listings.map((l) => ({ listingId: l.listingId, label: 'unrelated' as const })),
    );

    const result = await researchTitle('Some Niche Phrase Nobody Sells');

    expect(result.exactAngleMatchListingTitles).toEqual([]);
    expect(result.demand.score).toBe(1);
    expect(result.demand.color).toBe('red');
  });

  it('propagates a classification failure rather than silently swallowing it', async () => {
    mockClassify.mockRejectedValue(new Error('Groq unavailable'));
    await expect(researchTitle('Any Title')).rejects.toThrow('Groq unavailable');
  });
});
