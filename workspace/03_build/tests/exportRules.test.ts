import { describe, it, expect } from 'vitest';
import {
  isTitleStale,
  isFormatStale,
  isContentBuildStale,
  isCoverStale,
  detectDocumentStalenessReason,
  isPageCountWithinSanityBand,
  findBlankPageIndices,
} from '../lib/export/rules';

describe('document-level staleness checks', () => {
  it('each isXStale function detects a mismatch', () => {
    expect(isTitleStale('a', 'b')).toBe(true);
    expect(isTitleStale('a', 'a')).toBe(false);
    expect(isFormatStale('a', 'b')).toBe(true);
    expect(isContentBuildStale('t1', 't2')).toBe(true);
    expect(isCoverStale('gen-1', 'gen-2')).toBe(true);
    expect(isCoverStale(null, null)).toBe(false);
  });
});

const baseState = {
  titleCandidateId: 'title-1',
  formatRecommendationId: 'format-1',
  contentBuildConfirmedAt: '2026-01-01T00:00:00Z',
  coverGenerationId: 'cover-gen-1',
};
const baseCurrent = {
  selectedCandidateId: 'title-1',
  currentFormatRecommendationId: 'format-1',
  contentBuildSnapshotAt: '2026-01-01T00:00:00Z',
  currentCoverGenerationId: 'cover-gen-1',
};

describe('detectDocumentStalenessReason — 4-way precedence, per format', () => {
  it('returns null when nothing is stale', () => {
    expect(detectDocumentStalenessReason(baseState, baseCurrent)).toBeNull();
  });

  it('precedence: title > format > content bodies > cover', () => {
    expect(detectDocumentStalenessReason(baseState, { ...baseCurrent, selectedCandidateId: 'title-2', currentFormatRecommendationId: 'format-2' })).toBe('title_changed');
    expect(detectDocumentStalenessReason(baseState, { ...baseCurrent, currentFormatRecommendationId: 'format-2', contentBuildSnapshotAt: '2099-01-01T00:00:00Z' })).toBe('format_changed');
    expect(detectDocumentStalenessReason(baseState, { ...baseCurrent, contentBuildSnapshotAt: '2099-01-01T00:00:00Z', currentCoverGenerationId: 'cover-gen-2' })).toBe(
      'content_build_changed',
    );
    expect(detectDocumentStalenessReason(baseState, { ...baseCurrent, currentCoverGenerationId: 'cover-gen-2' })).toBe('cover_changed');
  });

  it('a null live content-build snapshot skips that check rather than false-triggering', () => {
    expect(detectDocumentStalenessReason(baseState, { ...baseCurrent, contentBuildSnapshotAt: null })).toBeNull();
  });
});

describe('isPageCountWithinSanityBand', () => {
  it('accepts a reasonable page count for a given word count', () => {
    expect(isPageCountWithinSanityBand(3000, 8)).toBe(true);
  });

  it('rejects a catastrophically low page count (a broken render collapsing everything)', () => {
    expect(isPageCountWithinSanityBand(30000, 3)).toBe(false);
  });

  it('rejects a wildly high page count for the given word count', () => {
    expect(isPageCountWithinSanityBand(500, 50)).toBe(false);
  });

  it('a zero word count still requires at least 1 page', () => {
    expect(isPageCountWithinSanityBand(0, 1)).toBe(true);
    expect(isPageCountWithinSanityBand(0, 0)).toBe(false);
  });
});

describe('findBlankPageIndices', () => {
  it('finds blank pages by index', () => {
    expect(findBlankPageIndices(['real content', '   ', 'more content', ''])).toEqual([1, 3]);
  });

  it('returns an empty array when no pages are blank', () => {
    expect(findBlankPageIndices(['a', 'b', 'c'])).toEqual([]);
  });
});
