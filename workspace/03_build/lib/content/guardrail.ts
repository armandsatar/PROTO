import type {
  RawWriterResponse,
  RawReviewResponse,
  RawComplianceChangeItem,
  ComplianceChange,
  ContentRiskCategory,
  WriterPassResult,
  ReviewPassResult,
  WordCountRange,
} from './types';
import { meetsLengthTolerance } from './rules';
import { scanAiSlopPhrases, distinctSlopPhraseCount, findUncoveredAbsolutistHits } from './contentScanners';

const VALID_RISK_CATEGORIES: readonly ContentRiskCategory[] = [
  'unsupported_claim',
  'absolute_language',
  'missing_disclaimer',
  'diagnostic_language',
  'other',
];

function isValidRiskCategory(v: unknown): v is ContentRiskCategory {
  return typeof v === 'string' && (VALID_RISK_CATEGORIES as readonly string[]).includes(v);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** §6.4 rule 2: the returned original_text must actually appear in the draft. */
function isRealSubstring(candidate: string, source: string): boolean {
  return normalizeForMatch(source).includes(normalizeForMatch(candidate));
}

// Decision 8: AI-slop blocklist reject threshold — 3+ distinct hits (§4.1/§4.2).
export const SLOP_HIT_THRESHOLD = 3;
// Decision 17: specificity score pass bar, a starting point pending a tuning pass.
export const SPECIFICITY_SCORE_THRESHOLD = 7;

/**
 * Writer-pass guardrail. Only genuinely malformed output throws (empty/missing/non-
 * string content) — a length-outside-tolerance result is NOT a throw, it's returned as
 * `meetsLengthTarget: false` for the caller's own retry-once decision (generateWriterPass.ts,
 * increment 3) to act on. After that retry is exhausted, a still-failing result is
 * accepted as-is with `generation_status='succeeded_outside_length_target'` — never
 * force-padded or truncated, same "real content over a fabricated fit" posture Step 7
 * used for `succeeded_below_target`.
 */
export function validateWriterOutput(raw: RawWriterResponse, target: WordCountRange): WriterPassResult {
  if (typeof raw.content !== 'string' || !raw.content.trim()) {
    throw new Error('Writer pass returned empty or non-string content');
  }
  const content = raw.content.trim();
  const wordCount = countWords(content);

  return { content, wordCount, meetsLengthTarget: meetsLengthTolerance(wordCount, target) };
}

function validateComplianceChangeItem(raw: unknown, draftContent: string): ComplianceChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawComplianceChangeItem;

  if (typeof item.original_text !== 'string' || !item.original_text.trim()) return null;
  if (typeof item.rewritten_text !== 'string' || !item.rewritten_text.trim()) return null;
  if (typeof item.reason !== 'string' || !item.reason.trim()) return null;
  if (!isValidRiskCategory(item.risk_category)) return null;

  const originalText = item.original_text.trim();
  // §6.4 rule 2: a returned change whose "original" text doesn't actually appear in
  // the draft is dropped, not trusted — never fabricate, same posture as every
  // guardrail layer in this codebase.
  if (!isRealSubstring(originalText, draftContent)) return null;

  return {
    originalText,
    rewrittenText: item.rewritten_text.trim(),
    reason: item.reason.trim(),
    riskCategory: item.risk_category,
    detectedBy: 'ai_judgment',
  };
}

/**
 * Review-pass guardrail (decision 16: one combined call for compliance + specificity).
 * `final_content` and `specificity_score` are required top-level fields — missing or
 * malformed throws (genuine reject/retry territory). Individual `compliance_changes`
 * entries are validated one at a time and silently dropped if invalid — a single bad
 * entry doesn't invalidate an otherwise-good response, same spirit as rule 2's
 * "drop the fabricated record, don't persist it."
 *
 * Does NOT force-append deterministic-catch entries for `uncoveredAbsolutistPhrases`
 * — that only happens after generateReviewPass.ts's retry loop settles (increment 3),
 * since a single guardrail call has no way to know whether a retry is still coming.
 */
export function validateReviewOutput(raw: RawReviewResponse, draftContent: string): ReviewPassResult {
  if (typeof raw.final_content !== 'string' || !raw.final_content.trim()) {
    throw new Error('Review pass returned empty or non-string final_content');
  }
  const finalContent = raw.final_content.trim();

  if (
    typeof raw.specificity_score !== 'number' ||
    !Number.isInteger(raw.specificity_score) ||
    raw.specificity_score < 1 ||
    raw.specificity_score > 10
  ) {
    throw new Error(`Review pass returned an invalid specificity_score: ${JSON.stringify(raw.specificity_score)}`);
  }
  const specificityScore = raw.specificity_score;

  if (!Array.isArray(raw.compliance_changes)) {
    throw new Error('Review pass response missing a "compliance_changes" array');
  }
  const complianceChanges = raw.compliance_changes
    .map((item) => validateComplianceChangeItem(item, draftContent))
    .filter((c): c is ComplianceChange => c !== null);

  const specificityIssues = Array.isArray(raw.specificity_issues)
    ? raw.specificity_issues.filter((i): i is string => typeof i === 'string')
    : [];

  const slopHits = scanAiSlopPhrases(finalContent);
  const slopHitCount = distinctSlopPhraseCount(slopHits);

  const uncoveredAbsolutistPhrases = findUncoveredAbsolutistHits(
    finalContent,
    complianceChanges.map((c) => c.originalText),
  ).map((hit) => hit.phrase);

  const meetsSpecificityThreshold = specificityScore >= SPECIFICITY_SCORE_THRESHOLD && slopHitCount < SLOP_HIT_THRESHOLD;

  return {
    finalContent,
    complianceChanges,
    specificityScore,
    specificityIssues,
    slopHitCount,
    meetsSpecificityThreshold,
    uncoveredAbsolutistPhrases,
  };
}
