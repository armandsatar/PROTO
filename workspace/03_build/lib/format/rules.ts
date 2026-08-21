import type { FormatType, DeliveryMode } from './types';

// Decision 8: soft cap on Reconsider regenerations per project.
export const RECONSIDER_CAP = 5;

export function hasReachedReconsiderCap(reconsiderCount: number): boolean {
  return reconsiderCount >= RECONSIDER_CAP;
}

/**
 * §1.6's lazy staleness detection: a format_recommendations row is stale once the
 * project's selected title candidate no longer matches the one it was generated
 * against. Deliberately reactive (checked on load/action), not eagerly pushed from
 * Step 2's "Change Selection" code — see the Step 4 build plan's rationale.
 */
export function isRecommendationStale(
  recommendationTitleCandidateId: string,
  projectSelectedCandidateId: string | null,
): boolean {
  return recommendationTitleCandidateId !== projectSelectedCandidateId;
}

/**
 * §1.4's hard business rule, enforced fail-fast before ever reaching the DB's CHECK
 * constraint: ebook must have a null delivery mode; every other format requires one
 * (the UI always shows the toggle for non-ebook formats, so a null there means the
 * caller skipped a required field, not a legitimate "not applicable" case like ebook).
 */
export function assertValidConfirmation(format: FormatType, deliveryMode: DeliveryMode | null): void {
  if (format === 'ebook' && deliveryMode !== null) {
    throw new Error('ebook cannot have a delivery mode');
  }
  if (format !== 'ebook' && deliveryMode === null) {
    throw new Error(`confirmedDeliveryMode is required for format "${format}"`);
  }
}

/**
 * §3.2: is_override is true when what the user confirmed differs from what PROTO
 * recommended, on either axis.
 */
export function computeIsOverride(
  recommended: { format: FormatType; deliveryMode: DeliveryMode | null },
  confirmed: { format: FormatType; deliveryMode: DeliveryMode | null },
): boolean {
  return recommended.format !== confirmed.format || recommended.deliveryMode !== confirmed.deliveryMode;
}
