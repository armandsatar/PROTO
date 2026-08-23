import { groqJsonCompletion } from '../ai/groq';
import { validateReviewOutput, SLOP_HIT_THRESHOLD, SPECIFICITY_SCORE_THRESHOLD } from './guardrail';
import { extractSentenceContaining } from './contentScanners';
import type { RawReviewResponse, ReviewPassResult, ComplianceChange } from './types';

// Same reasoning as generateWriterPass.ts's estimate: the review pass echoes back
// nearly the full content in `final_content`, plus a compliance_changes array — sized
// off the draft's own length since that's the best available proxy for the output size.
function estimateMaxCompletionTokens(draftContent: string): number {
  const draftWordCount = draftContent.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(768, Math.ceil(draftWordCount * 1.5 * 2.5));
}

export interface GenerateReviewPassInput {
  title: string;
  subtopicTitle: string;
  subtopicDescription: string;
  draftContent: string;
}

// §3.1's combined pass (decision 16): compliance + specificity in one call. §3.2/§4.1's
// deterministic backstops run independently on the output regardless of what this
// prompt catches — this prompt is the AI-judgment half, not the only line of defense.
const SYSTEM_PROMPT = `You review a draft section of a digital product's content for two things at once: (1) compliance — unsupported or absolute health/outcome claims that need cautious rewriting, and (2) specificity — whether the content is genuinely concrete to its exact niche, or generic filler that could paste into any other product.

For (1): flag and rewrite any claim implying a guaranteed outcome, a cure, a diagnosis, or an unsupported absolute ("cures," "guaranteed," "100% effective," "eliminates," "clinically proven to," diagnostic-implying language like "if you have these symptoms, you have X"). Rewrite each flagged span to general-information framing with a cautious qualifier, preserving the surrounding content unchanged.

For (2): score how niche-specific the content is from 1 (generic, could paste into any product) to 10 (concretely grounded in this exact niche's real details). List any generic/templated phrases you notice.

Respond with ONLY valid JSON in this exact shape:
{
  "final_content": "The full content, with any compliance rewrites applied — otherwise identical to the draft",
  "compliance_changes": [
    {"original_text": "...", "rewritten_text": "...", "reason": "...", "risk_category": "unsupported_claim"}
  ],
  "specificity_score": 8,
  "specificity_issues": []
}

"risk_category" must be one of: "unsupported_claim", "absolute_language", "missing_disclaimer", "diagnostic_language", "other". If nothing needs rewriting, return an empty "compliance_changes" array and "final_content" identical to the draft.`;

/**
 * §6.3: review pass, the second of two calls per subtopic. Owns its own retry-once
 * budget, separate from the writer pass's — triggered by a malformed response, 3+
 * distinct AI-slop hits, an uncovered absolutist-claim phrase, or specificity_score
 * below threshold, feeding back everything wrong in one combined retry (not three
 * separate per-rule retries — an explicit interpretive resolution of §6.4's rule-by-
 * rule language, documented in the build plan).
 *
 * After the retry budget settles, any absolutist phrase STILL uncovered gets force-
 * appended as a `detected_by='deterministic_keyword_catch'` compliance change — the
 * backstop always creates an audit trail, even though a keyword scan has no rewrite
 * capability of its own (the span is logged unchanged, flagged for manual review, not
 * silently dropped).
 */
export async function generateReviewPass(input: GenerateReviewPassInput): Promise<ReviewPassResult> {
  const baseUserPrompt = {
    title: input.title,
    subtopic_title: input.subtopicTitle,
    subtopic_description: input.subtopicDescription,
    draft_content: input.draftContent,
  };

  let result: ReviewPassResult | null = null;
  let lastError: unknown;
  let retryFeedback: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const userPrompt = JSON.stringify({ ...baseUserPrompt, retry_feedback: retryFeedback });
    try {
      const raw = (await groqJsonCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxCompletionTokens: estimateMaxCompletionTokens(input.draftContent),
      })) as RawReviewResponse;
      result = validateReviewOutput(raw, input.draftContent);
    } catch (err) {
      lastError = err;
      result = null;
    }

    if (result) {
      const issues: string[] = [];
      if (result.slopHitCount >= SLOP_HIT_THRESHOLD) {
        issues.push(`Avoid generic AI-writing phrases — the previous version had ${result.slopHitCount} distinct instances of templated-sounding language.`);
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

  const forceFlagged: ComplianceChange[] = result.uncoveredAbsolutistPhrases.map((phrase) => {
    const hitIndex = result!.finalContent.toLowerCase().indexOf(phrase.toLowerCase());
    const span = hitIndex === -1 ? phrase : extractSentenceContaining(result!.finalContent, hitIndex, phrase.length);
    return {
      originalText: span,
      // No automatic rewrite occurred — a keyword scan has no rewrite capability of
      // its own (contentScanners.ts). The span is logged unchanged so the audit trail
      // exists, not silently dropped.
      rewrittenText: span,
      reason: `Deterministic scan detected a potential absolutist claim ("${phrase}") that the AI review pass did not resolve after retry — flagged for manual review, content was not automatically modified.`,
      riskCategory: 'unsupported_claim',
      detectedBy: 'deterministic_keyword_catch',
    };
  });

  return { ...result, complianceChanges: [...result.complianceChanges, ...forceFlagged] };
}
