import { describe, it, expect } from 'vitest';
import {
  computeCostUsd,
  hasReachedCandidateCap,
  hasReachedEditRoundCap,
  CANDIDATE_CAP,
  EDIT_ROUND_CAP,
  isTitleStale,
  isFormatStale,
  isContentBuildStale,
  detectDocumentStalenessReason,
} from '../lib/cover/rules';

describe('computeCostUsd (decision 13: official rates, verified against a real live call)', () => {
  it('matches the real measured cost from the live connector verification (32 input, 1,485 output -> $0.0891)', () => {
    expect(computeCostUsd({ totalInputTokens: 32, totalOutputTokens: 1485 })).toBe(0.0891);
  });

  it('computes zero cost for zero usage', () => {
    expect(computeCostUsd({ totalInputTokens: 0, totalOutputTokens: 0 })).toBe(0);
  });

  it('rounds to 4 decimal places', () => {
    // 1 input token: 1/1e6 * 0.5 = 0.0000005 -> rounds to 0.0000, not a false-precision leftover
    expect(computeCostUsd({ totalInputTokens: 1, totalOutputTokens: 0 })).toBe(0);
    // 1120 output tokens (the pure image-modality portion from the live call): 1120/1e6*60 = 0.0672
    expect(computeCostUsd({ totalInputTokens: 0, totalOutputTokens: 1120 })).toBe(0.0672);
  });
});

describe('hasReachedCandidateCap / hasReachedEditRoundCap (decision 14: 3/5, decision 15: hard)', () => {
  it('candidate cap is false below 3, true at and above it', () => {
    expect(hasReachedCandidateCap(0)).toBe(false);
    expect(hasReachedCandidateCap(CANDIDATE_CAP - 1)).toBe(false);
    expect(hasReachedCandidateCap(CANDIDATE_CAP)).toBe(true);
    expect(hasReachedCandidateCap(CANDIDATE_CAP + 1)).toBe(true);
  });

  it('edit-round cap is false below 5, true at and above it', () => {
    expect(hasReachedEditRoundCap(0)).toBe(false);
    expect(hasReachedEditRoundCap(EDIT_ROUND_CAP - 1)).toBe(false);
    expect(hasReachedEditRoundCap(EDIT_ROUND_CAP)).toBe(true);
    expect(hasReachedEditRoundCap(EDIT_ROUND_CAP + 1)).toBe(true);
  });
});

describe('isTitleStale / isFormatStale / isContentBuildStale (§7.10)', () => {
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

  it('content-build: not stale when timestamps match, stale on any mismatch', () => {
    expect(isContentBuildStale('2026-08-25T00:00:00Z', '2026-08-25T00:00:00Z')).toBe(false);
    expect(isContentBuildStale('2026-08-25T00:00:00Z', '2026-08-25T01:00:00Z')).toBe(true);
  });
});

describe('detectDocumentStalenessReason (§7.10: title > format > content-build precedence)', () => {
  const cover = {
    titleCandidateId: 'candidate-1',
    formatRecommendationId: 'format-1',
    contentBuildConfirmedAt: '2026-08-25T00:00:00Z',
  };
  const freshCurrent = {
    selectedCandidateId: 'candidate-1',
    currentFormatRecommendationId: 'format-1',
    contentBuildSnapshotAt: '2026-08-25T00:00:00Z',
  };

  it('is null when nothing has changed', () => {
    expect(detectDocumentStalenessReason(cover, freshCurrent)).toBeNull();
  });

  it('reports title_changed when only the title diverges', () => {
    expect(detectDocumentStalenessReason(cover, { ...freshCurrent, selectedCandidateId: 'candidate-2' })).toBe('title_changed');
  });

  it('reports format_changed when only the format diverges', () => {
    expect(detectDocumentStalenessReason(cover, { ...freshCurrent, currentFormatRecommendationId: 'format-2' })).toBe('format_changed');
  });

  it('reports content_build_changed when only the content build diverges', () => {
    expect(detectDocumentStalenessReason(cover, { ...freshCurrent, contentBuildSnapshotAt: '2026-08-25T01:00:00Z' })).toBe(
      'content_build_changed',
    );
  });

  it('prioritizes title over format and content-build when multiple have diverged', () => {
    expect(
      detectDocumentStalenessReason(cover, {
        selectedCandidateId: 'candidate-2',
        currentFormatRecommendationId: 'format-2',
        contentBuildSnapshotAt: '2026-08-25T01:00:00Z',
      }),
    ).toBe('title_changed');
  });

  it('prioritizes format over content-build when both diverged but title has not', () => {
    expect(
      detectDocumentStalenessReason(cover, {
        ...freshCurrent,
        currentFormatRecommendationId: 'format-2',
        contentBuildSnapshotAt: '2026-08-25T01:00:00Z',
      }),
    ).toBe('format_changed');
  });

  it('skips the content-build check when the snapshot is unavailable', () => {
    expect(detectDocumentStalenessReason(cover, { ...freshCurrent, contentBuildSnapshotAt: null })).toBeNull();
  });
});
