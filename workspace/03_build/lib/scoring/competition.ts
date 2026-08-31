import { scoreToColor } from './colors';
import type { ScoreResult } from './types';

// Bucket tables are §3.1's Competition Y/10 rubric, verbatim. Inverse scale — fewer
// competitors means a higher score, matching green-is-good on both metrics (decision 4).
function exactAngleSubScore(exactAngleMatchCount: number): number {
  if (exactAngleMatchCount === 0) return 10;
  if (exactAngleMatchCount <= 2) return 7;
  if (exactAngleMatchCount <= 5) return 4;
  return 1;
}

function broadVolumeSubScore(totalListingCount: number): number {
  if (totalListingCount < 50) return 10;
  if (totalListingCount <= 500) return 6;
  return 2;
}

const EXACT_ANGLE_WEIGHT = 0.7;
const BROAD_VOLUME_WEIGHT = 0.3;

/**
 * Competition Y/10 — entirely Etsy-sourced in v1 (§3.1; Gumroad/Google-organic
 * permanently out of scope per decisions 1, 10). `exactAngleMatchCount` is the count of
 * top-20 results classified exact-angle (Increment 4); `totalListingCount` is the raw
 * search result count (EtsySearchResult.totalCount) — the "broad-topic volume" signal.
 *
 * `exactAngleMatchPrices` is optional — when provided, captures the prices of
 * exact-angle-match listings for later use by Step 12 (Pricing Recommendation).
 * Phase 1 requirements §2.1: "Etsy price range: worth capturing now since the API
 * call is already being made." Adding this does not change the competition score
 * itself — it's persisted in `detail` for downstream consumption only.
 */
export function computeCompetitionScore(
  exactAngleMatchCount: number,
  totalListingCount: number,
  exactAngleMatchPrices?: number[],
): ScoreResult {
  const exactAngleSub = exactAngleSubScore(exactAngleMatchCount);
  const broadVolumeSub = broadVolumeSubScore(totalListingCount);

  const weighted = exactAngleSub * EXACT_ANGLE_WEIGHT + broadVolumeSub * BROAD_VOLUME_WEIGHT;
  const score = Math.min(10, Math.max(1, Math.round(weighted)));

  return {
    score,
    color: scoreToColor(score),
    detail: {
      exactAngleMatchCount,
      totalListingCount,
      exactAngleSubScore: exactAngleSub,
      broadVolumeSubScore: broadVolumeSub,
      weights: { exactAngle: EXACT_ANGLE_WEIGHT, broadVolume: BROAD_VOLUME_WEIGHT },
      ...(exactAngleMatchPrices ? { exactAngleMatchPrices } : {}),
    },
  };
}
