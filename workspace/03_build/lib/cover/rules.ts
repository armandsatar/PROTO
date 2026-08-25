import type { GeminiUsage } from './types';

// Decision 13: official standard-tier rates ($0.50/1M input tokens, $60.00/1M output
// tokens), confirmed at https://ai.google.dev/gemini-api/docs/pricing and against one
// real live call (phase7-requirements.md §4.1: 32 input + 1,485 output tokens ->
// $0.0891 measured). Rounded to 4 decimal places to match the DB's numeric(6,4) column.
const INPUT_RATE_PER_MILLION_TOKENS = 0.5;
const OUTPUT_RATE_PER_MILLION_TOKENS = 60.0;

export function computeCostUsd(usage: GeminiUsage): number {
  const cost =
    (usage.totalInputTokens / 1_000_000) * INPUT_RATE_PER_MILLION_TOKENS +
    (usage.totalOutputTokens / 1_000_000) * OUTPUT_RATE_PER_MILLION_TOKENS;
  return Math.round(cost * 10_000) / 10_000;
}

// Decision 14: regenerate caps, confirmed — 3 initial candidates, 5 edit rounds, per
// project. Decision 15: these are HARD caps — the orchestration layer (runCoverDesign.ts)
// rejects the corresponding action once reached unless acknowledgeAdditionalCost=true
// is passed on that specific call, same acknowledgment-gate shape as acknowledgeOverwrite
// in Steps 7/8, reused here for a cost trigger instead of a content-loss trigger.
export const CANDIDATE_CAP = 3;
export const EDIT_ROUND_CAP = 5;

export function hasReachedCandidateCap(candidateCount: number): boolean {
  return candidateCount >= CANDIDATE_CAP;
}

export function hasReachedEditRoundCap(editRoundCount: number): boolean {
  return editRoundCount >= EDIT_ROUND_CAP;
}

// §7.10: three staleness dependencies, all soft. Title/format via FK-equality (own
// copies of the technique established since Step 5); content-build via timestamp
// comparison with an unconfirmed-fallback, a verbatim reuse of Step 8's own
// loadGenerationContext precedent for the identical cross-phase situation.
export function isTitleStale(coverTitleCandidateId: string, projectSelectedCandidateId: string | null): boolean {
  return coverTitleCandidateId !== projectSelectedCandidateId;
}

export function isFormatStale(coverFormatRecommendationId: string, projectCurrentFormatRecommendationId: string | null): boolean {
  return coverFormatRecommendationId !== projectCurrentFormatRecommendationId;
}

export function isContentBuildStale(coverContentBuildConfirmedAt: string, currentContentBuildSnapshotAt: string): boolean {
  return coverContentBuildConfirmedAt !== currentContentBuildSnapshotAt;
}

export type DocumentStalenessReason = 'title_changed' | 'format_changed' | 'content_build_changed' | null;

/**
 * Precedence title > format > content-build, same ordering convention established
 * since Step 5 and continued through detectDocumentStalenessReason in Steps 7/8.
 */
export function detectDocumentStalenessReason(
  cover: { titleCandidateId: string; formatRecommendationId: string; contentBuildConfirmedAt: string },
  current: {
    selectedCandidateId: string | null;
    currentFormatRecommendationId: string | null;
    contentBuildSnapshotAt: string | null;
  },
): DocumentStalenessReason {
  if (isTitleStale(cover.titleCandidateId, current.selectedCandidateId)) return 'title_changed';
  if (isFormatStale(cover.formatRecommendationId, current.currentFormatRecommendationId)) return 'format_changed';
  if (current.contentBuildSnapshotAt !== null && isContentBuildStale(cover.contentBuildConfirmedAt, current.contentBuildSnapshotAt)) {
    return 'content_build_changed';
  }
  return null;
}
