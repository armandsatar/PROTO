import { describe, it, expect } from 'vitest';
import {
  targetCountForFormat,
  meetsMinLength,
  MIN_DESCRIPTION_LENGTH,
  wordOverlapRatio,
  isNearDuplicate,
  NEAR_DUPLICATE_THRESHOLD,
  hasReachedRegenerateCap,
  REGENERATE_CAP,
  isTitleStale,
  isFormatStale,
  isMapStale,
} from '../lib/subtopics/rules';

describe('targetCountForFormat (decision 2)', () => {
  it('returns the locked range for each format', () => {
    expect(targetCountForFormat('tracker')).toEqual({ min: 5, max: 8 });
    expect(targetCountForFormat('workbook')).toEqual({ min: 10, max: 15 });
    expect(targetCountForFormat('ebook')).toEqual({ min: 8, max: 12 });
    expect(targetCountForFormat('quiz')).toEqual({ min: 4, max: 6 });
  });
});

describe('meetsMinLength (decision 18: 20 chars)', () => {
  it('rejects one character under the boundary', () => {
    expect(meetsMinLength('x'.repeat(MIN_DESCRIPTION_LENGTH - 1))).toBe(false);
  });

  it('accepts exactly the boundary', () => {
    expect(meetsMinLength('x'.repeat(MIN_DESCRIPTION_LENGTH))).toBe(true);
  });

  it('accepts well over the boundary', () => {
    expect(meetsMinLength('x'.repeat(MIN_DESCRIPTION_LENGTH + 50))).toBe(true);
  });
});

describe('wordOverlapRatio / isNearDuplicate (decision 18: > 0.8, min-size divisor)', () => {
  it('scores identical titles at 1.0', () => {
    expect(wordOverlapRatio('Budget Basics', 'Budget Basics')).toBe(1);
    expect(isNearDuplicate('Budget Basics', 'Budget Basics')).toBe(true);
  });

  it('scores a short title fully contained in a longer one at 1.0 (divides by the shorter set, not the union)', () => {
    // A = {budget, basics} (2 words), B = {budget, basics, for, beginners} (4 words).
    // intersection = 2, min(2, 4) = 2, ratio = 2/2 = 1.0 — NOT diluted by B's extra words.
    expect(wordOverlapRatio('Budget Basics', 'Budget Basics for Beginners')).toBe(1);
    expect(isNearDuplicate('Budget Basics', 'Budget Basics for Beginners')).toBe(true);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(wordOverlapRatio('Budget Basics!', 'budget basics')).toBe(1);
  });

  it('scores completely disjoint titles at 0', () => {
    expect(wordOverlapRatio('Setting Up Your Budget', 'Automating Bill Reminders')).toBe(0);
    expect(isNearDuplicate('Setting Up Your Budget', 'Automating Bill Reminders')).toBe(false);
  });

  it('is not a near-duplicate exactly AT the 0.8 threshold (strictly greater than)', () => {
    // A = {one,two,three,four,five}, B = {one,two,three,four,six} — intersection 4,
    // min(5,5) = 5, ratio = 4/5 = 0.8 exactly.
    const ratio = wordOverlapRatio('one two three four five', 'one two three four six');
    expect(ratio).toBe(0.8);
    expect(ratio).toBeLessThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
    expect(isNearDuplicate('one two three four five', 'one two three four six')).toBe(false);
  });

  it('is a near-duplicate just above the 0.8 threshold', () => {
    // A = {one,two,three,four,five} (5 words), B adds a 6th word but still contains
    // all of A's words — intersection 5, min(5,6) = 5, ratio = 5/5 = 1.0.
    expect(isNearDuplicate('one two three four five', 'one two three four five six')).toBe(true);
  });

  it('treats an empty title as never a duplicate', () => {
    expect(wordOverlapRatio('', 'Budget Basics')).toBe(0);
    expect(isNearDuplicate('', 'Budget Basics')).toBe(false);
  });
});

describe('hasReachedRegenerateCap (decision 14: cap of 5, whole-list only)', () => {
  it('is false below the cap, true at and above it', () => {
    expect(hasReachedRegenerateCap(0)).toBe(false);
    expect(hasReachedRegenerateCap(REGENERATE_CAP - 1)).toBe(false);
    expect(hasReachedRegenerateCap(REGENERATE_CAP)).toBe(true);
    expect(hasReachedRegenerateCap(REGENERATE_CAP + 1)).toBe(true);
  });
});

describe('isTitleStale / isFormatStale (decision 4: FK-pointer comparisons)', () => {
  it('title: not stale when ids match, stale on mismatch or null', () => {
    expect(isTitleStale('candidate-1', 'candidate-1')).toBe(false);
    expect(isTitleStale('candidate-1', 'candidate-2')).toBe(true);
    expect(isTitleStale('candidate-1', null)).toBe(true);
  });

  it('format: not stale when ids match, stale on mismatch or null', () => {
    expect(isFormatStale('format-1', 'format-1')).toBe(false);
    expect(isFormatStale('format-1', 'format-2')).toBe(true);
    expect(isFormatStale('format-1', null)).toBe(true);
  });
});

describe('isMapStale (decision 4: timestamp comparison, not an FK)', () => {
  it('is not stale when the snapshot matches the map\'s current updated_at', () => {
    expect(isMapStale('2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')).toBe(false);
  });

  it('is stale when the map has been updated since the snapshot was taken', () => {
    expect(isMapStale('2026-08-23T00:00:00Z', '2026-08-23T01:00:00Z')).toBe(true);
  });
});
