import { hasReachedCandidateCap, hasReachedEditRoundCap, CANDIDATE_CAP, EDIT_ROUND_CAP } from './rules';
import { isValidLookId } from './templates';

/**
 * §8's guardrail layer — honest about what's actually checkable for this phase: far
 * less than any prior phase (existence/state-machine checks only, no image-quality
 * judgment — that gap is real and intentional, the whole reason the spec makes
 * approval mandatory and manual).
 */

/** §8 rule 1: the one deterministic hard rule this phase has. */
export function assertCanApprove(currentCoverGenerationId: string | null): void {
  if (!currentCoverGenerationId) {
    throw new Error('Cannot approve — no current cover generation exists yet');
  }
}

/** §8 rule 2: reject an invalid pick, caller falls back to the recommended look. */
export function assertValidLookId(lookId: string): void {
  if (!isValidLookId(lookId)) {
    throw new Error(`Invalid look id: "${lookId}" is not in the template registry`);
  }
}

/**
 * §8 rule 3 / decision 15: HARD caps — the first departure from every prior phase's
 * soft-cap-only precedent. Rejected unless the caller passes acknowledgeAdditionalCost
 * on that specific call; not a persistent "unlocked" state.
 */
export function assertCandidateCapNotExceeded(candidateCount: number, acknowledgeAdditionalCost: boolean | undefined): void {
  if (hasReachedCandidateCap(candidateCount) && acknowledgeAdditionalCost !== true) {
    throw new Error(
      `Initial-candidate cap (${CANDIDATE_CAP}) reached for this project — pass acknowledgeAdditionalCost=true to confirm spending more (decision 15)`,
    );
  }
}

export function assertEditRoundCapNotExceeded(editRoundCount: number, acknowledgeAdditionalCost: boolean | undefined): void {
  if (hasReachedEditRoundCap(editRoundCount) && acknowledgeAdditionalCost !== true) {
    throw new Error(
      `Edit-round cap (${EDIT_ROUND_CAP}) reached for this project — pass acknowledgeAdditionalCost=true to confirm spending more (decision 15)`,
    );
  }
}
