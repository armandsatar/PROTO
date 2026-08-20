import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Groq SDK entirely — these tests exercise our parsing/validation logic,
// not the network. Live integration is covered separately by scripts/smoke-test-ai.ts.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { classifyExactAngleMatches } from '../lib/ai/classify';
import { generateTitleVariants } from '../lib/ai/generateCandidates';
import type { EtsyListing } from '../lib/data-sources/etsy';

function listing(listingId: string): EtsyListing {
  return { listingId, title: 'x', numFavorers: 1, views: 1, price: 1, currencyCode: 'USD' };
}

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

describe('classifyExactAngleMatches', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns [] immediately for zero listings, without calling Groq', async () => {
    const result = await classifyExactAngleMatches('Some Title', []);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('parses a valid classification response', async () => {
    mockGroqResponse(
      JSON.stringify({
        classifications: [
          { listingId: 'a', label: 'exact_angle' },
          { listingId: 'b', label: 'broad_topic' },
        ],
      }),
    );
    const result = await classifyExactAngleMatches('Notion Budget Tracker for Freelancers', [
      listing('a'),
      listing('b'),
    ]);
    expect(result).toEqual([
      { listingId: 'a', label: 'exact_angle' },
      { listingId: 'b', label: 'broad_topic' },
    ]);
  });

  it('throws when the response is missing the classifications array', async () => {
    mockGroqResponse(JSON.stringify({ oops: true }));
    await expect(classifyExactAngleMatches('Title', [listing('a')])).rejects.toThrow(/classifications/);
  });

  it('throws on a malformed label', async () => {
    mockGroqResponse(JSON.stringify({ classifications: [{ listingId: 'a', label: 'sort_of' }] }));
    await expect(classifyExactAngleMatches('Title', [listing('a')])).rejects.toThrow(/malformed/);
  });

  it('throws when the model does not return valid JSON at all', async () => {
    mockGroqResponse('not json at all');
    await expect(classifyExactAngleMatches('Title', [listing('a')])).rejects.toThrow(/valid JSON/);
  });
});

describe('generateTitleVariants', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('parses a valid 3-variant response', async () => {
    mockGroqResponse(
      JSON.stringify({
        variants: [
          { axis: 'niche_down', text: 'Notion Budget Tracker for Freelance Designers' },
          { axis: 'format_hint', text: 'Notion Budget System' },
          { axis: 'keyword_optimized', text: 'Notion Budget Planner Template' },
        ],
      }),
    );
    const result = await generateTitleVariants({
      originalTitle: 'Notion Budget Tracker',
      rationale: 'Rising demand',
      exactAngleMatchListingTitles: ['Notion Budget Planner Template'],
    });
    expect(result).toHaveLength(3);
    expect(result.map((v) => v.axis).sort()).toEqual(['format_hint', 'keyword_optimized', 'niche_down']);
  });

  it('throws when fewer than 3 variants are returned', async () => {
    mockGroqResponse(JSON.stringify({ variants: [{ axis: 'niche_down', text: 'x' }] }));
    await expect(
      generateTitleVariants({ originalTitle: 'T', rationale: 'R', exactAngleMatchListingTitles: [] }),
    ).rejects.toThrow(/exactly 3/);
  });

  it('throws when an axis is duplicated instead of covering all three', async () => {
    mockGroqResponse(
      JSON.stringify({
        variants: [
          { axis: 'niche_down', text: 'a' },
          { axis: 'niche_down', text: 'b' },
          { axis: 'format_hint', text: 'c' },
        ],
      }),
    );
    await expect(
      generateTitleVariants({ originalTitle: 'T', rationale: 'R', exactAngleMatchListingTitles: [] }),
    ).rejects.toThrow(/one variant per axis/);
  });

  it('throws on empty variant text', async () => {
    mockGroqResponse(
      JSON.stringify({
        variants: [
          { axis: 'niche_down', text: '' },
          { axis: 'format_hint', text: 'b' },
          { axis: 'keyword_optimized', text: 'c' },
        ],
      }),
    );
    await expect(
      generateTitleVariants({ originalTitle: 'T', rationale: 'R', exactAngleMatchListingTitles: [] }),
    ).rejects.toThrow(/malformed/);
  });
});
