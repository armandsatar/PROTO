import type { CuratedSeed, GeneratedSeed, ScoredNiche, DiscoveryResult } from './types';
import { researchTitle } from '../research/researchTitle';

interface RunDiscoveryParams {
  seeds: (CuratedSeed | (GeneratedSeed & { category?: string }))[];
  concurrency?: number;
}

/**
 * Batch-scores seeds via researchTitle(), computes combined scores, extracts
 * enhanced context (market size, examples, price range), and returns sorted
 * results. Ephemeral — nothing persisted (decision 12).
 */
export async function runDiscovery(params: RunDiscoveryParams): Promise<DiscoveryResult> {
  const { seeds, concurrency = 6 } = params;
  const start = Date.now();

  const niches: ScoredNiche[] = [];

  // Process in batches to respect Groq 30 RPM limit (each researchTitle = 1 Groq call)
  for (let i = 0; i < seeds.length; i += concurrency) {
    const batch = seeds.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (seed) => {
        const research = await researchTitle(seed.title);

        const competitionDetail = research.competition.detail as Record<string, unknown>;
        const exactAngleCount = (competitionDetail.exactAngleMatchCount as number) ?? 0;
        const totalCount = (competitionDetail.totalListingCount as number) ?? 0;
        const prices = Array.isArray(competitionDetail.exactAngleMatchPrices)
          ? (competitionDetail.exactAngleMatchPrices as number[]).filter((p) => typeof p === 'number' && p > 0)
          : [];

        const combinedScore = Math.round(((research.demand.score + research.competition.score) / 2) * 10) / 10;

        const niche: ScoredNiche = {
          seed: seed.title,
          rationale: seed.rationale,
          category: 'category' in seed && seed.category ? seed.category : 'uncategorized',
          demand: research.demand,
          competition: research.competition,
          combinedScore,
          marketSize: { exactAngleCount, totalCount },
          exampleListings: research.exactAngleMatchListingTitles.slice(0, 3),
          priceRange: prices.length > 0 ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
        };
        return niche;
      }),
    );
    niches.push(...results);
  }

  // Sort by combined score descending (decision 8)
  niches.sort((a, b) => b.combinedScore - a.combinedScore);

  return {
    niches,
    scoredCount: niches.length,
    elapsedMs: Date.now() - start,
  };
}
