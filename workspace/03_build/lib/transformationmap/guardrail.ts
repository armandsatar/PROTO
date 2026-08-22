import type { RawTransformationMapContent, TransformationMapContent } from './types';
import { MIN_CONTENT_LENGTH, meetsMinLength } from './rules';

interface FieldPair {
  before: keyof RawTransformationMapContent;
  after: keyof RawTransformationMapContent;
  label: string;
}

// All 5 before/after pairs — the headline pair plus the 4 named dimensions from §2.1.
// Rule 3 (before != after) applies to all 5, not just the 4 "dimensions" — a
// degenerate headline pair is just as much a lazy non-answer as a degenerate dimension.
const FIELD_PAIRS: FieldPair[] = [
  { before: 'headline_before', after: 'headline_after', label: 'headline' },
  { before: 'dim_emotional_before', after: 'dim_emotional_after', label: 'emotional' },
  { before: 'dim_practical_before', after: 'dim_practical_after', label: 'practical' },
  { before: 'dim_identity_before', after: 'dim_identity_after', label: 'identity' },
  { before: 'dim_pain_point_before', after: 'dim_pain_point_after', label: 'pain_point' },
];

/**
 * §3.3's guardrail — structural only, by design (decision 4). No semantic "is this
 * visceral" enforcement exists here, unlike Phase 2/3's taxonomy rules; there is no
 * hard business rule to check for freeform prose, and building one that pretends
 * otherwise would just be brittle keyword-matching dressed up as validation. What this
 * DOES enforce, deterministically:
 *   1. All 10 fields present and non-empty (reject/retry on malformed output).
 *   2. Each field meets MIN_CONTENT_LENGTH (decision 13) — catches degenerate stubs.
 *   3. Within each before/after pair, the two strings are not literally identical —
 *      catches a lazy no-op response.
 */
export function applyTransformationMapGuardrail(raw: RawTransformationMapContent): TransformationMapContent {
  const values: Partial<Record<keyof RawTransformationMapContent, string>> = {};

  for (const pair of FIELD_PAIRS) {
    for (const key of [pair.before, pair.after] as const) {
      const v = raw[key];
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`Missing or empty field from AI: ${key}`);
      }
      const trimmed = v.trim();
      if (!meetsMinLength(trimmed)) {
        throw new Error(`Field too short (min ${MIN_CONTENT_LENGTH} chars) from AI: ${key} ("${trimmed}")`);
      }
      values[key] = trimmed;
    }
    if (values[pair.before] === values[pair.after]) {
      throw new Error(`before/after are identical for dimension "${pair.label}"`);
    }
  }

  return {
    headlineBefore: values.headline_before as string,
    headlineAfter: values.headline_after as string,
    dimEmotionalBefore: values.dim_emotional_before as string,
    dimEmotionalAfter: values.dim_emotional_after as string,
    dimPracticalBefore: values.dim_practical_before as string,
    dimPracticalAfter: values.dim_practical_after as string,
    dimIdentityBefore: values.dim_identity_before as string,
    dimIdentityAfter: values.dim_identity_after as string,
    dimPainPointBefore: values.dim_pain_point_before as string,
    dimPainPointAfter: values.dim_pain_point_after as string,
  };
}
