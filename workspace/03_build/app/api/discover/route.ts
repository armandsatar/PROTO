import { NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/discovery/runDiscovery';
import { CURATED_SEEDS } from '@/lib/discovery/seeds';
import type { CuratedSeed } from '@/lib/discovery/types';

export async function POST(request: Request) {
  const body = await request.json();
  const { seeds } = body as { seeds: CuratedSeed[] };

  if (!Array.isArray(seeds) || seeds.length === 0) {
    return NextResponse.json({ error: 'seeds array is required' }, { status: 400 });
  }

  // Map incoming seeds: if they have a category, use as-is; otherwise look up from curated library
  const resolvedSeeds: CuratedSeed[] = seeds.map((s) => {
    if (s.category) return s;
    const curated = CURATED_SEEDS.find((c) => c.title === s.title);
    return curated ?? { title: s.title, category: 'uncategorized', rationale: s.rationale ?? '' };
  });

  const result = await runDiscovery({ seeds: resolvedSeeds, concurrency: 6 });

  return NextResponse.json(result);
}
