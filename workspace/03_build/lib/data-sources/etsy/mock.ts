import type { EtsyDataSource, EtsyListing, EtsySearchResult } from './types';

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 — small, fast, deterministic PRNG from a numeric seed.
function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BreadthRange {
  totalCount: [number, number];
  favorers: [number, number];
  views: [number, number];
  price: [number, number];
}

// Keyword-sensitive: fewer words in the phrase reads as a broader/more generic search term,
// which gets a bigger simulated market (more listings, higher engagement). More words reads
// as a narrower angle. This is a heuristic, not a real signal — good enough to exercise the
// full range of the §3.1 scoring formula without flat, unrealistic fake numbers.
function breadthRangeFor(wordCount: number): BreadthRange {
  if (wordCount <= 2) return { totalCount: [800, 4000], favorers: [40, 400], views: [800, 6000], price: [8, 40] };
  if (wordCount <= 4) return { totalCount: [150, 900], favorers: [10, 120], views: [200, 2000], price: [10, 50] };
  if (wordCount <= 6) return { totalCount: [20, 150], favorers: [2, 40], views: [30, 500], price: [12, 60] };
  return { totalCount: [1, 30], favorers: [0, 12], views: [5, 150], price: [15, 75] };
}

function randInt(rng: () => number, [min, max]: [number, number]): number {
  return Math.floor(min + rng() * (max - min + 1));
}

export class MockEtsyDataSource implements EtsyDataSource {
  async searchListings(keywords: string[], options?: { limit?: number }): Promise<EtsySearchResult> {
    const limit = options?.limit ?? 20;
    const phrase = keywords.join(' ').trim().toLowerCase();
    const wordCount = phrase.split(/\s+/).filter(Boolean).length || 1;
    const range = breadthRangeFor(wordCount);

    const seed = hashString(phrase);
    const rng = mulberry32(seed);

    const totalCount = randInt(rng, range.totalCount);
    const listingCount = Math.min(limit, totalCount);

    const listings: EtsyListing[] = [];
    for (let i = 0; i < listingCount; i++) {
      // Power-law-ish decay so top-ranked mock listings look more "winning" than the
      // tail, like a real search results page does — not just flat random noise.
      const decay = 1 - (i / Math.max(listingCount, 1)) * 0.7;
      listings.push({
        listingId: `mock-${seed}-${i}`,
        title: `${phrase} — mock listing ${i + 1}`,
        numFavorers: Math.max(0, Math.round(randInt(rng, range.favorers) * decay)),
        views: Math.max(0, Math.round(randInt(rng, range.views) * decay)),
        price: Math.round(randInt(rng, range.price) * 100) / 100,
        currencyCode: 'USD',
      });
    }

    return { totalCount, listings };
  }
}
