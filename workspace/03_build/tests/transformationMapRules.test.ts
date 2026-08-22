import { describe, it, expect } from 'vitest';
import { meetsMinLength, MIN_CONTENT_LENGTH, hasReachedRegenerateCap, REGENERATE_CAP, isTitleStale } from '../lib/transformationmap/rules';

describe('meetsMinLength (decision 13: 30 chars)', () => {
  it('rejects one character under the boundary', () => {
    expect(meetsMinLength('x'.repeat(MIN_CONTENT_LENGTH - 1))).toBe(false);
  });

  it('accepts exactly the boundary', () => {
    expect(meetsMinLength('x'.repeat(MIN_CONTENT_LENGTH))).toBe(true);
  });

  it('accepts well over the boundary', () => {
    expect(meetsMinLength('x'.repeat(MIN_CONTENT_LENGTH + 50))).toBe(true);
  });
});

describe('hasReachedRegenerateCap (decision 9: cap of 5)', () => {
  it('is false below the cap, true at and above it', () => {
    expect(hasReachedRegenerateCap(0)).toBe(false);
    expect(hasReachedRegenerateCap(REGENERATE_CAP - 1)).toBe(false);
    expect(hasReachedRegenerateCap(REGENERATE_CAP)).toBe(true);
    expect(hasReachedRegenerateCap(REGENERATE_CAP + 1)).toBe(true);
  });
});

describe('isTitleStale (decision 7: single title-only dependency)', () => {
  it('is not stale when the title candidate ids match', () => {
    expect(isTitleStale('candidate-1', 'candidate-1')).toBe(false);
  });

  it('is stale when the project has selected a different candidate since', () => {
    expect(isTitleStale('candidate-1', 'candidate-2')).toBe(true);
  });

  it('is stale when the project has no selected candidate at all', () => {
    expect(isTitleStale('candidate-1', null)).toBe(true);
  });
});
