import { RECONSIDER_CAP } from './types';

export { RECONSIDER_CAP };

export function hasReachedReconsiderCap(reconsiderCount: number): boolean {
  return reconsiderCount >= RECONSIDER_CAP;
}

/**
 * §7.2's lazy staleness detection. Step 12 has 3 independent staleness
 * dependencies (one more than Step 5's 2, two more than Step 4's 1):
 *
 * 1. Title candidate ID mismatch (title changed via Step 2/3)
 * 2. Format recommendation ID mismatch (format changed via Step 4)
 * 3. Export page count changed (export regenerated with different depth)
 *
 * Each is checked independently; any single mismatch makes the pricing stale.
 */
export function isPricingStale(
  snapshot: {
    titleCandidateId: string;
    formatRecommendationId: string;
    exportPageCountSnapshot: number;
  },
  current: {
    selectedCandidateId: string | null;
    currentFormatRecommendationId: string | null;
    currentExportPageCount: number | null;
  },
): { isStale: boolean; staleReason: 'title_changed' | 'format_changed' | 'export_changed' | null } {
  // Precedence: title > format > export (pipeline order, §7.2)
  if (snapshot.titleCandidateId !== current.selectedCandidateId) {
    return { isStale: true, staleReason: 'title_changed' };
  }
  if (snapshot.formatRecommendationId !== current.currentFormatRecommendationId) {
    return { isStale: true, staleReason: 'format_changed' };
  }
  if (current.currentExportPageCount !== null && snapshot.exportPageCountSnapshot !== current.currentExportPageCount) {
    return { isStale: true, staleReason: 'export_changed' };
  }
  return { isStale: false, staleReason: null };
}

/**
 * Override detection: confirmed_price ≠ recommended_price.
 * Continuous-value comparison (not enum like Step 4).
 */
export function computeIsOverride(recommendedPrice: number, confirmedPrice: number): boolean {
  return recommendedPrice !== confirmedPrice;
}

export function computePlatformIsOverride(suggestedPrice: number, confirmedPrice: number): boolean {
  return suggestedPrice !== confirmedPrice;
}
