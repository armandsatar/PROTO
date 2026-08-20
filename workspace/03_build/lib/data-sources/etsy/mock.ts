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

// Mock listing titles deliberately vary in how closely they match the candidate
// phrase's specific angle, not just its broad topic — otherwise every mock listing
// trivially classifies as exact_angle (confirmed happening in Increment 4's first live
// smoke test: 10/10 "exact_angle" because every title was just the phrase echoed back)
// and lib/ai/classify.ts never gets exercised against real discrimination. Not a real
// signal — just enough structure for the classifier and downstream scoring to see a
// realistic mix of exact-angle / broad-topic / unrelated results, like a real search page.
const UNRELATED_TITLES = [
  'Wedding Invitation Template',
  'Digital Sticker Pack',
  'Recipe Card Printable',
  'Workout Log Planner',
  'Birthday Party Checklist',
  'Travel Packing List Template',
];

const TITLE_SUFFIXES = ['Template', 'System', 'Printable', 'Digital Download', ''];

type TitleBucket = 'exact' | 'broad' | 'unrelated';

function pickBucket(rng: () => number): TitleBucket {
  const r = rng();
  if (r < 0.35) return 'exact';
  if (r < 0.75) return 'broad';
  return 'unrelated';
}

function capitalize(words: string[]): string {
  return words.map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// Rough heuristic split: back half of the phrase reads as the "qualifier"/angle
// (e.g. "for Freelancers"), front half as the "core" concept (e.g. "Notion Budget
// Tracker"). Good enough for mock title variation, not a real NLP parse.
function splitCoreAndQualifier(words: string[]): { core: string[]; qualifier: string[] } {
  const splitPoint = Math.max(1, Math.ceil(words.length / 2));
  return { core: words.slice(0, splitPoint), qualifier: words.slice(splitPoint) };
}

function titleForBucket(bucket: TitleBucket, words: string[], rng: () => number): string {
  const suffix = TITLE_SUFFIXES[Math.floor(rng() * TITLE_SUFFIXES.length)];
  if (bucket === 'unrelated') {
    return UNRELATED_TITLES[Math.floor(rng() * UNRELATED_TITLES.length)];
  }
  const { core, qualifier } = splitCoreAndQualifier(words);
  // exact: keeps the full phrase including its specific angle/qualifier.
  // broad: drops the qualifier, same general topic but a different specific angle.
  const base = bucket === 'exact' ? [...core, ...qualifier] : core;
  const title = capitalize(base);
  return suffix ? `${title} ${suffix}` : title;
}

export class MockEtsyDataSource implements EtsyDataSource {
  async searchListings(keywords: string[], options?: { limit?: number }): Promise<EtsySearchResult> {
    const limit = options?.limit ?? 20;
    const phrase = keywords.join(' ').trim().toLowerCase();
    const words = phrase.split(/\s+/).filter(Boolean);
    const wordCount = words.length || 1;
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
      const bucket = pickBucket(rng);
      listings.push({
        listingId: `mock-${seed}-${i}`,
        title: titleForBucket(bucket, words, rng),
        numFavorers: Math.max(0, Math.round(randInt(rng, range.favorers) * decay)),
        views: Math.max(0, Math.round(randInt(rng, range.views) * decay)),
        price: Math.round(randInt(rng, range.price) * 100) / 100,
        currencyCode: 'USD',
      });
    }

    return { totalCount, listings };
  }
}
