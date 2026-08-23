import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { generateSubtopicList } from '../lib/subtopics/generateSubtopicList';

const target = { min: 2, max: 3 };

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking and dread irregular income.',
  confirmedFormat: 'workbook' as const,
  confirmedDeliveryMode: 'fillable',
  headlineBefore: 'Dreads opening her finances every single week without fail.',
  headlineAfter: 'Feels a calm, boring sense that her money is fully handled.',
  dimEmotionalBefore: 'A knot in her stomach every Sunday night before the bills are due.',
  dimEmotionalAfter: 'Sunday nights are just Sunday nights again, no dread building up now.',
  dimPracticalBefore: 'Manually reconciling four spreadsheets, about two hours every week.',
  dimPracticalAfter: 'Opens one dashboard that updates itself, checks it in five minutes now.',
  dimIdentityBefore: "\"I'm just bad with money, I'll never really get ahead.\"",
  dimIdentityAfter: "\"I'm someone who has this handled, in control of my own future.\"",
  dimPainPointBefore: 'Opening the banking app and feeling a stomach-drop of dread.',
  dimPainPointAfter: 'Opening the banking app on autopilot now, no dread, no surprises.',
  demandScore: 8,
  demandSignalDetail: { avgFavorers: 120 },
  competitionScore: 6,
  competitionSignalDetail: { exactAngleMatchCount: 2 },
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const validJson = JSON.stringify({
  subtopics: [
    { title: 'Setting Up Your Weekly Budget Foundation', description: 'Defines fixed vs. variable expenses before tracking begins.', depth: 'medium' },
    { title: 'Automating Recurring Bill Reminders', description: 'Covers flagging recurring bills so nothing gets missed weekly.', depth: 'shallow' },
  ],
});

describe('generateSubtopicList', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a guardrail-validated result on a valid first response', async () => {
    mockGroqResponse(validJson);
    const result = await generateSubtopicList(baseInput, target);
    expect(result.subtopics).toHaveLength(2);
    expect(result.generationStatus).toBe('succeeded');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output, then succeeds on the second attempt', async () => {
    mockGroqResponse(JSON.stringify({ subtopics: 'nope' }));
    mockGroqResponse(validJson);

    const result = await generateSubtopicList(baseInput, target);
    expect(result.subtopics).toHaveLength(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive malformed responses (retry exhausted)', async () => {
    mockGroqResponse(JSON.stringify({ subtopics: 'nope' }));
    mockGroqResponse(JSON.stringify({ subtopics: 'still nope' }));

    await expect(generateSubtopicList(baseInput, target)).rejects.toThrow(/Subtopic list generation failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('passes the guardrail through on an under-min response, surfacing succeeded_below_target rather than retrying', async () => {
    mockGroqResponse(
      JSON.stringify({
        subtopics: [{ title: 'Only One Item', description: 'A single subtopic, below the target minimum of two.', depth: 'medium' }],
      }),
    );
    const result = await generateSubtopicList(baseInput, target);
    expect(result.subtopics).toHaveLength(1);
    expect(result.generationStatus).toBe('succeeded_below_target');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
