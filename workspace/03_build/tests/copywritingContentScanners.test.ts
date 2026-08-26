import { describe, it, expect } from 'vitest';
import {
  scanAbsolutistClaims,
  findUncoveredAbsolutistHits,
  scanInstructionalSlopPhrases,
  scanMarketingSlopPhrases,
  scanAllSlopPhrases,
  distinctSlopPhraseCount,
  extractSentenceContaining,
} from '../lib/copywriting/contentScanners';

describe('scanAbsolutistClaims (decision 7, own copy of Step 8\'s list)', () => {
  it('catches a known absolutist phrase', () => {
    expect(scanAbsolutistClaims('This guaranteed to work.').length).toBeGreaterThan(0);
  });

  it('finds nothing in clean copy', () => {
    expect(scanAbsolutistClaims('A practical tracker for your daily routine.')).toEqual([]);
  });
});

describe('findUncoveredAbsolutistHits', () => {
  it('excludes a hit already covered by an AI-provided compliance change', () => {
    const text = 'This cures your stress instantly.';
    const uncovered = findUncoveredAbsolutistHits(text, ['This cures your stress instantly.']);
    expect(uncovered.length).toBe(0);
  });

  it('surfaces a hit the AI missed entirely', () => {
    const text = 'This guaranteed to work every time.';
    const uncovered = findUncoveredAbsolutistHits(text, []);
    expect(uncovered.length).toBeGreaterThan(0);
  });
});

describe('scanInstructionalSlopPhrases (decision 10 baseline layer, own copy)', () => {
  it('catches Step 8\'s known AI tells', () => {
    expect(scanInstructionalSlopPhrases('Let\'s delve into this crucial topic.').length).toBe(2);
  });

  it('catches the "not just X but Y" construction', () => {
    expect(scanInstructionalSlopPhrases('This is not just a tracker but a lifestyle.').length).toBe(1);
  });
});

describe('scanMarketingSlopPhrases (decision 10, new list)', () => {
  it('catches a known marketing-slop phrase', () => {
    expect(scanMarketingSlopPhrases('Perfect for busy professionals who want more.').length).toBe(1);
  });

  it('catches the "isn\'t just X, it\'s Y" construction', () => {
    expect(scanMarketingSlopPhrases('This isn\'t just a tracker, it\'s a lifestyle.').length).toBe(1);
  });

  it('catches excessive exclamation points', () => {
    expect(scanMarketingSlopPhrases('Get started today!!').length).toBe(1);
  });

  it('finds nothing in clean, specific copy', () => {
    expect(scanMarketingSlopPhrases('A 7-day trigger-food elimination tracker with 4 symptom categories.')).toEqual([]);
  });
});

describe('scanAllSlopPhrases + distinctSlopPhraseCount', () => {
  it('combines both blocklists and counts distinct phrases, not total occurrences', () => {
    const text = 'This is crucial, crucial, crucial. Also a real game-changer.';
    const hits = scanAllSlopPhrases(text);
    expect(distinctSlopPhraseCount(hits)).toBe(2);
  });
});

describe('extractSentenceContaining (own copy)', () => {
  it('extracts just the sentence containing the match, not the whole text', () => {
    const text = 'First sentence here. This guaranteed to work. Third sentence follows.';
    const idx = text.indexOf('guaranteed');
    const sentence = extractSentenceContaining(text, idx, 'guaranteed'.length);
    expect(sentence).toContain('guaranteed to work');
    expect(sentence).not.toContain('First sentence');
    expect(sentence).not.toContain('Third sentence');
  });
});
