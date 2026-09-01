'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CURATED_SEEDS, SEED_CATEGORIES } from '@/lib/discovery/seeds';
import type { CuratedSeed, ScoredNiche, GeneratedSeed } from '@/lib/discovery/types';
import { ScoreBadge } from '@/components/ScoreBadge';
import { LoadingSpinner } from '@/components/LoadingSpinner';

export default function DiscoverPage() {
  const router = useRouter();

  // Seed selection state
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [generatedSeeds, setGeneratedSeeds] = useState<GeneratedSeed[]>([]);
  const [aiSelected, setAiSelected] = useState(false);

  // AI generation state
  const [showAiSection, setShowAiSection] = useState(false);
  const [aiCount, setAiCount] = useState(20);
  const [generating, setGenerating] = useState(false);

  // Results state
  const [results, setResults] = useState<ScoredNiche[] | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Creating project state
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function getSelectedSeeds(): CuratedSeed[] {
    const curated = CURATED_SEEDS.filter((s) => selectedCategories.has(s.category));
    const ai = aiSelected
      ? generatedSeeds.map((s) => ({ ...s, category: 'ai-generated' }))
      : [];
    return [...curated, ...ai];
  }

  const selectedCount = getSelectedSeeds().length;

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch('/api/discover/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: aiCount }),
      });
      const data = await res.json();
      if (data.seeds) {
        setGeneratedSeeds(data.seeds);
        setAiSelected(true);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleAnalyze() {
    const seeds = getSelectedSeeds();
    if (seeds.length === 0) return;

    setAnalyzing(true);
    setResults(null);
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seeds }),
      });
      const data = await res.json();
      if (data.niches) {
        setResults(data.niches);
        setElapsedMs(data.elapsedMs);
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSelectNiche(niche: ScoredNiche) {
    setCreatingFor(niche.seed);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: niche.seed, rationale: niche.rationale }),
    });
    const data = await res.json();
    if (data.projectId) {
      router.push(`/projects/${data.projectId}`);
    }
    setCreatingFor(null);
  }

  const displayResults = results
    ? showAll
      ? results
      : results.slice(0, 10)
    : null;

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900">Discover Niches</h1>
      <p className="mt-2 text-gray-600">
        Explore validated digital product niches. Select seeds to analyze, then pick one to start a project.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Seed Selection Panel */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">Select Seeds</h2>
            <p className="mt-1 text-sm text-gray-500">Choose categories to analyze.</p>

            <div className="mt-4 space-y-2">
              {SEED_CATEGORIES.map((cat) => {
                const count = CURATED_SEEDS.filter((s) => s.category === cat).length;
                return (
                  <label key={cat} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(cat)}
                      onChange={() => toggleCategory(cat)}
                      className="rounded border-gray-300"
                    />
                    <span className="text-gray-700">
                      {cat.replace(/-/g, ' ')}
                    </span>
                    <span className="text-xs text-gray-400">({count})</span>
                  </label>
                );
              })}
            </div>

            {/* AI-generated seeds */}
            {generatedSeeds.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={aiSelected}
                    onChange={() => setAiSelected(!aiSelected)}
                    className="rounded border-gray-300"
                  />
                  <span className="font-medium text-purple-700">AI-Generated</span>
                  <span className="text-xs text-gray-400">({generatedSeeds.length})</span>
                </label>
              </div>
            )}

            {/* AI generation section */}
            <div className="mt-4 border-t border-gray-200 pt-4">
              {!showAiSection ? (
                <button
                  onClick={() => setShowAiSection(true)}
                  className="text-sm font-medium text-purple-600 hover:text-purple-800"
                >
                  Suggest More Niches (AI)
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    AI suggestions are experimental. Review before analyzing.
                  </p>
                  <div className="flex items-center gap-2">
                    <label htmlFor="aiCount" className="text-sm text-gray-600">Count:</label>
                    <input
                      id="aiCount"
                      type="number"
                      min={10}
                      max={30}
                      value={aiCount}
                      onChange={(e) => setAiCount(Number(e.target.value))}
                      className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="w-full rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {generating ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              )}
            </div>

            {/* Analyze button */}
            <div className="mt-4">
              <button
                onClick={handleAnalyze}
                disabled={selectedCount === 0 || analyzing}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing...' : `Analyze ${selectedCount} Niche${selectedCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          {analyzing && <LoadingSpinner message="Scoring niches via Etsy + Groq..." />}

          {displayResults && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  {results!.length} niches scored in {(elapsedMs / 1000).toFixed(1)}s
                </p>
                {results!.length > 10 && (
                  <button
                    onClick={() => setShowAll(!showAll)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {showAll ? 'Show Top 10' : `Show All ${results!.length} Results`}
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {displayResults.map((niche, i) => (
                  <NicheCard
                    key={i}
                    niche={niche}
                    onSelect={() => handleSelectNiche(niche)}
                    creating={creatingFor === niche.seed}
                  />
                ))}
              </div>
            </div>
          )}

          {!analyzing && !results && (
            <div className="flex h-48 items-center justify-center text-gray-400">
              Select seeds and click Analyze to see scored results.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NicheCard({
  niche,
  onSelect,
  creating,
}: {
  niche: ScoredNiche;
  onSelect: () => void;
  creating: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{niche.seed}</h3>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {niche.combinedScore.toFixed(1)}/10
        </span>
      </div>

      {/* Score bar */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-blue-500"
          style={{ width: `${niche.combinedScore * 10}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <ScoreBadge score={niche.demand.score} color={niche.demand.color as 'green' | 'amber' | 'red'} label="Demand" />
        <ScoreBadge score={niche.competition.score} color={niche.competition.color as 'green' | 'amber' | 'red'} label="Competition" />
      </div>

      <p className="mt-3 text-sm text-gray-700">{niche.rationale}</p>

      <div className="mt-3 text-xs text-gray-500">
        <span>
          {niche.marketSize.exactAngleCount} exact-angle listings, {niche.marketSize.totalCount} total
        </span>
        {niche.priceRange && (
          <span className="ml-3">
            ${niche.priceRange.min.toFixed(2)}–${niche.priceRange.max.toFixed(2)}
          </span>
        )}
      </div>

      {niche.exampleListings.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-gray-500">Examples:</p>
          <ul className="mt-1 space-y-0.5">
            {niche.exampleListings.map((ex, i) => (
              <li key={i} className="text-xs italic text-gray-500">{ex}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        onClick={onSelect}
        disabled={creating}
        className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {creating ? 'Creating Project...' : 'Select This Niche →'}
      </button>
    </div>
  );
}
