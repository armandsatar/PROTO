import { describe, it, expect } from 'vitest';
import {
  checkHardLimits,
  meetsSoftTargets,
  hasReachedRegenerateCap,
  REGENERATE_CAP,
  isTitleStale,
  isFormatStale,
  isMapStale,
  isSubtopicsListStale,
  isContentBuildStale,
  isCoverLookStale,
  detectDocumentStalenessReason,
  isNarrativeStale,
} from '../lib/copywriting/rules';

describe('checkHardLimits', () => {
  it('flags an Etsy title over 140 chars', () => {
    const result = checkHardLimits('etsy', { title: 'x'.repeat(141), body: 'desc', platformFields: {} });
    expect(result.status).toBe('exceeds_limit');
    expect(result.violations[0]).toContain('140-char');
  });

  it('passes an Etsy title at exactly 140 chars', () => {
    const result = checkHardLimits('etsy', { title: 'x'.repeat(140), body: 'desc', platformFields: {} });
    expect(result.status).toBe('within_limit');
  });

  it('flags too many Etsy tags and an over-length tag', () => {
    const result = checkHardLimits('etsy', {
      title: 'ok',
      body: 'desc',
      platformFields: { tags: [...Array(14).fill('tag'), 'x'.repeat(21)] },
    });
    expect(result.status).toBe('exceeds_limit');
    expect(result.violations.some((v) => v.includes('15 tags'))).toBe(true);
    expect(result.violations.some((v) => v.includes('21 chars'))).toBe(true);
  });

  it('flags an Instagram caption over 2200 chars (no title field at all)', () => {
    const result = checkHardLimits('instagram', { title: null, body: 'x'.repeat(2201), platformFields: {} });
    expect(result.status).toBe('exceeds_limit');
  });

  it('flags a Pinterest title or description over its own hard limit independently', () => {
    const overTitle = checkHardLimits('pinterest', { title: 'x'.repeat(101), body: 'ok', platformFields: {} });
    expect(overTitle.status).toBe('exceeds_limit');
    const overBody = checkHardLimits('pinterest', { title: 'ok', body: 'x'.repeat(501), platformFields: {} });
    expect(overBody.status).toBe('exceeds_limit');
  });

  it('never flags StanStore or Whop — decision 5, hard limits deferred and unenforced', () => {
    const stanstore = checkHardLimits('stanstore', { title: 'x'.repeat(10000), body: 'y'.repeat(10000), platformFields: {} });
    expect(stanstore.status).toBe('within_limit');
    const whop = checkHardLimits('whop', { title: 'x'.repeat(10000), body: 'y'.repeat(10000), platformFields: {} });
    expect(whop.status).toBe('within_limit');
  });

  it('never flags Gumroad — no confirmed hard limit at all', () => {
    const result = checkHardLimits('gumroad', { title: 'x'.repeat(10000), body: 'y'.repeat(10000), platformFields: {} });
    expect(result.status).toBe('within_limit');
  });
});

describe('meetsSoftTargets', () => {
  it('is non-blocking guidance — an Etsy title over the 50-char soft target still returns false but is never a hard-limit violation', () => {
    const draft = { title: 'x'.repeat(80), body: 'desc', platformFields: {} };
    expect(meetsSoftTargets('etsy', draft)).toBe(false);
    expect(checkHardLimits('etsy', draft).status).toBe('within_limit');
  });

  it('passes when within soft targets', () => {
    expect(meetsSoftTargets('etsy', { title: 'Short Title', body: 'desc', platformFields: {} })).toBe(true);
  });

  it('platforms with no soft targets configured always pass', () => {
    expect(meetsSoftTargets('gumroad', { title: 'x'.repeat(9999), body: 'y'.repeat(9999), platformFields: {} })).toBe(true);
  });
});

describe('hasReachedRegenerateCap', () => {
  it('matches every prior phase\'s cap of 5', () => {
    expect(REGENERATE_CAP).toBe(5);
    expect(hasReachedRegenerateCap(4)).toBe(false);
    expect(hasReachedRegenerateCap(5)).toBe(true);
  });
});

describe('document-level staleness checks', () => {
  it('each isXStale function detects a mismatch', () => {
    expect(isTitleStale('a', 'b')).toBe(true);
    expect(isTitleStale('a', 'a')).toBe(false);
    expect(isFormatStale('a', 'b')).toBe(true);
    expect(isMapStale('t1', 't2')).toBe(true);
    expect(isSubtopicsListStale('t1', 't2')).toBe(true);
    expect(isContentBuildStale('t1', 't2')).toBe(true);
    expect(isCoverLookStale('look-a', 'look-b')).toBe(true);
  });
});

const baseBuild = {
  titleCandidateId: 'title-1',
  formatRecommendationId: 'format-1',
  transformationMapSnapshotAt: '2026-01-01T00:00:00Z',
  subtopicListConfirmedAt: '2026-01-02T00:00:00Z',
  contentBuildConfirmedAt: '2026-01-03T00:00:00Z',
  coverLookSnapshot: 'look-1',
};
const baseCurrent = {
  selectedCandidateId: 'title-1',
  currentFormatRecommendationId: 'format-1',
  transformationMapUpdatedAt: '2026-01-01T00:00:00Z',
  subtopicListSnapshotAt: '2026-01-02T00:00:00Z',
  contentBuildSnapshotAt: '2026-01-03T00:00:00Z',
  confirmedLookId: 'look-1',
};

describe('detectDocumentStalenessReason — completed 6-way precedence', () => {
  it('returns null when nothing is stale', () => {
    expect(detectDocumentStalenessReason(baseBuild, baseCurrent)).toBeNull();
  });

  it('precedence: title > format > map > subtopics list > content bodies > cover look', () => {
    expect(detectDocumentStalenessReason(baseBuild, { ...baseCurrent, selectedCandidateId: 'title-2', currentFormatRecommendationId: 'format-2' })).toBe('title_changed');
    expect(detectDocumentStalenessReason(baseBuild, { ...baseCurrent, currentFormatRecommendationId: 'format-2', transformationMapUpdatedAt: '2099-01-01T00:00:00Z' })).toBe('format_changed');
    expect(detectDocumentStalenessReason(baseBuild, { ...baseCurrent, transformationMapUpdatedAt: '2099-01-01T00:00:00Z', subtopicListSnapshotAt: '2099-01-01T00:00:00Z' })).toBe(
      'transformation_map_changed',
    );
    expect(detectDocumentStalenessReason(baseBuild, { ...baseCurrent, subtopicListSnapshotAt: '2099-01-01T00:00:00Z', contentBuildSnapshotAt: '2099-01-01T00:00:00Z' })).toBe(
      'subtopics_list_changed',
    );
    expect(detectDocumentStalenessReason(baseBuild, { ...baseCurrent, contentBuildSnapshotAt: '2099-01-01T00:00:00Z', confirmedLookId: 'look-2' })).toBe('content_build_changed');
    expect(detectDocumentStalenessReason(baseBuild, { ...baseCurrent, confirmedLookId: 'look-2' })).toBe('cover_look_changed');
  });

  it('a null live value for map/subtopics/content skips that check rather than false-triggering', () => {
    expect(
      detectDocumentStalenessReason(baseBuild, { ...baseCurrent, transformationMapUpdatedAt: null, subtopicListSnapshotAt: null, contentBuildSnapshotAt: null }),
    ).toBeNull();
  });
});

describe('isNarrativeStale — the new per-row dimension (§8.4)', () => {
  it('flags a platform whose snapshot no longer matches the live narrative', () => {
    expect(isNarrativeStale('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBe(true);
  });

  it('does not flag a platform still matching the live narrative', () => {
    expect(isNarrativeStale('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false);
  });

  it('a never-generated platform (null snapshot) is not flagged stale', () => {
    expect(isNarrativeStale(null, '2026-01-01T00:00:00Z')).toBe(false);
  });
});
