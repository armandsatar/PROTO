import type {
  RawRecommendation,
  RecommendationResult,
  FormatType,
  ConfidenceLevel,
  DeliveryMode,
  ReasoningSignal,
  SignalSource,
} from './types';

const VALID_FORMATS: readonly FormatType[] = ['tracker', 'workbook', 'ebook', 'quiz'];
const VALID_CONFIDENCE: readonly ConfidenceLevel[] = ['high', 'medium', 'low'];
const VALID_DELIVERY_MODES: readonly DeliveryMode[] = ['printable', 'fillable'];
const VALID_SIGNAL_SOURCES: readonly SignalSource[] = [
  'title',
  'rationale',
  'demand_signal_detail',
  'competition_signal_detail',
];

function isFormatType(v: unknown): v is FormatType {
  return typeof v === 'string' && (VALID_FORMATS as readonly string[]).includes(v);
}
function isConfidenceLevel(v: unknown): v is ConfidenceLevel {
  return typeof v === 'string' && (VALID_CONFIDENCE as readonly string[]).includes(v);
}
function isDeliveryMode(v: unknown): v is DeliveryMode {
  return typeof v === 'string' && (VALID_DELIVERY_MODES as readonly string[]).includes(v);
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
 * §2.2's deterministic guardrail. The AI's classification is never trusted blindly on
 * hard taxonomy rules — applied to every generation path (live AI call AND the fallback
 * heuristic in fallbackHeuristic.ts), so the ebook-null-delivery-mode and
 * default-fillable logic lives here exactly once, not duplicated per caller.
 *
 * Throws on a malformed `recommended_format`, `confidence`, or `reasoning_summary` —
 * those are required fields the caller should retry on (§2.2 rule 1), not silently
 * coerce. Everything else degrades gracefully per rules 2-4 rather than failing.
 */
export function applyFormatGuardrail(raw: RawRecommendation): RecommendationResult {
  if (!isFormatType(raw.recommended_format)) {
    throw new Error(`Invalid recommended_format from AI: ${JSON.stringify(raw.recommended_format)}`);
  }
  const recommendedFormat = raw.recommended_format;

  if (!isConfidenceLevel(raw.confidence)) {
    throw new Error(`Invalid confidence from AI: ${JSON.stringify(raw.confidence)}`);
  }
  let confidence: ConfidenceLevel = raw.confidence;

  if (typeof raw.reasoning_summary !== 'string' || !raw.reasoning_summary.trim()) {
    throw new Error('AI returned an empty or non-string reasoning_summary');
  }
  const reasoningSummary = raw.reasoning_summary.trim();

  let deliveryMode: DeliveryMode | null = isDeliveryMode(raw.recommended_delivery_mode)
    ? raw.recommended_delivery_mode
    : null;

  // Rule 2: ebook never has a delivery mode, regardless of what the model returned.
  if (recommendedFormat === 'ebook') {
    deliveryMode = null;
  } else if (deliveryMode === null) {
    // Rule 3: non-ebook + no usable delivery mode returned -> default fillable, downgrade confidence.
    deliveryMode = 'fillable';
    confidence = 'low';
  }

  // Rule 4: reasoning_signals must be non-empty; empty is still persisted, just downgraded.
  const signals: ReasoningSignal[] = Array.isArray(raw.reasoning_signals)
    ? raw.reasoning_signals.filter(isReasoningSignal)
    : [];
  if (signals.length === 0) {
    confidence = 'low';
  }

  const alternateFormatConsidered: FormatType | null = isFormatType(raw.alternate_format_considered)
    ? raw.alternate_format_considered
    : null;

  return {
    recommendedFormat,
    recommendedDeliveryMode: deliveryMode,
    confidence,
    reasoningSummary,
    reasoningSignals: signals,
    alternateFormatConsidered,
  };
}
