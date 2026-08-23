import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { regenerateSingleSubtopic } from '../lib/subtopics/regenerateSingleSubtopic';

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
  siblingTitles: ['Setting Up Your Weekly Budget Foundation', 'Automating Recurring Bill Reminders'],
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const validJson = JSON.stringify({
  subtopic: {
    title: 'Building a 3-Month Emergency Buffer, Realistically',
    description: "Reframes 'emergency fund' into a specific weekly buffer target.",
    depth: 'deep',
  },
});

describe('regenerateSingleSubtopic', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a guardrail-validated subtopic on a valid first response', async () => {
    mockGroqResponse(validJson);
    const result = await regenerateSingleSubtopic(baseInput);
    expect(result.title).toBe('Building a 3-Month Emergency Buffer, Realistically');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once when the AI ignores the don\'t-duplicate instruction, then succeeds', async () => {
    mockGroqResponse(
      JSON.stringify({
        subtopic: { title: 'Setting Up Your Weekly Budget Foundation', description: 'A near-duplicate of an existing sibling title here.', depth: 'medium' },
      }),
    );
    mockGroqResponse(validJson);

    const result = await regenerateSingleSubtopic(baseInput);
    expect(result.title).toBe('Building a 3-Month Emergency Buffer, Realistically');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive duplicate responses (retry exhausted)', async () => {
    const dupJson = JSON.stringify({
      subtopic: { title: 'Setting Up Your Weekly Budget Foundation', description: 'A near-duplicate of an existing sibling title here.', depth: 'medium' },
    });
    mockGroqResponse(dupJson);
    mockGroqResponse(dupJson);

    await expect(regenerateSingleSubtopic(baseInput)).rejects.toThrow(/Single subtopic regeneration failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('threads an optional hint into the request payload sent to Groq', async () => {
    mockGroqResponse(validJson);
    await regenerateSingleSubtopic({ ...baseInput, hint: 'make this one more beginner-friendly' });

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(JSON.parse(userMessage.content).hint).toBe('make this one more beginner-friendly');
  });
});
