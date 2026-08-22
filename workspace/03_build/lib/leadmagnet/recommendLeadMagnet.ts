import { groqJsonCompletion } from '../ai/groq';
import { applyLeadMagnetGuardrail } from './guardrail';
import type { LeadMagnetRecommendationResult, RawLeadMagnetRecommendation } from './types';

export interface RecommendLeadMagnetInput {
  title: string;
  rationale: string;
  demandScore: number;
  demandSignalDetail: unknown;
  competitionScore: number;
  competitionSignalDetail: unknown;
  confirmedFormat: string;
  confirmedDeliveryMode: string | null;
}

// §2.3's exact JSON contract. §2.1's inputs, including Step 4's confirmed format/
// delivery mode (new vs. Step 4's own prompt). Explicitly clarifies competition_score's
// inverted scale (phase1-requirements.md decision 4: higher = LESS competition) — the
// model has no other way to know this direction, and getting it backwards would flip
// the suitability reasoning.
const SYSTEM_PROMPT = `You decide whether a free companion "lead magnet" product is clearly suited to a digital product's title/niche, and if so, which of two types — stating your reasoning as structured evidence, not free prose.

This is a binary gate, not automatic: only recommend a lead magnet when it is CLEARLY suited, not as a default add-on for every product.

Score scale note: demand_score and competition_score are both 1-10, high-is-good on this project's scale. For competition_score specifically, a HIGHER number means LESS market competition (more white space, an easier market), and a LOWER number means a MORE crowded/competitive market. Do not assume higher competition_score means "more competitors" — it is the opposite.

Lead magnet types (only relevant if suitable):
- "stripped_sample": a subset of the SAME paid product — same structure/format, just fewer sections/modules/pages. Only makes sense if the confirmed format is modular enough to sample down cleanly (e.g. a multi-module tracker or workbook). A single-narrative ebook or a one-shot quiz usually does NOT sample down well into a convincing "stripped_sample."
- "standalone_funnel": a smaller but COMPLETE product on an adjacent/precursor topic that naturally leads toward the paid product. Works regardless of whether the confirmed format samples down, since it's a different, self-contained product.

Respond with ONLY valid JSON in this exact shape:
{
  "recommended_suitable": true | false,
  "recommended_type": "stripped_sample" | "standalone_funnel" | null,
  "confidence": "high" | "medium" | "low",
  "reasoning_summary": "1-2 plain-English sentences explaining the decision",
  "reasoning_signals": [{"source": "title" | "rationale" | "demand_signal_detail" | "competition_signal_detail" | "confirmed_format", "detail": "..."}],
  "alternate_type_considered": "stripped_sample" | "standalone_funnel" | null
}

Rules:
- If recommended_suitable is false, recommended_type and alternate_type_considered MUST be null — never name a type when you're saying no.
- Every entry in reasoning_signals must cite which input it came from (the source field) — no unattributed claims. At least one signal must reference "confirmed_format" when reasoning about type feasibility.
- Populate alternate_type_considered only when recommended_suitable is true AND confidence is "medium" or "low" AND it was a genuinely close call between the two types; otherwise null.
- Favor recommending a lead magnet when: the market is crowded (low competition_score) — differentiation/trust-building value — and/or the confirmed format samples down cleanly for stripped_sample, or the niche supports a natural adjacent standalone product.
- Favor NOT recommending one when: demand_score is low (not enough audience to justify a two-tier funnel), or the market has little competition (high competition_score, no differentiation pressure), or the title/niche is narrow enough that neither type feels genuinely distinct or valuable on its own.`;

/**
 * §2.2's primary generation path, decision 7's dedicated Step 5 call (never combined
 * with Step 4's). Retries once on malformed required-field output, same as
 * lib/format/recommendFormat.ts. Caller (runLeadMagnetCheck.ts) falls back to
 * fallbackLeadMagnetRecommendation() if this still throws.
 */
export async function recommendLeadMagnet(input: RecommendLeadMagnetInput): Promise<LeadMagnetRecommendationResult> {
  const userPrompt = JSON.stringify({
    title: input.title,
    rationale: input.rationale,
    demand_score: input.demandScore,
    demand_signal_detail: input.demandSignalDetail,
    competition_score: input.competitionScore,
    competition_signal_detail: input.competitionSignalDetail,
    confirmed_format: input.confirmedFormat,
    confirmed_delivery_mode: input.confirmedDeliveryMode,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt })) as RawLeadMagnetRecommendation;
      return applyLeadMagnetGuardrail(raw);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Lead magnet recommendation failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}
