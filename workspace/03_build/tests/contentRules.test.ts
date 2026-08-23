import { describe, it, expect } from 'vitest';
import {
  wordCountTargetForFormatAndDepth,
  meetsLengthTolerance,
  hasReachedRegenerateCap,
  REGENERATE_CAP,
  isTitleStale,
  isFormatStale,
  isMapStale,
  detectDocumentStalenessReason,
  isSubtopicContentStale,
} from '../lib/content/rules';

describe('wordCountTargetForFormatAndDepth (decision 6/22)', () => {
  it('returns the locked table value for every format x depth combination', () => {
    expect(wordCountTargetForFormatAndDepth('tracker', 'shallow')).toEqual({ min: 50, max: 150 });
    expect(wordCountTargetForFormatAndDepth('tracker', 'medium')).toEqual({ min: 150, max: 300 });
    expect(wordCountTargetForFormatAndDepth('tracker', 'deep')).toEqual({ min: 300, max: 450 });
    expect(wordCountTargetForFormatAndDepth('workbook', 'shallow')).toEqual({ min: 100, max: 200 });
    expect(wordCountTargetForFormatAndDepth('workbook', 'medium')).toEqual({ min: 200, max: 400 });
    expect(wordCountTargetForFormatAndDepth('workbook', 'deep')).toEqual({ min: 400, max: 700 });
    expect(wordCountTargetForFormatAndDepth('ebook', 'shallow')).toEqual({ min: 250, max: 500 });
    expect(wordCountTargetForFormatAndDepth('ebook', 'medium')).toEqual({ min: 500, max: 1000 });
    expect(wordCountTargetForFormatAndDepth('ebook', 'deep')).toEqual({ min: 1000, max: 2000 });
    expect(wordCountTargetForFormatAndDepth('quiz', 'shallow')).toEqual({ min: 75, max: 150 });
    expect(wordCountTargetForFormatAndDepth('quiz', 'medium')).toEqual({ min: 150, max: 300 });
    expect(wordCountTargetForFormatAndDepth('quiz', 'deep')).toEqual({ min: 300, max: 500 });
  });
});

describe('meetsLengthTolerance (decision 24: 50%-150% band)', () => {
  const target = { min: 200, max: 400 };

  it('accepts exactly at the target range', () => {
    expect(meetsLengthTolerance(200, target)).toBe(true);
    expect(meetsLengthTolerance(400, target)).toBe(true);
    expect(meetsLengthTolerance(300, target)).toBe(true);
  });

  it('accepts exactly at the tolerance boundary (50% of min, 150% of max)', () => {
    expect(meetsLengthTolerance(100, target)).toBe(true); // 0.5 * 200
    expect(meetsLengthTolerance(600, target)).toBe(true); // 1.5 * 400
  });

  it('rejects just outside the tolerance boundary', () => {
    expect(meetsLengthTolerance(99, target)).toBe(false);
    expect(meetsLengthTolerance(601, target)).toBe(false);
  });
});

describe('hasReachedRegenerateCap (decision 14: cap of 5)', () => {
  it('is false below the cap, true at and above it', () => {
    expect(hasReachedRegenerateCap(0)).toBe(false);
    expect(hasReachedRegenerateCap(REGENERATE_CAP - 1)).toBe(false);
    expect(hasReachedRegenerateCap(REGENERATE_CAP)).toBe(true);
    expect(hasReachedRegenerateCap(REGENERATE_CAP + 1)).toBe(true);
  });
});

describe('isTitleStale / isFormatStale / isMapStale (decision 11: FK/timestamp comparisons)', () => {
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

  it('map: not stale when timestamps match, stale on any mismatch', () => {
    expect(isMapStale('2026-08-23T00:00:00Z', '2026-08-23T00:00:00Z')).toBe(false);
    expect(isMapStale('2026-08-23T00:00:00Z', '2026-08-23T01:00:00Z')).toBe(true);
  });
});

describe('detectDocumentStalenessReason (decision 11: title > format > map precedence)', () => {
  const build = {
    titleCandidateId: 'candidate-1',
    formatRecommendationId: 'format-1',
    transformationMapSnapshotAt: '2026-08-23T00:00:00Z',
  };
  const freshCurrent = {
    selectedCandidateId: 'candidate-1',
    currentFormatRecommendationId: 'format-1',
    transformationMapUpdatedAt: '2026-08-23T00:00:00Z',
  };

  it('is null when nothing has changed', () => {
    expect(detectDocumentStalenessReason(build, freshCurrent)).toBeNull();
  });

  it('reports title_changed when only the title diverges', () => {
    expect(detectDocumentStalenessReason(build, { ...freshCurrent, selectedCandidateId: 'candidate-2' })).toBe('title_changed');
  });

  it('reports format_changed when only the format diverges', () => {
    expect(detectDocumentStalenessReason(build, { ...freshCurrent, currentFormatRecommendationId: 'format-2' })).toBe('format_changed');
  });

  it('reports transformation_map_changed when only the map diverges', () => {
    expect(detectDocumentStalenessReason(build, { ...freshCurrent, transformationMapUpdatedAt: '2026-08-23T01:00:00Z' })).toBe(
      'transformation_map_changed',
    );
  });

  it('prioritizes title over format and map when multiple have diverged', () => {
    expect(
      detectDocumentStalenessReason(build, {
        selectedCandidateId: 'candidate-2',
        currentFormatRecommendationId: 'format-2',
        transformationMapUpdatedAt: '2026-08-23T01:00:00Z',
      }),
    ).toBe('title_changed');
  });

  it('prioritizes format over map when both have diverged but title has not', () => {
    expect(
      detectDocumentStalenessReason(build, {
        ...freshCurrent,
        currentFormatRecommendationId: 'format-2',
        transformationMapUpdatedAt: '2026-08-23T01:00:00Z',
      }),
    ).toBe('format_changed');
  });

  it('skips the map check when the map updated_at is unavailable', () => {
    expect(detectDocumentStalenessReason(build, { ...freshCurrent, transformationMapUpdatedAt: null })).toBeNull();
  });
});

describe('isSubtopicContentStale (decision 11: new per-row detection granularity)', () => {
  const snapshot = { title: 'Setting Up Your Budget', description: 'Covers the baseline setup.', depth: 'medium' as const };

  it('is not stale when the live subtopic matches the frozen snapshot exactly', () => {
    expect(isSubtopicContentStale(snapshot, { ...snapshot })).toBe(false);
  });

  it('is stale when the title has diverged', () => {
    expect(isSubtopicContentStale(snapshot, { ...snapshot, title: 'A Different Title' })).toBe(true);
  });

  it('is stale when the description has diverged', () => {
    expect(isSubtopicContentStale(snapshot, { ...snapshot, description: 'A different description.' })).toBe(true);
  });

  it('is stale when the depth has diverged', () => {
    expect(isSubtopicContentStale(snapshot, { ...snapshot, depth: 'deep' })).toBe(true);
  });
});
