import { groqJsonCompletion } from '../ai/groq';
import { applyFullListGuardrail } from './guardrail';
import type { FormatType, FullListGuardrailResult, RawFullListResponse, TargetCountRange } from './types';

export interface GenerateSubtopicListInput {
  title: string;
  rationale: string;
  confirmedFormat: FormatType;
  confirmedDeliveryMode: string | null;
  headlineBefore: string;
  headlineAfter: string;
  dimEmotionalBefore: string;
  dimEmotionalAfter: string;
  dimPracticalBefore: string;
  dimPracticalAfter: string;
  dimIdentityBefore: string;
  dimIdentityAfter: string;
  dimPainPointBefore: string;
  dimPainPointAfter: string;
  demandScore: number;
  demandSignalDetail: unknown;
  competitionScore: number;
  competitionSignalDetail: unknown;
}

// §2.2's per-format subtopic unit definitions — the AI is told what a "subtopic"
// concretely means for its format, not left to infer it, since the unit genuinely
// differs (a tracker's trackable category vs. a quiz's outcome/result type).
const FORMAT_UNIT_DEFINITIONS: Record<FormatType, string> = {
  tracker: 'one trackable category/section (a sheet, tab, database view, or log category). Trackers work best narrow — do not over-categorize.',
  workbook: 'one worksheet/exercise module covering a distinct sub-skill or process step.',
  ebook: 'one chapter/section of the narrative or reference arc.',
  quiz: 'one possible outcome/result type the quiz sorts the taker into (NOT a question and NOT a dimension being assessed — questions are Step 8\'s concern, built backward from these outcomes).',
};

// §2.3's depth guidance, given to the AI as the actual criterion for its own tag
// assignment — the word-count ranges are informational for Step 8 only, never
// enforced by this step's guardrail, but they're the clearest way to communicate the
// intended distinction between the three tags.
const DEPTH_GUIDANCE = `Assign each subtopic a "depth" tag based on how much the topic warrants:
- "shallow": a brief aside or light-touch item (roughly 100-250 words worth of content)
- "medium": a standard, average-weight item (roughly 250-600 words worth of content)
- "deep": a core deep-dive item central to the product (roughly 600-1200 words worth of content)
Not every subtopic should be the same depth — vary it based on what each item actually needs, the way a real ebook's intro chapter is shallower than its core how-to chapters.`;

// §3.1: format and transformation map content are genuinely required inputs here
// (unlike Step 6, which excluded format, and Step 5, which excluded the map) — the
// map "shapes what the subtopics need to cover," and Step 7 is the actual consumer
// of that shaping.
function buildSystemPrompt(format: FormatType, target: TargetCountRange): string {
  return `You generate a list of subtopics for a digital product, driven by its format and by a "Visceral Transformation Map" describing the customer's before/after journey.

The product's format is "${format}". For this format, a subtopic unit means: ${FORMAT_UNIT_DEFINITIONS[format]}

Generate between ${target.min} and ${target.max} subtopics (inclusive) — this range is a hard constraint computed deterministically, not your judgment call to make.

${DEPTH_GUIDANCE}

Respond with ONLY valid JSON in this exact shape:
{"subtopics": [
  {"title": "...", "description": "...", "depth": "shallow"},
  {"title": "...", "description": "...", "depth": "medium"}
]}

Rules:
- Each "title" must be a complete, specific subtopic name — not a fragment or a generic placeholder.
- Each "description" must be at least 20 characters, describing concretely what this subtopic covers and why it matters to the transformation below — not a restatement of the title.
- No two subtopics may cover the same ground — each must be a genuinely distinct unit.
- Ground the subtopics in the specific transformation map content provided, not a generic treatment of the topic — the map tells you which angles actually matter to this customer.`;
}

/**
 * §2.2's deterministic target-count computation happens before this call fires (via
 * rules.ts's targetCountForFormat) — the AI is told "generate between X and Y," never
 * asked to decide the count itself. §3.4's retry-once-on-malformed-output pattern,
 * same as every prior phase's AI call.
 */
export async function generateSubtopicList(
  input: GenerateSubtopicListInput,
  target: TargetCountRange,
): Promise<FullListGuardrailResult> {
  const systemPrompt = buildSystemPrompt(input.confirmedFormat, target);

  const userPrompt = JSON.stringify({
    title: input.title,
    rationale: input.rationale,
    confirmed_format: input.confirmedFormat,
    confirmed_delivery_mode: input.confirmedDeliveryMode,
    transformation_map: {
      headline_before: input.headlineBefore,
      headline_after: input.headlineAfter,
      dim_emotional_before: input.dimEmotionalBefore,
      dim_emotional_after: input.dimEmotionalAfter,
      dim_practical_before: input.dimPracticalBefore,
      dim_practical_after: input.dimPracticalAfter,
      dim_identity_before: input.dimIdentityBefore,
      dim_identity_after: input.dimIdentityAfter,
      dim_pain_point_before: input.dimPainPointBefore,
      dim_pain_point_after: input.dimPainPointAfter,
    },
    demand_score: input.demandScore,
    demand_signal_detail: input.demandSignalDetail,
    competition_score: input.competitionScore,
    competition_signal_detail: input.competitionSignalDetail,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt, userPrompt })) as RawFullListResponse;
      return applyFullListGuardrail(raw, target);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Subtopic list generation failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}
