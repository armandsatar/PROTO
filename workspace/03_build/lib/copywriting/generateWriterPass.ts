import { copywritingJsonCompletion } from './aiProvider';
import { validateNarrativeWriterOutput, validatePlatformWriterOutput } from './guardrail';
import { checkHardLimits } from './rules';
import { getPlatformSpec } from './platforms';
import type { FormatType, RawNarrativeWriterResponse, RawPlatformWriterResponse, NarrativeWriterResult, PlatformWriterOutcome, RealCopyPlatform, NarrativeFields } from './types';

export interface GenerateNarrativeWriterPassInput {
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
  /** §1's "what's inside" signal — full confirmed subtopics list. */
  subtopics: { title: string; description: string }[];
  /** Decision 1's load-bearing input — full confirmed content bodies, not just titles. */
  contentBodies: { subtopicTitle: string; body: string }[];
  /** §2.5 — a text mood descriptor only, never the cover pixels themselves. */
  coverLookMoodDescriptor: string;
}

const NARRATIVE_SYSTEM_PROMPT = `You write ONE shared marketing narrative for a digital product — a hook, a transformation story, a call to action, and a summary. This narrative will later be adapted into platform-specific copy (Etsy, Gumroad, Stan Store, Whop, Pinterest, Instagram) by a separate pass, so write it as the single source of truth for the product's message, not as copy for any one destination.

Writing rules:
- Ground every claim in specific, concrete detail from the product's actual confirmed content (provided below) — a sentence that could paste unchanged into a completely different niche's product is a failure.
- Use cautious framing for any health/outcome claims: general information, not medical/professional advice. Avoid absolute or guaranteed-outcome language.
- "hook": one or two sentences that grab attention with the product's real, specific value.
- "transformation_story": the before/after journey this product enables, in the product's own voice — "care not clout," not hype.
- "cta": a short, direct call to action.
- "summary": a concise paragraph describing what the product actually contains.

Respond with ONLY valid JSON in this exact shape:
{"hook": "...", "transformation_story": "...", "cta": "...", "summary": "..."}`;

function estimateNarrativeMaxTokens(contentBodies: { body: string }[]): number {
  const totalWords = contentBodies.reduce((sum, c) => sum + c.body.trim().split(/\s+/).filter(Boolean).length, 0);
  // Input can be large (decision 1's full-body-text approach); output is always just 4
  // short fields, so this only needs modest headroom regardless of input size.
  return Math.max(768, Math.min(2048, Math.ceil(totalWords * 0.05)));
}

/**
 * §3.1's narrative writer pass — the first of two phases decision 14 introduced. Reads
 * the full confirmed content bodies (decision 1), not just subtopic titles, to ground
 * the narrative in real, concrete detail. Owns a simple retry-once budget for genuinely
 * malformed output — there is no length/hard-limit concept for the narrative itself
 * (§0.4), so a retry here is only ever triggered by a validation throw, not a
 * tolerance-band miss.
 */
export async function generateNarrativeWriterPass(input: GenerateNarrativeWriterPassInput): Promise<NarrativeWriterResult> {
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
    subtopics: input.subtopics,
    content_bodies: input.contentBodies,
    cover_look_mood: input.coverLookMoodDescriptor,
  };

  let result: NarrativeWriterResult | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await copywritingJsonCompletion({
        systemPrompt: NARRATIVE_SYSTEM_PROMPT,
        userPrompt: JSON.stringify(baseUserPrompt),
        maxCompletionTokens: estimateNarrativeMaxTokens(input.contentBodies),
      })) as RawNarrativeWriterResponse;
      result = validateNarrativeWriterOutput(raw);
      break;
    } catch (err) {
      lastError = err;
      result = null;
    }
  }

  if (!result) {
    throw new Error(`Narrative writer pass failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  }
  return result;
}

export interface GeneratePlatformAdaptationWriterPassInput {
  platform: RealCopyPlatform;
  narrative: NarrativeFields;
  title: string;
  confirmedFormat: FormatType;
  confirmedDeliveryMode: string | null;
}

function buildPlatformSystemPrompt(platform: RealCopyPlatform): string {
  const spec = getPlatformSpec(platform);
  return `You adapt an existing marketing narrative into ${spec.label} listing/promo copy. Do not invent new claims or details beyond what the narrative already says — this is a format adaptation, not a rewrite from scratch. Keep the substance identical to the narrative; only the packaging changes to fit this platform's conventions.

${spec.adaptationGuidance}

${spec.hasTitle ? 'Include a "title" field.' : 'This platform has no title field — omit "title" or leave it null; write only a caption in "body".'}
${spec.hasTags ? 'Include a "platform_fields" object with a "tags" array of relevant keywords/phrases.' : 'Set "platform_fields" to an empty object {} unless the platform-specific guidance above names other fields to include.'}

Respond with ONLY valid JSON in this exact shape:
{"title": ${spec.hasTitle ? '"..."' : 'null'}, "body": "...", "platform_fields": {}}`;
}

// Live-caught during Increment 3's own connector-shape smoke test: 768 tokens produced
// "max completion tokens reached before generating a valid document" against
// openai/gpt-oss-120b — the same reasoning-token-consumption issue found and fixed in
// generateReviewPass.ts's estimateMaxCompletionTokens, even though the visible output
// here is small (a few hundred characters at most per platform).
function estimatePlatformMaxTokens(): number {
  return 2048;
}

/**
 * §3.1's platform-adaptation writer pass, the second phase. Owns the hard-limit retry
 * loop (§4.1, decision 4): retries once on a hard-ceiling violation, naming the exact
 * overage in the retry feedback — a still-failing result after retry is returned as-is
 * (never silently dropped or truncated), with hardLimitStatus='exceeds_limit' for the
 * caller to persist and later block that platform's confirm on (runCopywriting.ts).
 */
export async function generatePlatformAdaptationWriterPass(input: GeneratePlatformAdaptationWriterPassInput): Promise<PlatformWriterOutcome> {
  const systemPrompt = buildPlatformSystemPrompt(input.platform);
  const baseUserPrompt = {
    title: input.title,
    confirmed_format: input.confirmedFormat,
    confirmed_delivery_mode: input.confirmedDeliveryMode,
    narrative: {
      hook: input.narrative.hook,
      transformation_story: input.narrative.transformationStory,
      cta: input.narrative.cta,
      summary: input.narrative.summary,
    },
  };

  let result: PlatformWriterOutcome | null = null;
  let lastError: unknown;
  let retryFeedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt = JSON.stringify({ ...baseUserPrompt, retry_feedback: retryFeedback });
    let attemptResult: PlatformWriterOutcome | null = null;
    try {
      const raw = (await copywritingJsonCompletion({ systemPrompt, userPrompt, maxCompletionTokens: estimatePlatformMaxTokens() })) as RawPlatformWriterResponse;
      const validated = validatePlatformWriterOutput(raw, input.platform);
      const hardLimitCheck = checkHardLimits(input.platform, validated);
      attemptResult = { ...validated, hardLimitStatus: hardLimitCheck.status, hardLimitViolations: hardLimitCheck.violations };
    } catch (err) {
      lastError = err;
      attemptResult = null;
    }

    if (attemptResult) {
      result = attemptResult;
      if (attemptResult.hardLimitStatus === 'within_limit' || attempt === 1) break;
      retryFeedback = `Your previous attempt exceeded this platform's hard limit: ${attemptResult.hardLimitViolations.join(' ')} Write a new version that fits within the limit.`;
      continue;
    }

    if (attempt === 1) break;
  }

  if (!result) {
    throw new Error(`Platform adaptation writer pass for "${input.platform}" failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  }
  return result;
}
