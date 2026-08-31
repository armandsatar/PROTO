import type {
  RawPricingReasoningResponse,
  PricingReasoningResult,
  PricingReasoningSignal,
  PricingSignalSource,
} from './types';

const VALID_SIGNAL_SOURCES: readonly PricingSignalSource[] = [
  'comparable_prices',
  'demand_score',
  'competition_score',
  'page_count',
  'delivery_mode',
  'format',
];

function isPricingSignal(v: unknown): v is PricingReasoningSignal {
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
 * Validates the AI's reasoning output. The AI does NOT decide the price —
 * it explains the formula's output. So this guardrail only validates the
 * reasoning_summary and reasoning_signals fields, not a price value.
 *
 * Throws on a missing/empty reasoning_summary (required field the caller
 * should use the fallback template for). Reasoning signals degrade gracefully
 * (empty array if none valid).
 */
export function validatePricingReasoningOutput(raw: RawPricingReasoningResponse): PricingReasoningResult {
  if (typeof raw.reasoning_summary !== 'string' || !raw.reasoning_summary.trim()) {
    throw new Error('AI returned an empty or non-string reasoning_summary');
  }
  const reasoningSummary = raw.reasoning_summary.trim();

  const signals: PricingReasoningSignal[] = Array.isArray(raw.reasoning_signals)
    ? raw.reasoning_signals.filter(isPricingSignal)
    : [];

  return {
    reasoningSummary,
    reasoningSignals: signals,
  };
}

/**
 * Guardrail rule 1: recommended price must be positive.
 * Guardrail rule 2: clamp to ceiling (already done in formula.ts, but
 * double-checked here as a safety net).
 */
export function assertValidPrice(price: number, ceiling: number): void {
  if (price <= 0) {
    throw new Error(`Recommended price must be positive, got ${price}`);
  }
  if (price > ceiling) {
    throw new Error(`Recommended price ${price} exceeds ceiling ${ceiling}`);
  }
}
