import { groqJsonCompletion } from '../ai/groq';
import { applyFormatGuardrail } from './guardrail';
import type { RecommendationResult, RawRecommendation } from './types';

export interface RecommendFormatInput {
  title: string;
  rationale: string;
  demandScore: number;
  demandSignalDetail: unknown;
  competitionScore: number;
  competitionSignalDetail: unknown;
}

// §2.3's exact JSON contract. §2.1's four inputs. §2.4's printable-vs-fillable logic
// folded into the same call (format and delivery mode are correlated — one call, not two).
const SYSTEM_PROMPT = `You recommend a digital product format for a title the user has already locked in, and state your reasoning as structured evidence, not free prose.

Formats: "tracker" (ongoing logging/habit tool), "workbook" (structured worksheets/exercises), "ebook" (read-only reference/narrative guide), "quiz" (interactive self-assessment).
Delivery modes: "printable" (paper, filled by hand) or "fillable" (interactive PDF/Notion). Ebook has NO delivery mode — never return one for ebook, always null.

Respond with ONLY valid JSON in this exact shape:
{
  "recommended_format": "tracker" | "workbook" | "ebook" | "quiz",
  "recommended_delivery_mode": "printable" | "fillable" | null,
  "confidence": "high" | "medium" | "low",
  "reasoning_summary": "1-2 plain-English sentences explaining the recommendation",
  "reasoning_signals": [{"source": "title" | "rationale" | "demand_signal_detail" | "competition_signal_detail", "detail": "..."}],
  "alternate_format_considered": "tracker" | "workbook" | "ebook" | "quiz" | null
}

Rules:
- Every entry in reasoning_signals must cite which input it came from (the source field) — no unattributed claims.
- reasoning_signals must be non-empty.
- Populate alternate_format_considered only when confidence is "medium" or "low" and a second format was a genuinely close call; otherwise null.
- For quiz, lean toward "fillable" (interactivity/auto-scoring is the differentiator) unless the rationale clearly implies a self-scored paper assessment.
- For ebook, recommended_delivery_mode must be null — never printable or fillable.
- Base your reasoning on the title's phrasing, the user's stated rationale (their intent), and the demand/competition signal detail provided — e.g. a saturated ebook niche with a demand gap in interactive tools is a legitimate reason to steer toward tracker/workbook/quiz instead.`;

/**
 * §2.2's primary generation path. Retries once on malformed required-field output
 * (rule 1) before giving up — the caller (runFormatRecommendation.ts) is responsible
 * for falling back to fallbackFormatRecommendation() if this still throws.
 */
export async function recommendFormat(input: RecommendFormatInput): Promise<RecommendationResult> {
  const userPrompt = JSON.stringify({
    title: input.title,
    rationale: input.rationale,
    demand_score: input.demandScore,
    demand_signal_detail: input.demandSignalDetail,
    competition_score: input.competitionScore,
    competition_signal_detail: input.competitionSignalDetail,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt })) as RawRecommendation;
      return applyFormatGuardrail(raw);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Format recommendation failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}
