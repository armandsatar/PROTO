'use client';

import { useState } from 'react';
import { ScoreBadge } from './ScoreBadge';

interface CandidateCardProps {
  candidate: {
    id: string;
    candidate_text: string;
    is_original: boolean;
    generation_axis: 'original' | 'niche_down' | 'format_hint' | 'keyword_optimized';
    demand_score: number;
    demand_color: string;
    demand_signal_detail: Record<string, unknown>;
    competition_score: number;
    competition_color: string;
    competition_signal_detail: Record<string, unknown>;
    display_order: number;
  };
  onSelect?: () => void;
  selectLabel?: string;
  disabled?: boolean;
}

const axisLabels: Record<string, { label: string; classes: string }> = {
  original: { label: 'ORIGINAL', classes: 'bg-gray-100 text-gray-700' },
  niche_down: { label: 'Niche Down', classes: 'bg-indigo-100 text-indigo-700' },
  format_hint: { label: 'Format Variant', classes: 'bg-teal-100 text-teal-700' },
  keyword_optimized: { label: 'Keyword Opt.', classes: 'bg-orange-100 text-orange-700' },
};

export function CandidateCard({ candidate, onSelect, selectLabel, disabled }: CandidateCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const axis = axisLabels[candidate.generation_axis] ?? axisLabels.original;
  const demandDetail = candidate.demand_signal_detail ?? {};
  const compDetail = candidate.competition_signal_detail ?? {};

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${axis.classes}`}>
          {axis.label}
        </span>
        <h3 className="text-lg font-semibold text-gray-900">{candidate.candidate_text}</h3>
      </div>

      <div className="mt-3 flex flex-wrap gap-4">
        <ScoreBadge
          score={candidate.demand_score}
          color={candidate.demand_color as 'green' | 'amber' | 'red'}
          label="Demand"
        />
        <ScoreBadge
          score={candidate.competition_score}
          color={candidate.competition_color as 'green' | 'amber' | 'red'}
          label="Competition"
        />
      </div>

      {/* Market Context */}
      <div className="mt-3">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          {showDetails ? 'Hide Details' : 'View Details'}
        </button>

        {showDetails && (
          <div className="mt-2 rounded bg-gray-50 p-3 text-sm text-gray-700">
            <ul className="space-y-1">
              {demandDetail.avgFavorers != null && (
                <li>Avg favorites: {String(demandDetail.avgFavorers)}</li>
              )}
              {demandDetail.avgViews != null && (
                <li>Avg views: {String(demandDetail.avgViews)}</li>
              )}
              {compDetail.exactAngleMatchCount != null && (
                <li>Exact-angle listings: {String(compDetail.exactAngleMatchCount)}</li>
              )}
              {compDetail.totalListingCount != null && (
                <li>Total listings: {String(compDetail.totalListingCount)}</li>
              )}
              {Array.isArray(compDetail.exactAngleMatchPrices) &&
                compDetail.exactAngleMatchPrices.length > 0 && (
                  <li>
                    Price range: ${Math.min(...(compDetail.exactAngleMatchPrices as number[])).toFixed(2)}–$
                    {Math.max(...(compDetail.exactAngleMatchPrices as number[])).toFixed(2)}
                  </li>
                )}
            </ul>

            <button
              onClick={() => setShowRaw(!showRaw)}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700"
            >
              {showRaw ? 'Hide raw data' : 'Show raw data'}
            </button>

            {showRaw && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-gray-100 p-2 text-xs">
                {JSON.stringify({ demand: demandDetail, competition: compDetail }, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {onSelect && (
        <button
          onClick={onSelect}
          disabled={disabled}
          className="mt-4 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {selectLabel ?? 'Select This Candidate →'}
        </button>
      )}
    </div>
  );
}
