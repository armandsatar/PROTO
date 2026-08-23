import type { FormatType, TargetCountRange } from './types';

// Decision 2: target subtopic count per format. Quiz was re-researched with real
// citations on 2026-08-23 (phase5-requirements.md §2.2) after the SME's first draft
// range had zero citation support; the other three ranges carried through unchanged.
const TARGET_COUNT_BY_FORMAT: Record<FormatType, TargetCountRange> = {
  tracker: { min: 5, max: 8 },
  workbook: { min: 10, max: 15 },
  ebook: { min: 8, max: 12 },
  quiz: { min: 4, max: 6 },
};

export function targetCountForFormat(format: FormatType): TargetCountRange {
  return TARGET_COUNT_BY_FORMAT[format];
}

// Decision 18: minimum description length — shorter than Step 6's 30, since these are
// meant to be brief. Own copy, no cross-phase import (decoupling principle).
export const MIN_DESCRIPTION_LENGTH = 20;

export function meetsMinLength(value: string): boolean {
  return value.length >= MIN_DESCRIPTION_LENGTH;
}

// Decision 18: near-duplicate title threshold, word-overlap ratio > 0.8 (build plan).
export const NEAR_DUPLICATE_THRESHOLD = 0.8;

function normalizeToWordSet(title: string): Set<string> {
  const normalized = title.toLowerCase().replace(/[^\w\s]/g, '');
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

/**
 * overlap = |A ∩ B| / min(|A|, |B|) — divides by the SHORTER title's word count, not
 * the union, so a short title fully contained in a longer one ("Budget Basics" vs.
 * "Budget Basics for Beginners") still scores as a strong near-duplicate rather than
 * being diluted by the longer title's extra words.
 */
export function wordOverlapRatio(titleA: string, titleB: string): number {
  const setA = normalizeToWordSet(titleA);
  const setB = normalizeToWordSet(titleB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersectionCount = 0;
  for (const word of setA) {
    if (setB.has(word)) intersectionCount++;
  }
  return intersectionCount / Math.min(setA.size, setB.size);
}

export function isNearDuplicate(titleA: string, titleB: string): boolean {
  return wordOverlapRatio(titleA, titleB) > NEAR_DUPLICATE_THRESHOLD;
}

// Decision 14: whole-list regenerate soft cap. Single-item regenerate is uncapped for
// v1 (decision 14), so no corresponding function exists for it.
export const REGENERATE_CAP = 5;

export function hasReachedRegenerateCap(regenerateCount: number): boolean {
  return regenerateCount >= REGENERATE_CAP;
}

// Decision 4: three staleness dependencies, all soft. Title and confirmed format are
// FK-pointer comparisons (same mechanism as Step 5's dual check). The transformation
// map has no supersede/version model to point at (a single mutable row, per Step 6),
// so its staleness snapshot is a timestamp comparison instead — a genuinely different
// detection mechanism, not a stylistic variant of the same one.
export function isTitleStale(listTitleCandidateId: string, projectSelectedCandidateId: string | null): boolean {
  return listTitleCandidateId !== projectSelectedCandidateId;
}

export function isFormatStale(
  listFormatRecommendationId: string,
  projectCurrentFormatRecommendationId: string | null,
): boolean {
  return listFormatRecommendationId !== projectCurrentFormatRecommendationId;
}

export function isMapStale(listSnapshotAt: string, mapUpdatedAt: string): boolean {
  return listSnapshotAt !== mapUpdatedAt;
}
