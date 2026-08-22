import type {
  RawLeadMagnetRecommendation,
  LeadMagnetRecommendationResult,
  LeadMagnetType,
  ConfidenceLevel,
  ReasoningSignal,
  SignalSource,
} from './types';

const VALID_TYPES: readonly LeadMagnetType[] = ['stripped_sample', 'standalone_funnel'];
const VALID_CONFIDENCE: readonly ConfidenceLevel[] = ['high', 'medium', 'low'];
const VALID_SIGNAL_SOURCES: readonly SignalSource[] = [
  'title',
  'rationale',
  'demand_signal_detail',
  'competition_signal_detail',
  'confirmed_format',
];

function isLeadMagnetType(v: unknown): v is LeadMagnetType {
  return typeof v === 'string' && (VALID_TYPES as readonly string[]).includes(v);
}
function isConfidenceLevel(v: unknown): v is ConfidenceLevel {
  return typeof v === 'string' && (VALID_CONFIDENCE as readonly string[]).includes(v);
}
function isReasoningSignal(v: unknown): v is ReasoningSignal {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.source === 'string' &&
    (VALID_SIGNAL_SOURCES as readonly string[]).includes(s.source) &&
    typeof s.detail === 'string' &&
    s.detail.trim().length > 0
  );
}

/**
 * §2.2's deterministic guardrail for Step 5 — same "never trust AI blindly on hard
 * rules" posture as lib/format/guardrail.ts, adapted for a binary suitability gate
 * (decision 8) rather than a 4-way taxonomy pick. The DB's CHECK constraints
 * (migration 0003) enforce the same not-suitable-implies-null-type rule independently
 * — belt and suspenders, not redundant: this runs before the row is ever built, the DB
 * constraint is the last line of defense if this function is ever bypassed.
 */
export function applyLeadMagnetGuardrail(raw: RawLeadMagnetRecommendation): LeadMagnetRecommendationResult {
  if (typeof raw.recommended_suitable !== 'boolean') {
    throw new Error(`Invalid recommended_suitable from AI: ${JSON.stringify(raw.recommended_suitable)}`);
  }
  const recommendedSuitable = raw.recommended_suitable;

  if (!isConfidenceLevel(raw.confidence)) {
    throw new Error(`Invalid confidence from AI: ${JSON.stringify(raw.confidence)}`);
  }
  let confidence: ConfidenceLevel = raw.confidence;

  if (typeof raw.reasoning_summary !== 'string' || !raw.reasoning_summary.trim()) {
    throw new Error('AI returned an empty or non-string reasoning_summary');
  }
  const reasoningSummary = raw.reasoning_summary.trim();

  let recommendedType: LeadMagnetType | null = isLeadMagnetType(raw.recommended_type) ? raw.recommended_type : null;

  // Rule 2: not-suitable forces type null, regardless of what the model returned.
  if (!recommendedSuitable) {
    recommendedType = null;
  } else if (recommendedType === null) {
    // Rule 3: suitable but no usable type returned -> default to stripped_sample (the
    // lower-effort, always-feasible option), downgrade confidence.
    recommendedType = 'stripped_sample';
    confidence = 'low';
  }

  // Rule 4: reasoning_signals must be non-empty; empty is still persisted, just downgraded.
  const signals: ReasoningSignal[] = Array.isArray(raw.reasoning_signals)
    ? raw.reasoning_signals.filter(isReasoningSignal)
    : [];
  if (signals.length === 0) {
    confidence = 'low';
  }

  // Rule 5: alternate_type_considered only means something when a type was actually
  // being chosen between — force null whenever not suitable.
  let alternateTypeConsidered: LeadMagnetType | null = isLeadMagnetType(raw.alternate_type_considered)
    ? raw.alternate_type_considered
    : null;
  if (!recommendedSuitable) {
    alternateTypeConsidered = null;
  }

  return {
    recommendedSuitable,
    recommendedType,
    confidence,
    reasoningSummary,
    reasoningSignals: signals,
    alternateTypeConsidered,
  };
}
