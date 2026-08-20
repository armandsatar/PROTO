import type { EtsyListing } from '../data-sources/etsy';
import { scoreToColor } from './colors';
import type { ScoreResult } from './types';

// Bucket tables are §3.1's Demand X/10 rubric, verbatim. Thresholds are PROPOSED
// defaults (decision 13 — approved to ship, tune later once real Etsy data comes in).
function favorersSubScore(avgFavorers: number): number {
  if (avgFavorers < 5) return 1;
  if (avgFavorers <= 20) return 4;
  if (avgFavorers <= 75) return 7;
  return 10;
}

function viewsSubScore(avgViews: number): number {
  if (avgViews < 100) return 1;
  if (avgViews <= 500) return 4;
  if (avgViews <= 2000) return 7;
  return 10;
}

function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

const FAVORERS_WEIGHT = 0.6;
const VIEWS_WEIGHT = 0.4;

/**
 * Demand X/10 — v1 Etsy-only proxy (§3.1, §2.1 known limitation: correlated with
 * Competition since both derive from the same Etsy pull). Input is the subset of
 * search results already classified as exact-angle matches (top 20) — classification
 * itself is Increment 4's job, not this function's.
 */
export function computeDemandScore(exactAngleMatchListings: EtsyListing[]): ScoreResult {
  const avgFavorers = average(exactAngleMatchListings.map((l) => l.numFavorers));
  const avgViews = average(exactAngleMatchListings.map((l) => l.views));

  const favorersSub = favorersSubScore(avgFavorers);
  const viewsSub = viewsSubScore(avgViews);

  const weighted = favorersSub * FAVORERS_WEIGHT + viewsSub * VIEWS_WEIGHT;
  const score = Math.min(10, Math.max(1, Math.round(weighted)));

  return {
    score,
    color: scoreToColor(score),
    detail: {
      avgFavorers,
      avgViews,
      favorersSubScore: favorersSub,
      viewsSubScore: viewsSub,
      weights: { favorers: FAVORERS_WEIGHT, views: VIEWS_WEIGHT },
      exactAngleMatchListingCount: exactAngleMatchListings.length,
    },
  };
}
