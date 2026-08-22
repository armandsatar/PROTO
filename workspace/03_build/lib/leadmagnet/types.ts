import type { ConfidenceLevel } from '../format/types';

// Reused as-is — same concept, same DB enum reused across migrations 0002/0003
// (phase3-requirements.md decision 16). Re-exported so callers only need one import.
export type { ConfidenceLevel };

export type LeadMagnetType = 'stripped_sample' | 'standalone_funnel';
export type SignalSource =
  | 'title'
  | 'rationale'
  | 'demand_signal_detail'
  | 'competition_signal_detail'
  | 'confirmed_format'; // new vs. lib/format's SignalSource — Step 4's confirmed format is a Step 5 input (§2.1)

export interface ReasoningSignal {
  source: SignalSource;
  detail: string;
}

// Unvalidated shape as it comes back from the AI (or is synthesized by the fallback)
// — deliberately `unknown` throughout; applyLeadMagnetGuardrail() in guardrail.ts is
// what actually validates this into a trustworthy result.
export interface RawLeadMagnetRecommendation {
  recommended_suitable: unknown;
  recommended_type: unknown;
  confidence: unknown;
  reasoning_summary: unknown;
  reasoning_signals: unknown;
  alternate_type_considered?: unknown;
}

export interface LeadMagnetRecommendationResult {
  recommendedSuitable: boolean;
  recommendedType: LeadMagnetType | null;
  confidence: ConfidenceLevel;
  reasoningSummary: string;
  reasoningSignals: ReasoningSignal[];
  alternateTypeConsidered: LeadMagnetType | null;
}
