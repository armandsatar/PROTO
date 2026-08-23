import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { generateWriterPass } from '../lib/content/generateWriterPass';

const target = { min: 200, max: 400 };

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking and dread irregular income.',
  confirmedFormat: 'workbook' as const,
  confirmedDeliveryMode: 'fillable',
  headlineBefore: 'Dreads opening her finances every week.',
  headlineAfter: 'Feels calm that money is handled.',
  dimEmotionalBefore: 'A knot in her stomach every Sunday.',
  dimEmotionalAfter: 'Sunday nights are just Sunday nights now.',
  dimPracticalBefore: 'Manually reconciling four spreadsheets.',
  dimPracticalAfter: 'Opens one dashboard, checks it in minutes.',
  dimIdentityBefore: "\"I'm bad with money.\"",
  dimIdentityAfter: "\"I'm in control of my future.\"",
  dimPainPointBefore: 'Opening the banking app with dread.',
  dimPainPointAfter: 'Opening the banking app on autopilot.',
  subtopicTitle: 'Setting Up Your Weekly Budget Foundation',
  subtopicDescription: 'Defines fixed vs. variable expenses before tracking begins.',
  subtopicDepth: 'medium' as const,
  siblingSubtopicTitles: ['Automating Recurring Bill Reminders'],
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

function contentOfWordCount(n: number): string {
  return Array(n).fill('word').join(' ');
}

describe('generateWriterPass', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns validated content on a valid first response within the target range', async () => {
    mockGroqResponse(JSON.stringify({ content: contentOfWordCount(300) }));
    const result = await generateWriterPass(baseInput, target);
    expect(result.wordCount).toBe(300);
    expect(result.meetsLengthTarget).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output, then succeeds on the second attempt', async () => {
    mockGroqResponse(JSON.stringify({ content: '' }));
    mockGroqResponse(JSON.stringify({ content: contentOfWordCount(300) }));

    const result = await generateWriterPass(baseInput, target);
    expect(result.wordCount).toBe(300);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries once on a length miss, then accepts a within-target second attempt', async () => {
    mockGroqResponse(JSON.stringify({ content: contentOfWordCount(10) }));
    mockGroqResponse(JSON.stringify({ content: contentOfWordCount(300) }));

    const result = await generateWriterPass(baseInput, target);
    expect(result.wordCount).toBe(300);
    expect(result.meetsLengthTarget).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const secondCallArgs = mockCreate.mock.calls[1][0];
    const userMessage = secondCallArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(JSON.parse(userMessage.content).retry_feedback).toMatch(/10 words/);
  });

  it('accepts a still-outside-target result after retry exhausted, without throwing', async () => {
    mockGroqResponse(JSON.stringify({ content: contentOfWordCount(10) }));
    mockGroqResponse(JSON.stringify({ content: contentOfWordCount(12) }));

    const result = await generateWriterPass(baseInput, target);
    expect(result.wordCount).toBe(12);
    expect(result.meetsLengthTarget).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive malformed responses (retry exhausted)', async () => {
    mockGroqResponse(JSON.stringify({ content: '' }));
    mockGroqResponse(JSON.stringify({ content: '' }));

    await expect(generateWriterPass(baseInput, target)).rejects.toThrow(/Writer pass failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
