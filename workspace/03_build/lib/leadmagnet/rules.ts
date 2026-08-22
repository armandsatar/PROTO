import type { LeadMagnetType } from './types';

// Decision 11: same cap value as Step 4, but its own copy — no cross-phase import,
// consistent with the build plan's decoupling principle.
export const RECONSIDER_CAP = 5;

export function hasReachedReconsiderCap(reconsiderCount: number): boolean {
  return reconsiderCount >= RECONSIDER_CAP;
}

export type StalenessReason = 'title_changed' | 'format_changed' | null;

/**
 * §1.6's dual staleness check — Step 5 has two upstream dependencies (title AND
 * confirmed format), unlike Step 4's one. Title takes priority when both have
 * technically diverged: if the title changed, Step 4's own state would already be
 * cascading too, so title_changed is the more accurate root-cause reason to log.
 */
export function detectStalenessReason(
  recommendation: { titleCandidateId: string; formatRecommendationId: string },
  current: { selectedCandidateId: string | null; currentFormatRecommendationId: string | null },
): StalenessReason {
  if (recommendation.titleCandidateId !== current.selectedCandidateId) {
    return 'title_changed';
  }
  if (recommendation.formatRecommendationId !== current.currentFormatRecommendationId) {
    return 'format_changed';
  }
  return null;
}

/**
 * Mirrors the DB's CHECK constraints (migration 0003) in application code, so a bad
 * call fails fast with a clear message instead of a raw Postgres constraint error.
 */
export function assertValidConfirmation(suitable: boolean, type: LeadMagnetType | null): void {
  if (!suitable && type !== null) {
    throw new Error('confirmedType must be null when confirmedSuitable is false');
  }
  if (suitable && type === null) {
    throw new Error('confirmedType is required when confirmedSuitable is true');
  }
}

/**
 * §3.2's 5-scenario override table, collapsed into one comparison: an override is
 * either a flip on the suitable axis, or (when both agree suitable=true) a different
 * type. When both agree suitable=false, type is always null on both sides — no
 * override possible on that axis in that case.
 */
export function computeIsOverride(
  recommended: { suitable: boolean; type: LeadMagnetType | null },
  confirmed: { suitable: boolean; type: LeadMagnetType | null },
): boolean {
  if (recommended.suitable !== confirmed.suitable) return true;
  if (confirmed.suitable && recommended.type !== confirmed.type) return true;
  return false;
}
