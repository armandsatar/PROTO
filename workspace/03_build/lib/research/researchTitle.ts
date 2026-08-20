import { getEtsyDataSource } from '../data-sources/etsy';
import { classifyExactAngleMatches } from '../ai/classify';
import { computeDemandScore } from '../scoring/demand';
import { computeCompetitionScore } from '../scoring/competition';
import type { ScoreResult } from '../scoring/types';

export interface TitleResearchResult {
  demand: ScoreResult;
  competition: ScoreResult;
  exactAngleMatchListingTitles: string[];
}

// §2.1: top N=20 results are what get classified/scored against.
const EXACT_ANGLE_SEARCH_LIMIT = 20;

/**
 * Researches and scores a single title candidate: Etsy search -> exact-angle
 * classification -> Demand/Competition scores. Used identically for the original title
 * and each of the 3 generated variants (§3.2 — every candidate gets its own full pass).
 */
export async function researchTitle(title: string): Promise<TitleResearchResult> {
  const etsy = getEtsyDataSource();
  const keywords = title.trim().split(/\s+/).filter(Boolean);
  const searchResult = await etsy.searchListings(keywords, { limit: EXACT_ANGLE_SEARCH_LIMIT });

  const classifications = await classifyExactAngleMatches(title, searchResult.listings);
  const exactAngleListings = searchResult.listings.filter((listing) =>
    classifications.some((c) => c.listingId === listing.listingId && c.label === 'exact_angle'),
  );

  const demand = computeDemandScore(exactAngleListings);
  const competition = computeCompetitionScore(exactAngleListings.length, searchResult.totalCount);

  return {
    demand,
    competition,
    exactAngleMatchListingTitles: exactAngleListings.map((l) => l.title),
  };
}
