import { copywritingJsonCompletion } from './aiProvider';
import { validateReviewOutput, SLOP_HIT_THRESHOLD, SPECIFICITY_SCORE_THRESHOLD } from './guardrail';
import { extractSentenceContaining } from './contentScanners';
import type { RawReviewResponse, ReviewPassResult, ComplianceChange } from './types';

// Live-caught during Increment 3's own connector-shape smoke test: a 768-token floor
// (Step 8's own review-pass sizing) produced a bare json_validate_failed with an EMPTY
// failed_generation field against openai/gpt-oss-120b for this phase's 3-combined-check
// review prompt (compliance + specificity + over-promise, one more than Step 8's 2) —
// consistent with a reasoning-capable model spending its whole completion-token budget
// on hidden reasoning tokens before any visible JSON output, leaving nothing to emit.
// Raised well past Step 8's floor rather than guessing at a precise number.
function estimateMaxCompletionTokens(draftFields: Record<string, string>): number {
  const draftWordCount = Object.values(draftFields)
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(3072, Math.ceil(draftWordCount * 1.5 * 4));
}

export interface GenerateReviewPassInput {
  title: string;
  draftFields: Record<string, string>;
  /**
   * §6.3's over-promise check needs something to substantiate claims against — the
   * full confirmed content bodies for the narrative's own review pass, or the
   * narrative's own fields for a platform-adaptation review pass (an adaptation must
   * not exceed what the narrative itself already established).
   */
  groundingText: string;
}

// Decision 14: full compliance + specificity + over-promise review, run on BOTH the
// narrative and every platform's adapted output — not skipped for adapted text just
// because the narrative was already reviewed (§3.1, §6.2's "the shipped text is the
// literal advertising claim" reasoning applies to whatever text actually ships).
const SYSTEM_PROMPT = `You review a piece of marketing copy for three things at once: (1) compliance — unsupported or absolute health/outcome claims that need cautious rewriting, (2) specificity — whether the content is genuinely concrete to its exact niche, or generic filler that could paste into any other product, and (3) over-promising — does this copy claim something beyond what the provided grounding material actually substantiates?

For (1): flag and rewrite any claim implying a guaranteed outcome, a cure, a diagnosis, or an unsupported absolute ("cures," "guaranteed," "100% effective," "eliminates," "clinically proven to," diagnostic-implying language like "if you have these symptoms, you have X"). Rewrite each flagged span to general-information framing with a cautious qualifier, preserving the surrounding content unchanged otherwise.

For (2): score how niche-specific the content is from 1 (generic, could paste into any product) to 10 (concretely grounded in this exact niche's real details).

For (3): check every claim in the draft against the grounding material provided. If the copy claims something the grounding material does not support, treat it the same as an unsupported claim under (1) and rewrite it to only claim what is substantiated.

The draft is provided as a JSON object of named fields. Respond with ONLY valid JSON in this exact shape:
{
  "final": { "<same field names as the draft>": "..." },
  "compliance_changes": [
    {"original_text": "...", "rewritten_text": "...", "reason": "...", "risk_category": "unsupported_claim"}
  ],
  "specificity_score": 8,
  "specificity_issues": []
}

"final" must contain exactly the same field names as the draft, each a string, with any compliance rewrites applied — otherwise identical to the draft. "risk_category" must be one of: "unsupported_claim", "absolute_language", "missing_disclaimer", "diagnostic_language", "other". If nothing needs rewriting, return an empty "compliance_changes" array and "final" identical to the draft.`;

/**
 * §3.1's review pass — the second of two calls per phase (narrative or platform
 * adaptation), same combined-call shape Step 8 established. Owns its own retry-once
 * budget, triggered by a malformed response, 3+ distinct AI-slop hits (across both
 * blocklists), an uncovered absolutist-claim phrase, or specificity_score below
 * threshold. After the retry budget settles, any absolutist phrase STILL uncovered
 * gets force-appended as a `detected_by='deterministic_keyword_catch'` compliance
 * change — the backstop always creates an audit trail, even though a keyword scan has
 * no rewrite capability of its own.
 */
export async function generateReviewPass(input: GenerateReviewPassInput): Promise<ReviewPassResult> {
  const fieldNames = Object.keys(input.draftFields);
  // Live-caught during Increment 3's own connector-shape smoke test: the system
  // prompt's generic "<same field names as the draft>" placeholder was not concrete
  // enough — the model returned a "final" object missing real keys like "hook"
  // entirely. Fixed by spelling out the exact required keys per call, not just
  // pointing back at the draft object and hoping the model infers them correctly.
  const baseUserPrompt = {
    title: input.title,
    draft: input.draftFields,
    required_final_field_names: fieldNames,
    instruction: `Return "final" as an object with EXACTLY these keys, each a string, no others: ${fieldNames.join(', ')}`,
    grounding_material: input.groundingText,
  };

  let result: ReviewPassResult | null = null;
  let lastError: unknown;
  let retryFeedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt = JSON.stringify({ ...baseUserPrompt, retry_feedback: retryFeedback });
    try {
      const raw = (await copywritingJsonCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxCompletionTokens: estimateMaxCompletionTokens(input.draftFields),
      })) as RawReviewResponse;
      result = validateReviewOutput(raw, input.draftFields);
    } catch (err) {
      lastError = err;
      result = null;
    }

    if (result) {
      const issues: string[] = [];
      if (result.slopHitCount >= SLOP_HIT_THRESHOLD) {
        issues.push(`Avoid generic/templated marketing phrases — the previous version had ${result.slopHitCount} distinct instances of templated-sounding language.`);
      }
      if (result.uncoveredAbsolutistPhrases.length > 0) {
        issues.push(`Rewrite these unsupported/absolute claims still present in the content: ${result.uncoveredAbsolutistPhrases.join(', ')}.`);
      }
      if (result.specificityScore < SPECIFICITY_SCORE_THRESHOLD) {
        issues.push(`The content needs more concrete, niche-specific detail — the previous version scored ${result.specificityScore}/10 on specificity.`);
      }

      if (issues.length === 0 || attempt === 1) break;
      retryFeedback = issues.join(' ');
      continue;
    }

    if (attempt === 1) break;
  }

  if (!result) {
    throw new Error(`Review pass failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  }

  const shippedText = Object.values(result.finalFields).join('\n');
  const forceFlagged: ComplianceChange[] = result.uncoveredAbsolutistPhrases.map((phrase) => {
    const hitIndex = shippedText.toLowerCase().indexOf(phrase.toLowerCase());
    const span = hitIndex === -1 ? phrase : extractSentenceContaining(shippedText, hitIndex, phrase.length);
    return {
      originalText: span,
      rewrittenText: span,
      reason: `Deterministic scan detected a potential absolutist claim ("${phrase}") that the AI review pass did not resolve after retry — flagged for manual review, content was not automatically modified.`,
      riskCategory: 'unsupported_claim',
      detectedBy: 'deterministic_keyword_catch',
    };
  });

  return { ...result, complianceChanges: [...result.complianceChanges, ...forceFlagged] };
}
