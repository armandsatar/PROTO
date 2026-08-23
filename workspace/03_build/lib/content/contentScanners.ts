export interface ScanHit {
  phrase: string;
  index: number;
}

function scanPhraseList(text: string, phrases: readonly string[]): ScanHit[] {
  const hits: ScanHit[] = [];
  const lower = text.toLowerCase();
  for (const phrase of phrases) {
    let searchFrom = 0;
    let idx: number;
    while ((idx = lower.indexOf(phrase, searchFrom)) !== -1) {
      hits.push({ phrase, index: idx });
      searchFrom = idx + phrase.length;
    }
  }
  return hits;
}

/**
 * Extracts the sentence containing a matched span — content_compliance_changes rows
 * are span-level (phase6 §5.1: "a sentence or short passage," not a bare keyword), so
 * a force-flagged deterministic catch needs a readable original_text, not just the
 * 5-character phrase that triggered it. Falls back to a fixed-width window around the
 * match if no clear sentence boundary is found (e.g. a very long run-on sentence).
 */
export function extractSentenceContaining(text: string, index: number, phraseLength: number): string {
  const before = text.slice(0, index);
  const after = text.slice(index + phraseLength);

  const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const start = sentenceStart === -1 ? Math.max(0, index - 80) : sentenceStart + 1;

  const relativeEnd = Math.min(
    ...['.', '!', '?'].map((p) => (after.indexOf(p) === -1 ? Infinity : after.indexOf(p) + 1)),
  );
  const end = relativeEnd === Infinity ? Math.min(text.length, index + phraseLength + 80) : index + phraseLength + relativeEnd;

  return text.slice(start, end).trim();
}

// Decision 7: absolutist-claim keyword markers, grounded in FTC health-claims
// guidance's finding that vague qualifiers ("may help") are not sufficient softening
// on their own — meaning absolutist language is the correct, checkable target for a
// keyword net. This list operationalizes the doc's own examples (cures/guaranteed/
// 100% effective/eliminates/clinically proven to) plus a small number of clearly
// same-class extensions; it deliberately does NOT attempt "treats [disease]" as a
// literal pattern (§3.2's own phrasing marks that as a template, not a string) since
// real disease-name recognition is out of scope for a deterministic scanner. Approved
// as a starting point, tunable default — decision 7, flagged for a tuning pass in §10
// of phase6-requirements.md once real generated content exists to test against.
const ABSOLUTIST_CLAIM_PHRASES: readonly string[] = [
  'cures',
  'cure for',
  'cured by',
  'guarantee', // substring-matches guarantee/guarantees/guaranteed/guarantee to, deliberately
  '100% effective',
  '100% safe',
  '100% natural cure',
  'eliminates',
  'completely eliminates',
  'clinically proven to',
  'scientifically proven to',
  'medically proven',
  'no side effects',
  'miracle cure',
  'miracle treatment',
  'instant relief',
  'instantly cures',
  'permanently fixes',
  'permanent fix',
  'risk-free',
  'always works',
  'never fails',
];

export function scanAbsolutistClaims(text: string): ScanHit[] {
  return scanPhraseList(text, ABSOLUTIST_CLAIM_PHRASES);
}

/**
 * Decision 21: any span already covered by an AI-provided compliance change is not a
 * review-pass miss — "covered" means the matched phrase appears (case/whitespace-
 * normalized) inside some existing change's originalText, i.e. the AI was aware of and
 * attempted to address that span, even if imperfectly. Everything else genuinely
 * skipped past the AI's own review entirely.
 */
export function findUncoveredAbsolutistHits(text: string, existingOriginalTexts: string[]): ScanHit[] {
  const hits = scanAbsolutistClaims(text);
  const normalizedExisting = existingOriginalTexts.map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim());
  return hits.filter((hit) => !normalizedExisting.some((existing) => existing.includes(hit.phrase)));
}

// Decision 8: AI-writing-tell / slop-phrase blocklist, grounded in documented
// AI-writing-tell research — the mechanically-catchable half of the specificity gate
// (§4.1); niche-genericness itself remains AI-judgment-only, not attempted here.
const AI_SLOP_PHRASES: readonly string[] = [
  'delve',
  'tapestry',
  'crucial',
  'leverage',
  'elevate',
  'seamless',
  'robust',
  'foster',
  'ever-evolving',
  "in today's fast-paced world",
  "it's important to note",
];

// The "not just X, but Y" construction — a known AI-writing tell that isn't a fixed
// phrase, so it needs its own pattern rather than a blocklist entry.
const NOT_JUST_BUT_PATTERN = /\bnot just\b[^.!?]*\bbut\b/i;

export function scanAiSlopPhrases(text: string): ScanHit[] {
  const hits = scanPhraseList(text, AI_SLOP_PHRASES);
  const match = NOT_JUST_BUT_PATTERN.exec(text);
  if (match) {
    hits.push({ phrase: match[0], index: match.index });
  }
  return hits;
}

/**
 * Decision 17: the 3+ threshold counts DISTINCT phrases, not total occurrences — five
 * uses of "crucial" is one distinct hit, not five.
 */
export function distinctSlopPhraseCount(hits: ScanHit[]): number {
  return new Set(hits.map((h) => h.phrase.toLowerCase())).size;
}
