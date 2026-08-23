import { groqJsonCompletion } from '../ai/groq';
import { applySingleItemGuardrail } from './guardrail';
import type { FormatType, RawSingleItemResponse, Subtopic } from './types';

export interface RegenerateSingleSubtopicInput {
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
  siblingTitles: string[];
  hint?: string;
}

// §3.3: a distinct, smaller prompt — not the whole-list prompt called with N=1 —
// because the "don't duplicate a sibling" constraint only exists in this call shape.
const SYSTEM_PROMPT = `You generate ONE replacement subtopic for a digital product, to swap in for a single existing item the user wants regenerated. You are given the product's context and the full list of the OTHER subtopics currently in the product (its siblings).

Respond with ONLY valid JSON in this exact shape:
{"subtopic": {"title": "...", "description": "...", "depth": "medium"}}

Rules:
- The title must NOT duplicate or closely resemble any of the sibling titles provided — it must cover genuinely different ground within the product.
- "description" must be at least 20 characters, describing concretely what this subtopic covers.
- "depth" must be one of "shallow", "medium", or "deep", based on how much the topic warrants (shallow = brief aside, medium = standard item, deep = core deep-dive).
- If an optional hint is provided, follow it (e.g. a request to make the item more beginner-friendly, or to cover a different angle) while still avoiding duplication with the siblings.`;

/**
 * §3.4's single-item guardrail throws (not silently drops) on a sibling near-duplicate,
 * so the same retry-once wrapper used by every prior AI call function also covers the
 * "AI ignored the don't-duplicate instruction" case, not just malformed-JSON failures.
 */
export async function regenerateSingleSubtopic(input: RegenerateSingleSubtopicInput): Promise<Subtopic> {
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
    sibling_subtopic_titles: input.siblingTitles,
    hint: input.hint ?? null,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt })) as RawSingleItemResponse;
      return applySingleItemGuardrail(raw, input.siblingTitles);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Single subtopic regeneration failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}
