import type { FormatType, SubtopicDepth, SubtopicSnapshot, WordCountRange } from './types';

// Decision 6/22: word-count-by-format×depth table. Only the ebook "deep" cell is
// grounded in real research (short-format-ebook chapter-length practice: 1,000-2,000
// words/chapter, sub-800-word chapters read as insubstantial); every other cell is a
// heuristic default scaled from that anchor, approved as a working default and flagged
// for follow-up research once real generated content exists to test against (phase6
// §10) — same "approve now, tune later" treatment Step 7 gave its own count table.
const WORD_COUNT_TABLE: Record<FormatType, Record<SubtopicDepth, WordCountRange>> = {
  tracker: {
    shallow: { min: 50, max: 150 },
    medium: { min: 150, max: 300 },
    deep: { min: 300, max: 450 },
  },
  workbook: {
    shallow: { min: 100, max: 200 },
    medium: { min: 200, max: 400 },
    deep: { min: 400, max: 700 },
  },
  ebook: {
    shallow: { min: 250, max: 500 },
    medium: { min: 500, max: 1000 },
    deep: { min: 1000, max: 2000 },
  },
  quiz: {
    shallow: { min: 75, max: 150 },
    medium: { min: 150, max: 300 },
    deep: { min: 300, max: 500 },
  },
};

export function wordCountTargetForFormatAndDepth(format: FormatType, depth: SubtopicDepth): WordCountRange {
  return WORD_COUNT_TABLE[format][depth];
}

// Decision 24: tolerance band around the computed target — accept if within 50%-150%
// of the range's bounds, a starting point (not empirically tuned) given LLM prose
// length is inherently imprecise. Own copy, no cross-phase import.
export const LENGTH_TOLERANCE_LOWER_MULTIPLIER = 0.5;
export const LENGTH_TOLERANCE_UPPER_MULTIPLIER = 1.5;

export function meetsLengthTolerance(wordCount: number, target: WordCountRange): boolean {
  const lowerBound = target.min * LENGTH_TOLERANCE_LOWER_MULTIPLIER;
  const upperBound = target.max * LENGTH_TOLERANCE_UPPER_MULTIPLIER;
  return wordCount >= lowerBound && wordCount <= upperBound;
}

// Decision 14 (whole-document regenerate cap), same number as every prior phase, own copy.
export const REGENERATE_CAP = 5;

export function hasReachedRegenerateCap(regenerateCount: number): boolean {
  return regenerateCount >= REGENERATE_CAP;
}

// Decision 11: three document-level staleness dependencies (title, format, map), each
// a soft check, own copies of the exact FK-equality/timestamp-comparison technique
// established in lib/subtopics/rules.ts — no cross-phase import, per the established
// decoupling convention.
export function isTitleStale(buildTitleCandidateId: string, projectSelectedCandidateId: string | null): boolean {
  return buildTitleCandidateId !== projectSelectedCandidateId;
}

export function isFormatStale(buildFormatRecommendationId: string, projectCurrentFormatRecommendationId: string | null): boolean {
  return buildFormatRecommendationId !== projectCurrentFormatRecommendationId;
}

export function isMapStale(buildSnapshotAt: string, mapUpdatedAt: string): boolean {
  return buildSnapshotAt !== mapUpdatedAt;
}

export type DocumentStalenessReason = 'title_changed' | 'format_changed' | 'transformation_map_changed' | null;

/**
 * Mirrors lib/subtopics/rules.ts's detectStalenessReason exactly (title > format > map
 * precedence) — same technique, own copy. This is the document-level half of Step 8's
 * two-tier staleness model; see isSubtopicContentStale below for the per-row half,
 * which is deliberately NOT folded into this single reason (phase6 §7.4 — a document
 * can be document-level-fresh but have individual stale rows).
 */
export function detectDocumentStalenessReason(
  build: { titleCandidateId: string; formatRecommendationId: string; transformationMapSnapshotAt: string },
  current: {
    selectedCandidateId: string | null;
    currentFormatRecommendationId: string | null;
    transformationMapUpdatedAt: string | null;
  },
): DocumentStalenessReason {
  if (isTitleStale(build.titleCandidateId, current.selectedCandidateId)) return 'title_changed';
  if (isFormatStale(build.formatRecommendationId, current.currentFormatRecommendationId)) return 'format_changed';
  if (current.transformationMapUpdatedAt !== null && isMapStale(build.transformationMapSnapshotAt, current.transformationMapUpdatedAt)) {
    return 'transformation_map_changed';
  }
  return null;
}

/**
 * Decision 11's new per-row detection granularity (phase6 §7.4): a subtopic_contents
 * row is stale if the LIVE subtopics row it belongs to no longer matches the frozen
 * subtopic_snapshot that was actually used to generate its content — a document-wide
 * flag would over-warn on every unrelated subtopic when only one was hand-edited.
 */
export function isSubtopicContentStale(snapshot: SubtopicSnapshot, currentSubtopic: SubtopicSnapshot): boolean {
  return snapshot.title !== currentSubtopic.title || snapshot.description !== currentSubtopic.description || snapshot.depth !== currentSubtopic.depth;
}
