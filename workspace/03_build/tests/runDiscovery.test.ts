import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockResearchTitle } = vi.hoisted(() => ({
  mockResearchTitle: vi.fn(),
}));

vi.mock('../lib/research/researchTitle', () => ({
  researchTitle: mockResearchTitle,
}));

import { runDiscovery } from '../lib/discovery/runDiscovery';
import type { CuratedSeed } from '../lib/discovery/types';

function makeResearchResult(demandScore: number, competitionScore: number, prices: number[] = []) {
  return {
    demand: {
      score: demandScore,
      color: demandScore >= 7 ? 'green' : demandScore >= 5 ? 'amber' : 'red',
      detail: { avgFavorers: 50, avgViews: 500, exactAngleMatchListingCount: 3 },
    },
    competition: {
      score: competitionScore,
      color: competitionScore >= 7 ? 'green' : competitionScore >= 5 ? 'amber' : 'red',
      detail: {
        exactAngleMatchCount: 3,
        totalListingCount: 200,
        ...(prices.length > 0 ? { exactAngleMatchPrices: prices } : {}),
      },
    },
    exactAngleMatchListingTitles: [
      'Example Listing Title One',
      'Example Listing Title Two',
      'Example Listing Title Three',
      'Example Listing Title Four',
    ],
  };
}

const SEEDS: CuratedSeed[] = [
  { title: 'Notion Budget Tracker', category: 'notion', rationale: 'Budget tracking niche.' },
  { title: 'Wedding Guest List Template', category: 'wedding', rationale: 'Wedding planning.' },
  { title: 'Meal Prep Planner', category: 'health', rationale: 'Meal prep market.' },
];

describe('runDiscovery', () => {
  beforeEach(() => {
    mockResearchTitle.mockReset();
  });

  it('scores all seeds and returns sorted results', async () => {
    mockResearchTitle
      .mockResolvedValueOnce(makeResearchResult(5, 6))   // combined = 5.5
      .mockResolvedValueOnce(makeResearchResult(8, 9))   // combined = 8.5
      .mockResolvedValueOnce(makeResearchResult(3, 4));  // combined = 3.5

    const result = await runDiscovery({ seeds: SEEDS });

    expect(result.scoredCount).toBe(3);
    expect(result.niches).toHaveLength(3);
    expect(result.niches[0].combinedScore).toBe(8.5);
    expect(result.niches[0].seed).toBe('Wedding Guest List Template');
    expect(result.niches[1].combinedScore).toBe(5.5);
    expect(result.niches[2].combinedScore).toBe(3.5);
  });

  it('preserves category and rationale from seeds', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7));

    const result = await runDiscovery({ seeds: SEEDS });

    const notion = result.niches.find((n) => n.seed === 'Notion Budget Tracker');
    expect(notion?.category).toBe('notion');
    expect(notion?.rationale).toBe('Budget tracking niche.');
  });

  it('extracts market size from competition detail', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7));

    const result = await runDiscovery({ seeds: [SEEDS[0]] });

    expect(result.niches[0].marketSize.exactAngleCount).toBe(3);
    expect(result.niches[0].marketSize.totalCount).toBe(200);
  });

  it('extracts top 3 example listings', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7));

    const result = await runDiscovery({ seeds: [SEEDS[0]] });

    expect(result.niches[0].exampleListings).toHaveLength(3);
    expect(result.niches[0].exampleListings[0]).toBe('Example Listing Title One');
  });

  it('extracts price range when prices are available', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7, [9.99, 14.99, 24.99]));

    const result = await runDiscovery({ seeds: [SEEDS[0]] });

    expect(result.niches[0].priceRange).toEqual({ min: 9.99, max: 24.99 });
  });

  it('returns null price range when no prices available', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7));

    const result = await runDiscovery({ seeds: [SEEDS[0]] });

    expect(result.niches[0].priceRange).toBeNull();
  });

  it('handles empty seed list', async () => {
    const result = await runDiscovery({ seeds: [] });

    expect(result.scoredCount).toBe(0);
    expect(result.niches).toHaveLength(0);
    expect(mockResearchTitle).not.toHaveBeenCalled();
  });

  it('defaults uncategorized for seeds without category', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7));

    const result = await runDiscovery({
      seeds: [{ title: 'Test Niche', rationale: 'A test.' }],
    });

    expect(result.niches[0].category).toBe('uncategorized');
  });

  it('respects concurrency parameter', async () => {
    // Track concurrent calls
    let concurrent = 0;
    let maxConcurrent = 0;
    mockResearchTitle.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return makeResearchResult(7, 7);
    });

    const manySeeds = Array.from({ length: 12 }, (_, i) => ({
      title: `Seed ${i}`,
      category: 'test',
      rationale: 'Test.',
    }));

    await runDiscovery({ seeds: manySeeds, concurrency: 4 });

    expect(maxConcurrent).toBeLessThanOrEqual(4);
    expect(mockResearchTitle).toHaveBeenCalledTimes(12);
  });

  it('records elapsed time', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 7));

    const result = await runDiscovery({ seeds: [SEEDS[0]] });

    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('computes combined score with correct rounding', async () => {
    mockResearchTitle.mockResolvedValue(makeResearchResult(7, 8)); // (7+8)/2 = 7.5

    const result = await runDiscovery({ seeds: [SEEDS[0]] });

    expect(result.niches[0].combinedScore).toBe(7.5);
  });
});
