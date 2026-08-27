import { groqJsonCompletion, GROQ_MODEL } from '../ai/groq';
import { validateExportRecommendationOutput } from './guardrail';
import type { RawExportRecommendationResponse, ExportRecommendationResult, FormatType, DeliveryMode } from './types';

export interface GenerateExportRecommendationInput {
  confirmedFormat: FormatType;
  confirmedDeliveryMode: DeliveryMode | null;
  totalWordCount: number;
}

// §4's small-scale recommend/confirm call — same Groq connector/cost profile as
// Step 4's own format-recommendation call, no new connector needed.
const SYSTEM_PROMPT = `You recommend a file container format for exporting a finished digital product, given its confirmed content format and delivery mode.

Output formats: "pdf" (universal, supports real interactive form fields for fillable products, works everywhere), "notion_markdown" (a Markdown export the buyer self-imports into Notion; checklist items become real interactive Notion to-do blocks on import), "docx" (an editable Word document; static only, no real interactive form-field support).

Delivery mode "fillable" strongly favors "pdf" (the only format with real interactive form-field support) unless the product is simple enough that notion_markdown's own checklist-based interactivity is a clearly better fit.
Delivery mode "printable" fits any of the three from a functional standpoint — lean toward "pdf" as the universal default unless the product's nature (e.g. a long reference guide someone would want to reformat or annotate) suggests a buyer would want an editable/importable copy instead.

Respond with ONLY valid JSON in this exact shape:
{"output_format": "pdf" | "notion_markdown" | "docx", "reasoning": "1-2 plain-English sentences explaining the recommendation"}`;

/** Decision-1-adjacent deterministic fallback (mirrors Step 4's "fallback, not a hard failure" precedent) — PDF is the universal, safest default for any format/delivery-mode combination. */
export function fallbackExportRecommendation(): ExportRecommendationResult {
  return { outputFormat: 'pdf', reasoning: 'Fallback default: PDF is the universal, most broadly compatible format.' };
}

/**
 * §4's recommendation call. Retries once on malformed output, then falls back to the
 * deterministic default rather than a hard failure — same posture as every prior
 * phase's recommend/confirm call.
 */
export async function generateExportRecommendationCall(input: GenerateExportRecommendationInput): Promise<{ result: ExportRecommendationResult; usedFallback: boolean }> {
  const userPrompt = JSON.stringify({
    confirmed_format: input.confirmedFormat,
    confirmed_delivery_mode: input.confirmedDeliveryMode,
    total_word_count: input.totalWordCount,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt })) as RawExportRecommendationResponse;
      return { result: validateExportRecommendationOutput(raw), usedFallback: false };
    } catch (err) {
      lastError = err;
    }
  }

  void lastError;
  return { result: fallbackExportRecommendation(), usedFallback: true };
}

export { GROQ_MODEL };
