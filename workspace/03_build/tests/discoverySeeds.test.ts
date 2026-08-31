import { describe, it, expect } from 'vitest';
import { CURATED_SEEDS, SEED_CATEGORIES } from '../lib/discovery/seeds';

describe('CURATED_SEEDS', () => {
  it('contains at least 50 seeds', () => {
    expect(CURATED_SEEDS.length).toBeGreaterThanOrEqual(50);
  });

  it('every seed has a non-empty title', () => {
    for (const seed of CURATED_SEEDS) {
      expect(seed.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('every seed has a non-empty category', () => {
    for (const seed of CURATED_SEEDS) {
      expect(seed.category.trim().length).toBeGreaterThan(0);
    }
  });

  it('every seed has a non-empty rationale', () => {
    for (const seed of CURATED_SEEDS) {
      expect(seed.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate titles', () => {
    const titles = CURATED_SEEDS.map((s) => s.title.toLowerCase());
    const unique = new Set(titles);
    expect(unique.size).toBe(titles.length);
  });

  it('every title is between 10 and 100 characters', () => {
    for (const seed of CURATED_SEEDS) {
      expect(seed.title.length).toBeGreaterThanOrEqual(10);
      expect(seed.title.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('SEED_CATEGORIES', () => {
  it('contains at least 5 distinct categories', () => {
    expect(SEED_CATEGORIES.length).toBeGreaterThanOrEqual(5);
  });

  it('is sorted alphabetically', () => {
    const sorted = [...SEED_CATEGORIES].sort();
    expect(SEED_CATEGORIES).toEqual(sorted);
  });

  it('every category has at least 3 seeds', () => {
    for (const category of SEED_CATEGORIES) {
      const count = CURATED_SEEDS.filter((s) => s.category === category).length;
      expect(count, `category '${category}' has ${count} seeds`).toBeGreaterThanOrEqual(3);
    }
  });
});
