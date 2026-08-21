import type { RawRecommendation, FormatType } from './types';

interface KeywordRule {
  format: FormatType;
  keywords: string[];
}

// Decision 1's keyword table (phase2-requirements.md). Order matters — first match
// wins, checked case-insensitively against title + rationale combined. The decision's
// literal "which...are you" is interpreted as two independent keywords ("which", "are
// you") rather than a strict phrase match — simple substring matching is the whole
// point of a lightweight fallback, not a parser.
const KEYWORD_RULES: KeywordRule[] = [
  { format: 'tracker', keywords: ['tracker', 'log', 'habit'] },
  { format: 'workbook', keywords: ['workbook', 'planner', 'worksheet'] },
  { format: 'ebook', keywords: ['guide', 'handbook', 'complete', 'everything you need'] },
  { format: 'quiz', keywords: ['quiz', 'which', 'are you', 'find your', "what's your"] },
];

/**
 * Decision 1's fallback, used when the live AI classification call fails. Produces a
 * RawRecommendation-shaped object with delivery_mode/reasoning_signals deliberately
 * left unset — applyFormatGuardrail() (called by whoever invokes this) fills those in
 * via its own rules (ebook->null, else->fillable, empty signals->low confidence), so
 * that logic lives in exactly one place, not duplicated here.
 */
export function fallbackFormatRecommendation(title: string, rationale: string): RawRecommendation {
  const haystack = `${title} ${rationale}`.toLowerCase();
  const matched = KEYWORD_RULES.find((rule) => rule.keywords.some((kw) => haystack.includes(kw)));
  const format: FormatType = matched?.format ?? 'workbook';

  return {
    recommended_format: format,
    recommended_delivery_mode: null,
    confidence: 'low', // decision 1: always low for a fallback recommendation
    reasoning_summary:
      'The AI recommendation step was unavailable, so this is a safe default based on simple keyword matching in the title. Please review before confirming.',
    reasoning_signals: [],
    alternate_format_considered: null,
  };
}
