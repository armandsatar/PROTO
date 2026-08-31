import { groqJsonCompletion } from '../ai/groq';
import { validatePricingReasoningOutput } from './guardrail';
import type { PricingReasoningResult, RawPricingReasoningResponse, PlatformPriceSuggestion, FormatType, DeliveryMode } from './types';

export interface GeneratePricingReasoningInput {
  recommendedPrice: number;
  basePrice: number;
  comparableCount: number;
  demandCompetitionMultiplier: number;
  depthAdjustment: number;
  platformPrices: PlatformPriceSuggestion[];
  demandScore: number;
  competitionScore: number;
  pageCount: number;
  deliveryMode: DeliveryMode | null;
  format: FormatType;
  title: string;
}

// The AI explains the formula's output — it does NOT decide the price (§4.3).
const SYSTEM_PROMPT = `You explain a pricing recommendation for a digital product. The price has already been computed by a deterministic formula — your job is to articulate WHY this price makes sense, referencing the specific inputs that drove it, in plain English.

Respond with ONLY valid JSON in this exact shape:
{
  "reasoning_summary": "2-3 plain-English sentences explaining why this price, referencing concrete numbers (comparable prices, scores, page count)",
  "reasoning_signals": [{"source": "comparable_prices" | "demand_score" | "competition_score" | "page_count" | "delivery_mode" | "format", "detail": "..."}]
}

Rules:
- reasoning_summary must reference at least one concrete number (a comparable price, a score, a page count).
- Every entry in reasoning_signals must cite which input it came from (the source field) — no unattributed claims.
- reasoning_signals must be non-empty (at minimum, cite the comparable price data).
- Be concise and factual — no marketing language or sales pitch. State the inputs, the adjustments, and the result.
- Include per-platform price suggestions in the summary when they differ meaningfully from the base price.`;

/**
 * §4.3: AI generates the "stated reason" the spec requires. Retries once on
 * malformed output before giving up — the caller uses fallbackPricingReasoning()
 * if this still throws.
 */
export async function generatePricingReasoningCall(input: GeneratePricingReasoningInput): Promise<PricingReasoningResult> {
  const platformSummary = input.platformPrices
    .map((p) => `${p.platform}: $${p.suggestedPrice.toFixed(2)} (×${p.multiplier})`)
    .join(', ');

  const userPrompt = JSON.stringify({
    recommended_base_price: input.recommendedPrice,
    median_comparable_price: input.basePrice,
    comparable_count: input.comparableCount,
    demand_competition_multiplier: input.demandCompetitionMultiplier,
    depth_adjustment_dollars: input.depthAdjustment,
    demand_score: input.demandScore,
    competition_score: input.competitionScore,
    page_count: input.pageCount,
    delivery_mode: input.deliveryMode,
    format: input.format,
    title: input.title,
    per_platform_prices: platformSummary,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt })) as RawPricingReasoningResponse;
      return validatePricingReasoningOutput(raw);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Pricing reasoning generation failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}

/**
 * §4.4: deterministic fallback template when the Groq reasoning call fails.
 * The price itself is still valid (formula-computed, no AI involved) — only
 * the natural-language explanation is degraded.
 */
export function fallbackPricingReasoning(input: GeneratePricingReasoningInput): PricingReasoningResult {
  const platformParts = input.platformPrices
    .map((p) => `$${p.suggestedPrice.toFixed(2)} on ${p.platform}`)
    .join(', ');

  const summary = input.comparableCount > 0
    ? `Base price of $${input.recommendedPrice.toFixed(2)} derived from a median of $${input.basePrice.toFixed(2)} across ${input.comparableCount} comparable Etsy listing${input.comparableCount === 1 ? '' : 's'}, adjusted for demand (${input.demandScore}/10) and competition (${input.competitionScore}/10) scores. Per-platform: ${platformParts}.`
    : `Base price of $${input.recommendedPrice.toFixed(2)} based on the ${input.format} format floor (no comparable Etsy data available), adjusted for demand (${input.demandScore}/10) and competition (${input.competitionScore}/10) scores. Per-platform: ${platformParts}.`;

  return {
    reasoningSummary: summary,
    reasoningSignals: [
      {
        source: 'comparable_prices',
        detail: input.comparableCount > 0
          ? `Median of ${input.comparableCount} exact-angle-match Etsy listings: $${input.basePrice.toFixed(2)}`
          : `No comparable Etsy data — used ${input.format} format floor of $${input.basePrice.toFixed(2)}`,
      },
      {
        source: 'demand_score',
        detail: `Demand score ${input.demandScore}/10 — ${input.demandScore >= 7 ? 'strong' : input.demandScore >= 5 ? 'moderate' : 'limited'} buyer interest`,
      },
      {
        source: 'competition_score',
        detail: `Competition score ${input.competitionScore}/10 — ${input.competitionScore >= 7 ? 'limited' : input.competitionScore >= 5 ? 'moderate' : 'crowded'} competitive landscape`,
      },
    ],
  };
}
