import { describe, it, expect, afterEach } from 'vitest';
import { MockEtsyDataSource } from '../lib/data-sources/etsy/mock';
import { getEtsyDataSource } from '../lib/data-sources/etsy';

describe('MockEtsyDataSource', () => {
  const source = new MockEtsyDataSource();

  it('returns a shape matching EtsySearchResult', async () => {
    const result = await source.searchListings(['budget', 'tracker'], { limit: 20 });
    expect(typeof result.totalCount).toBe('number');
    expect(Array.isArray(result.listings)).toBe(true);
    expect(result.listings.length).toBeLessThanOrEqual(20);
    for (const listing of result.listings) {
      expect(typeof listing.listingId).toBe('string');
      expect(typeof listing.title).toBe('string');
      expect(typeof listing.numFavorers).toBe('number');
      expect(typeof listing.views).toBe('number');
      expect(typeof listing.price).toBe('number');
      expect(listing.currencyCode).toBe('USD');
    }
  });

  it('is deterministic for the same keyword input', async () => {
    const first = await source.searchListings(['notion', 'budget', 'planner']);
    const second = await source.searchListings(['notion', 'budget', 'planner']);
    expect(second).toEqual(first);
  });

  it('gives broader keywords a bigger simulated market than narrow ones', async () => {
    const broad = await source.searchListings(['planner']);
    const narrow = await source.searchListings([
      'planner',
      'for',
      'adhd',
      'freelance',
      'illustrators',
      'launching',
      'an',
      'etsy',
      'shop',
    ]);
    expect(broad.totalCount).toBeGreaterThan(narrow.totalCount);
  });

  it('never returns more listings than the requested limit, even with a big simulated market', async () => {
    const result = await source.searchListings(['planner'], { limit: 5 });
    expect(result.listings.length).toBeLessThanOrEqual(5);
  });
});

describe('getEtsyDataSource factory', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to mock when ETSY_DATA_SOURCE and ETSY_API_KEY are both unset', () => {
    delete process.env.ETSY_DATA_SOURCE;
    delete process.env.ETSY_API_KEY;
    expect(getEtsyDataSource()).toBeInstanceOf(MockEtsyDataSource);
  });

  it('honors an explicit ETSY_DATA_SOURCE=mock even if an API key is present', () => {
    process.env.ETSY_DATA_SOURCE = 'mock';
    process.env.ETSY_API_KEY = 'fake-key-for-test';
    expect(getEtsyDataSource()).toBeInstanceOf(MockEtsyDataSource);
  });

  it('throws when forced to real mode without an API key', () => {
    process.env.ETSY_DATA_SOURCE = 'real';
    delete process.env.ETSY_API_KEY;
    expect(() => getEtsyDataSource()).toThrow(/ETSY_API_KEY/);
  });
});
