import { groqJsonCompletion } from '../ai/groq';
import { validateWriterOutput } from './guardrail';
import type { FormatType, SubtopicDepth, RawWriterResponse, WriterPassResult, WordCountRange } from './types';

export interface GenerateWriterPassInput {
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
  subtopicTitle: string;
  subtopicDescription: string;
  subtopicDepth: SubtopicDepth;
  siblingSubtopicTitles: string[];
}

// §2.2's per-format content-TYPE guidance — a "subtopic" needs a structurally
// different kind of prose per format, not just a different length (§2.1 handles length
// separately, via the computed target passed into this call).
const FORMAT_CONTENT_TYPE: Record<FormatType, string> = {
  tracker: 'short instructional/explanatory copy telling the reader how to use this tracker category — not a general essay about the topic.',
  workbook: 'framing text that sets up the module, PLUS actual worksheet prompts or exercise questions the reader will fill in — not just prose about the topic.',
  ebook: 'continuous narrative/reference prose, written as a real chapter section — not a bulleted outline.',
  quiz: 'second-person result-description copy describing what it means for the reader to land in this outcome/result type.',
};

// Discovered live (smoke-test-content-ai.ts): an unset completion-token limit
// truncated a long ebook `deep`-tier response mid-JSON. ~1.5 tokens/word for English
// prose, doubled for JSON-wrapping overhead and safety margin, with a floor so short
// targets (tracker/quiz shallow tiers) still get reasonable headroom.
function estimateMaxCompletionTokens(target: WordCountRange): number {
  return Math.max(512, Math.ceil(target.max * 1.5 * 2));
}

function buildSystemPrompt(format: FormatType, target: WordCountRange): string {
  return `You write the content for ONE subtopic/section of a digital product. Write approximately ${target.min}-${target.max} words — this is a computed target, not your judgment call.

The product's format is "${format}". For this format, write: ${FORMAT_CONTENT_TYPE[format]}

Writing rules:
- Write FRESH, original content informed by general credible-source knowledge (the tone and general-consensus framing of institutions like the NIH or Mayo Clinic where relevant) — never summarize or excerpt any input document, there is none to summarize.
- Use cautious framing: general information, not medical/professional advice. Avoid absolute or guaranteed-outcome language.
- Ground every claim in specific, concrete detail relevant to THIS product's exact niche — a sentence that could paste unchanged into a completely different niche's product is a failure. Avoid generic filler phrasing.
- Do not literally repeat the content of the product's other sections (their titles are listed below for context) — cover genuinely new ground.

Respond with ONLY valid JSON in this exact shape:
{"content": "The full prose for this subtopic..."}`;
}

/**
 * §6.3: writer pass, one of two calls per subtopic (paired with generateReviewPass).
 * Owns its own retry-once budget covering BOTH malformed output AND a length-outside-
 * tolerance result (validateWriterOutput never throws on the latter, only returns
 * meetsLengthTarget=false) — after this retry is exhausted, a still-failing result is
 * returned as-is; the caller (runContentGeneration.ts) sets
 * generation_status='succeeded_outside_length_target' rather than padding/truncating.
 */
export async function generateWriterPass(input: GenerateWriterPassInput, target: WordCountRange): Promise<WriterPassResult> {
  const systemPrompt = buildSystemPrompt(input.confirmedFormat, target);

  const baseUserPrompt = {
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
    subtopic_title: input.subtopicTitle,
    subtopic_description: input.subtopicDescription,
    subtopic_depth: input.subtopicDepth,
    sibling_subtopic_titles: input.siblingSubtopicTitles,
  };

  let result: WriterPassResult | null = null;
  let lastError: unknown;
  let retryFeedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt = JSON.stringify({ ...baseUserPrompt, retry_feedback: retryFeedback });
    try {
      const raw = (await groqJsonCompletion({ systemPrompt, userPrompt, maxCompletionTokens: estimateMaxCompletionTokens(target) })) as RawWriterResponse;
      result = validateWriterOutput(raw, target);
    } catch (err) {
      lastError = err;
      result = null;
    }

    if (result) {
      if (result.meetsLengthTarget || attempt === 1) break;
      retryFeedback = `Your previous attempt was ${result.wordCount} words, outside the ${target.min}-${target.max} word target. Write a new version closer to that range.`;
      continue;
    }

    if (attempt === 1) break;
  }

  if (!result) {
    throw new Error(`Writer pass failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  }

  return result;
}
