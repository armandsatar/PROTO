import { groqJsonCompletion } from '../ai/groq';
import { validateFieldStructureOutput } from './guardrail';
import type { RawFieldStructureResponse, FieldStructureResult, FormatType } from './types';

export interface GenerateFieldStructureInput {
  subtopicTitle: string;
  body: string;
  confirmedFormat: FormatType;
}

// Decision 1's new AI-usage category: extraction/classification over already-confirmed
// text, not generation. The explicit "do not rewrite" instruction is load-bearing —
// Step 8 is not reopened or touched (decision 1), so this pass must never alter the
// confirmed wording, only identify structure within it.
const SYSTEM_PROMPT = `You extract structural information from an already-written, already-confirmed piece of content for a fillable digital product (a tracker, workbook, or quiz the buyer fills in). Do NOT rewrite, paraphrase, summarize, or generate new text — only classify existing spans of the provided content into blocks, copying the exact original wording into each block's "text" field, character for character.

Block types:
- "heading": a section/subsection title.
- "instructional_paragraph": explanatory prose the reader reads but does not fill in.
- "checklist_item": a single item in a checklist or to-do list the reader will check off.
- "user_input_blank": a spot clearly intended for the reader to write their own entry (a blank line, a "Your answer:" prompt, a fill-in-the-blank).
- "table_row": one row of tabular/structured data (e.g. a tracker's log-entry row).

Break the content into an ordered sequence of blocks covering the entire text, in the order they appear. Every part of the original content should appear in exactly one block's "text" field, copied verbatim — do not add, remove, or alter any characters from the source.

Respond with ONLY valid JSON in this exact shape:
{"blocks": [{"field_type": "heading" | "instructional_paragraph" | "checklist_item" | "user_input_blank" | "table_row", "text": "the exact original text of this block"}]}`;

function estimateMaxCompletionTokens(body: string): number {
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  // Same reasoning-token-consumption lesson learned live in Step 10's Increment 3 —
  // a generous floor, not the naive word-count-based estimate.
  return Math.max(3072, Math.ceil(wordCount * 1.5 * 4));
}

/**
 * Decision 1's structure-extraction pass. Owns a retry-once budget for genuinely
 * malformed output. Deliberately has NO internal fallback — if this still fails after
 * retry, the caller (runExport.ts, later increments) is responsible for the disclosed
 * degradation (ship the fillable product as a static, non-interactive PDF instead),
 * not this function silently fabricating a plausible-looking structure.
 */
export async function generateFieldStructurePass(input: GenerateFieldStructureInput): Promise<FieldStructureResult> {
  const userPrompt = JSON.stringify({
    subtopic_title: input.subtopicTitle,
    confirmed_format: input.confirmedFormat,
    content: input.body,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxCompletionTokens: estimateMaxCompletionTokens(input.body) })) as RawFieldStructureResponse;
      const result = validateFieldStructureOutput(raw, input.body);
      if (result.blocks.length > 0) return result;
      lastError = new Error('Field structure extraction returned zero valid blocks');
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(`Field structure extraction failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}
