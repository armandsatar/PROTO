export type FormatType = 'tracker' | 'workbook' | 'ebook' | 'quiz';
export type DeliveryMode = 'printable' | 'fillable';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type SignalSource = 'title' | 'rationale' | 'demand_signal_detail' | 'competition_signal_detail';

export interface ReasoningSignal {
  source: SignalSource;
  detail: string;
}

// Unvalidated shape as it comes back from the AI (or is synthesized by the fallback
// heuristic) — every field is deliberately `unknown` here; applyFormatGuardrail() in
// guardrail.ts is what actually validates this into a trustworthy RecommendationResult.
// Never trust AI JSON output at the type level just because JSON.parse succeeded.
export interface RawRecommendation {
  recommended_format: unknown;
  recommended_delivery_mode: unknown;
  confidence: unknown;
  reasoning_summary: unknown;
  reasoning_signals: unknown;
  alternate_format_considered?: unknown;
}

export interface RecommendationResult {
  recommendedFormat: FormatType;
  recommendedDeliveryMode: DeliveryMode | null;
  confidence: ConfidenceLevel;
  reasoningSummary: string;
  reasoningSignals: ReasoningSignal[];
  alternateFormatConsidered: FormatType | null;
}
