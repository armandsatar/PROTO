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
 * Extracts the sentence containing a matched span — copy_compliance_changes rows are
 * span-level (same granularity as Step 8's content_compliance_changes), so a
 * force-flagged deterministic catch needs a readable original_text, not just the
 * phrase that triggered it. Own copy of lib/content/contentScanners.ts's identical
 * function, no cross-phase import.
 */
export function extractSentenceContaining(text: string, index: number, phraseLength: number): string {
  const before = text.slice(0, index);
  const after = text.slice(index + phraseLength);

  const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const start = sentenceStart === -1 ? Math.max(0, index - 80) : sentenceStart + 1;

  const relativeEnd = Math.min(...['.', '!', '?'].map((p) => (after.indexOf(p) === -1 ? Infinity : after.indexOf(p) + 1)));
  const end = relativeEnd === Infinity ? Math.min(text.length, index + phraseLength + 80) : index + phraseLength + relativeEnd;

  return text.slice(start, end).trim();
}

// Decision 7: own copy of Step 8's absolutist-claim keyword markers, reused verbatim
// rather than reinvented (phase8-requirements.md §6.3) — same FTC-health-claims
// grounding as lib/content/contentScanners.ts's identical list.
const ABSOLUTIST_CLAIM_PHRASES: readonly string[] = [
  'cures',
  'cure for',
  'cured by',
  'guarantee',
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
 * Decision 7: any span already covered by an AI-provided compliance change is not a
 * review-pass miss — own copy of Step 8's identical logic.
 */
export function findUncoveredAbsolutistHits(text: string, existingOriginalTexts: string[]): ScanHit[] {
  const hits = scanAbsolutistClaims(text);
  const normalizedExisting = existingOriginalTexts.map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim());
  return hits.filter((hit) => !normalizedExisting.some((existing) => existing.includes(hit.phrase)));
}

// Decision 10: own copy of Step 8's instructional-writing AI-tell blocklist, reused as
// a baseline layer — rare in short marketing copy, but still worth scanning for.
const INSTRUCTIONAL_SLOP_PHRASES: readonly string[] = [
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

const NOT_JUST_BUT_PATTERN = /\bnot just\b[^.!?]*\bbut\b/i;

// Decision 10: a new, separate deterministic blocklist tuned to marketing-copy's own
// failure register (generic superlatives, templated sales constructions) — a different
// phrase list than the instructional one above, because the failure register is
// different (§5's own table). Approved as a starting heuristic seed, not independently
// researched to the depth the instructional list was — flagged for a tuning pass once
// real generated copy exists to check it against.
const MARKETING_SLOP_PHRASES: readonly string[] = [
  'perfect for busy professionals',
  'say goodbye to',
  'unlock your potential',
  'game-changer',
  'game changer',
  'level up your',
  'imagine a world where',
];

const ISNT_JUST_IT_PATTERN = /\bisn't just\b[^.!?]*\bit's\b/i;
// 2+ consecutive exclamation points, a common marketing-copy AI tell.
const EXCESSIVE_EXCLAMATION_PATTERN = /!{2,}/;

export function scanInstructionalSlopPhrases(text: string): ScanHit[] {
  const hits = scanPhraseList(text, INSTRUCTIONAL_SLOP_PHRASES);
  const match = NOT_JUST_BUT_PATTERN.exec(text);
  if (match) hits.push({ phrase: match[0], index: match.index });
  return hits;
}

export function scanMarketingSlopPhrases(text: string): ScanHit[] {
  const hits = scanPhraseList(text, MARKETING_SLOP_PHRASES);
  const isntJustMatch = ISNT_JUST_IT_PATTERN.exec(text);
  if (isntJustMatch) hits.push({ phrase: isntJustMatch[0], index: isntJustMatch.index });
  const exclaimMatch = EXCESSIVE_EXCLAMATION_PATTERN.exec(text);
  if (exclaimMatch) hits.push({ phrase: exclaimMatch[0], index: exclaimMatch.index });
  return hits;
}

/** Both blocklists feed the same reject-retry-then-flag mechanism (decision 10). */
export function scanAllSlopPhrases(text: string): ScanHit[] {
  return [...scanInstructionalSlopPhrases(text), ...scanMarketingSlopPhrases(text)];
}

/**
 * Decision 10 / Step 8's original threshold logic: counts DISTINCT phrases across BOTH
 * blocklists combined, not total occurrences.
 */
export function distinctSlopPhraseCount(hits: ScanHit[]): number {
  return new Set(hits.map((h) => h.phrase.toLowerCase())).size;
}
