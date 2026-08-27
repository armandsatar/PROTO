import type {
  RawNarrativeWriterResponse,
  RawPlatformWriterResponse,
  RawReviewResponse,
  RawComplianceChangeItem,
  ComplianceChange,
  ContentRiskCategory,
  NarrativeWriterResult,
  PlatformWriterResult,
  ReviewPassResult,
  PlatformFields,
  RealCopyPlatform,
} from './types';
import { getPlatformSpec } from './platforms';
import { scanAllSlopPhrases, distinctSlopPhraseCount, findUncoveredAbsolutistHits } from './contentScanners';

const VALID_RISK_CATEGORIES: readonly ContentRiskCategory[] = ['unsupported_claim', 'absolute_language', 'missing_disclaimer', 'diagnostic_language', 'other'];

function isValidRiskCategory(v: unknown): v is ContentRiskCategory {
  return typeof v === 'string' && (VALID_RISK_CATEGORIES as readonly string[]).includes(v);
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** §6.4-equivalent rule: the returned original_text must actually appear in the shipped text. */
function isRealSubstring(candidate: string, source: string): boolean {
  return normalizeForMatch(source).includes(normalizeForMatch(candidate));
}

// Decision 10: same 3+ distinct-hit threshold as Step 8, own copy.
export const SLOP_HIT_THRESHOLD = 3;
// Decision 17 precedent: same ≥7/10 pass bar as Step 8, own copy.
export const SPECIFICITY_SCORE_THRESHOLD = 7;

/**
 * §3.1's narrative writer pass guardrail — only genuinely malformed output throws (a
 * missing or non-string field). There is no length/hard-limit concept for the narrative
 * itself (§0.4: the narrative has no hard limit of its own).
 */
export function validateNarrativeWriterOutput(raw: RawNarrativeWriterResponse): NarrativeWriterResult {
  if (typeof raw.hook !== 'string' || !raw.hook.trim()) throw new Error('Narrative writer pass returned empty or non-string hook');
  if (typeof raw.transformation_story !== 'string' || !raw.transformation_story.trim()) {
    throw new Error('Narrative writer pass returned empty or non-string transformation_story');
  }
  if (typeof raw.cta !== 'string' || !raw.cta.trim()) throw new Error('Narrative writer pass returned empty or non-string cta');
  if (typeof raw.summary !== 'string' || !raw.summary.trim()) throw new Error('Narrative writer pass returned empty or non-string summary');

  return {
    fields: {
      hook: raw.hook.trim(),
      transformationStory: raw.transformation_story.trim(),
      cta: raw.cta.trim(),
      summary: raw.summary.trim(),
    },
  };
}

/**
 * Validates a raw platform_fields object against the platform's own registered key
 * list (platforms.ts) — unknown keys are dropped (never trust an unvalidated shape),
 * known keys are type-checked individually rather than fabricated when malformed.
 */
function validatePlatformFields(raw: unknown, platform: RealCopyPlatform): PlatformFields {
  const spec = getPlatformSpec(platform);
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  const result: PlatformFields = {};

  if (spec.platformFieldKeys.includes('tags') && Array.isArray(obj.tags)) {
    result.tags = obj.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim());
  }
  if (spec.platformFieldKeys.includes('subtitle') && typeof obj.subtitle === 'string' && obj.subtitle.trim()) {
    result.subtitle = obj.subtitle.trim();
  }
  if (spec.platformFieldKeys.includes('buttonText') && typeof obj.buttonText === 'string' && obj.buttonText.trim()) {
    result.buttonText = obj.buttonText.trim();
  }
  if (spec.platformFieldKeys.includes('headline') && typeof obj.headline === 'string' && obj.headline.trim()) {
    result.headline = obj.headline.trim();
  }

  return result;
}

/**
 * §3.1's platform-adaptation writer pass guardrail. `title` is required only if the
 * platform's spec says it has one (Instagram is caption-only, §2.7); `body` is always
 * required. The hard-limit check itself lives in rules.ts (checkHardLimits) — this
 * function only validates that the SHAPE is usable, not whether it fits.
 */
export function validatePlatformWriterOutput(raw: RawPlatformWriterResponse, platform: RealCopyPlatform): PlatformWriterResult {
  const spec = getPlatformSpec(platform);

  if (typeof raw.body !== 'string' || !raw.body.trim()) {
    throw new Error(`Platform writer pass for "${platform}" returned empty or non-string body`);
  }
  let title: string | null = null;
  if (spec.hasTitle) {
    if (typeof raw.title !== 'string' || !raw.title.trim()) {
      throw new Error(`Platform writer pass for "${platform}" returned empty or non-string title, but this platform requires one`);
    }
    title = raw.title.trim();
  }

  return { title, body: raw.body.trim(), platformFields: validatePlatformFields(raw.platform_fields, platform) };
}

function validateComplianceChangeItem(raw: unknown, shippedText: string): ComplianceChange | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawComplianceChangeItem;

  if (typeof item.original_text !== 'string' || !item.original_text.trim()) return null;
  if (typeof item.rewritten_text !== 'string' || !item.rewritten_text.trim()) return null;
  if (typeof item.reason !== 'string' || !item.reason.trim()) return null;
  if (!isValidRiskCategory(item.risk_category)) return null;

  const originalText = item.original_text.trim();
  if (!isRealSubstring(originalText, shippedText)) return null;

  return {
    originalText,
    rewrittenText: item.rewritten_text.trim(),
    reason: item.reason.trim(),
    riskCategory: item.risk_category,
    detectedBy: 'ai_judgment',
  };
}

/**
 * §3.1's review pass guardrail — generic over whatever field-name set the draft was
 * sent with (the narrative's 4 fields, or a platform's title/body pair). `final` must
 * mirror the exact same keys as `draftFields`, each a non-empty string — the review
 * pass never renames or drops a field, only rewrites values. Compliance changes are
 * validated against the CONCATENATED final text (all field values joined), same
 * substring-validation posture as every guardrail in this codebase.
 */
export function validateReviewOutput(raw: RawReviewResponse, draftFields: Record<string, string>): ReviewPassResult {
  if (!raw.final || typeof raw.final !== 'object') {
    throw new Error('Review pass returned no "final" object');
  }
  const finalObj = raw.final as Record<string, unknown>;
  const finalFields: Record<string, string> = {};
  for (const key of Object.keys(draftFields)) {
    const value = finalObj[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Review pass "final" is missing or has a non-string value for field "${key}"`);
    }
    finalFields[key] = value.trim();
  }
  const shippedText = Object.values(finalFields).join('\n');

  if (typeof raw.specificity_score !== 'number' || !Number.isInteger(raw.specificity_score) || raw.specificity_score < 1 || raw.specificity_score > 10) {
    throw new Error(`Review pass returned an invalid specificity_score: ${JSON.stringify(raw.specificity_score)}`);
  }
  const specificityScore = raw.specificity_score;

  if (!Array.isArray(raw.compliance_changes)) {
    throw new Error('Review pass response missing a "compliance_changes" array');
  }
  const complianceChanges = raw.compliance_changes.map((item) => validateComplianceChangeItem(item, shippedText)).filter((c): c is ComplianceChange => c !== null);

  const specificityIssues = Array.isArray(raw.specificity_issues) ? raw.specificity_issues.filter((i): i is string => typeof i === 'string') : [];

  const slopHits = scanAllSlopPhrases(shippedText);
  const slopHitCount = distinctSlopPhraseCount(slopHits);

  const uncoveredAbsolutistPhrases = findUncoveredAbsolutistHits(
    shippedText,
    complianceChanges.map((c) => c.originalText),
  ).map((hit) => hit.phrase);

  const meetsSpecificityThreshold = specificityScore >= SPECIFICITY_SCORE_THRESHOLD && slopHitCount < SLOP_HIT_THRESHOLD;

  return { finalFields, complianceChanges, specificityScore, specificityIssues, slopHitCount, meetsSpecificityThreshold, uncoveredAbsolutistPhrases };
}
