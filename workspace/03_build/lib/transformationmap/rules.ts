// Decision 13: minimum content length per field — catches degenerate stub output
// ("Feels bad." -> "Feels good.") without judging tone or quality beyond length.
// Approved as a default, same "approve now, tune once real output is seen" treatment
// every prior phase's arbitrary thresholds got.
export const MIN_CONTENT_LENGTH = 30;

export function meetsMinLength(value: string): boolean {
  return value.length >= MIN_CONTENT_LENGTH;
}

// Decision 9: same cap value as Steps 4/5's reconsider caps, own copy (no cross-phase
// import). Named "regenerate" here to match this phase's actual action name.
export const REGENERATE_CAP = 5;

export function hasReachedRegenerateCap(regenerateCount: number): boolean {
  return regenerateCount >= REGENERATE_CAP;
}

/**
 * Decision 7: single upstream dependency (title only) — simpler than Step 5's dual
 * check, since format and lead magnet are deliberately excluded (phase4 §3.1/§4).
 */
export function isTitleStale(mapTitleCandidateId: string, projectSelectedCandidateId: string | null): boolean {
  return mapTitleCandidateId !== projectSelectedCandidateId;
}
