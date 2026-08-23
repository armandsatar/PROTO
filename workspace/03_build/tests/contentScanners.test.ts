import { describe, it, expect } from 'vitest';
import {
  scanAbsolutistClaims,
  findUncoveredAbsolutistHits,
  extractSentenceContaining,
  scanAiSlopPhrases,
  distinctSlopPhraseCount,
} from '../lib/content/contentScanners';

describe('scanAbsolutistClaims (decision 7)', () => {
  it('finds no hits in clean, cautiously-framed text', () => {
    const text = 'Many people find this routine helpful for managing day-to-day stress, though results vary.';
    expect(scanAbsolutistClaims(text)).toEqual([]);
  });

  it('finds a hit for a known absolutist phrase, including inflected forms via substring', () => {
    const text = 'This routine guaranteed results within a week.';
    const hits = scanAbsolutistClaims(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].phrase).toBe('guarantee');
  });

  it('finds multiple distinct hits in one passage', () => {
    const text = 'This 100% effective treatment cures everything with no side effects.';
    const hits = scanAbsolutistClaims(text).map((h) => h.phrase);
    expect(hits).toContain('100% effective');
    expect(hits).toContain('cures');
    expect(hits).toContain('no side effects');
  });

  it('is case-insensitive', () => {
    expect(scanAbsolutistClaims('This is GUARANTEED to work.')).toHaveLength(1);
  });
});

describe('extractSentenceContaining', () => {
  it('extracts the containing sentence when clear boundaries exist', () => {
    const text = 'This is the first sentence. This routine guarantees results. This is the third sentence.';
    const idx = text.indexOf('guarantees');
    const result = extractSentenceContaining(text, idx, 'guarantees'.length);
    expect(result).toBe('This routine guarantees results.');
  });

  it('falls back to a fixed window when no sentence boundary exists nearby', () => {
    const text = 'x'.repeat(200) + ' guaranteed ' + 'y'.repeat(200);
    const idx = text.indexOf('guaranteed');
    const result = extractSentenceContaining(text, idx, 'guaranteed'.length);
    expect(result).toContain('guaranteed');
    expect(result.length).toBeLessThan(text.length);
  });
});

describe('findUncoveredAbsolutistHits (decision 7: covered vs. genuinely missed)', () => {
  it('reports a hit as uncovered when no existing change mentions it', () => {
    const text = 'This routine guarantees great results.';
    expect(findUncoveredAbsolutistHits(text, [])).toHaveLength(1);
  });

  it('reports a hit as covered when an existing change originalText contains the phrase', () => {
    const text = 'This routine guarantees great results.';
    const existing = ['This routine guarantees great results.'];
    expect(findUncoveredAbsolutistHits(text, existing)).toHaveLength(0);
  });

  it('is covered-check case/whitespace-insensitive', () => {
    const text = 'This routine GUARANTEED great results.';
    const existing = ['this   routine guaranteed great results'];
    expect(findUncoveredAbsolutistHits(text, existing)).toHaveLength(0);
  });
});

describe('scanAiSlopPhrases / distinctSlopPhraseCount (decision 8)', () => {
  it('finds no hits in clean, specific text', () => {
    const text = 'Set up a weekly reconciliation habit for your freelance invoices every Sunday.';
    expect(scanAiSlopPhrases(text)).toEqual([]);
  });

  it('finds hits for known slop phrases', () => {
    const text = "It's crucial to leverage a robust system to foster growth.";
    const hits = scanAiSlopPhrases(text).map((h) => h.phrase);
    expect(hits).toEqual(expect.arrayContaining(['crucial', 'leverage', 'robust', 'foster']));
  });

  it('matches the "not just X, but Y" construction', () => {
    const text = 'This is not just a tracker, but a complete system.';
    const hits = scanAiSlopPhrases(text);
    expect(hits.some((h) => /not just/i.test(h.phrase))).toBe(true);
  });

  it('distinctSlopPhraseCount collapses repeated occurrences of the same phrase to one', () => {
    const text = 'This is crucial. Really, truly crucial. Absolutely crucial.';
    const hits = scanAiSlopPhrases(text);
    expect(hits.length).toBe(3);
    expect(distinctSlopPhraseCount(hits)).toBe(1);
  });

  it('counts exactly 2 vs exactly 3 distinct phrases at the reject threshold boundary', () => {
    const twoPhrasesText = 'This is crucial and leverages a system.';
    const threePhrasesText = 'This is crucial, leverages a system, and is seamless.';
    expect(distinctSlopPhraseCount(scanAiSlopPhrases(twoPhrasesText))).toBe(2);
    expect(distinctSlopPhraseCount(scanAiSlopPhrases(threePhrasesText))).toBe(3);
  });
});
