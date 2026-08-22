import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { generateTransformationMap } from '../lib/transformationmap/generateTransformationMap';

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking and dread irregular income.',
  demandScore: 8,
  demandSignalDetail: { avgFavorers: 120 },
  competitionScore: 6,
  competitionSignalDetail: { exactAngleMatchCount: 2 },
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const validJson = JSON.stringify({
  headline_before: 'Dreads opening her finances every single week without fail.',
  headline_after: 'Feels a calm, boring sense that her money is fully handled.',
  dim_emotional_before: 'A knot in her stomach every Sunday night before the bills are due, every single week.',
  dim_emotional_after: 'Sunday nights are just Sunday nights again, no dread building up beforehand now.',
  dim_practical_before: 'Manually reconciling four spreadsheets, about two hours every week without fail.',
  dim_practical_after: 'Opens one dashboard that updates itself, checks it in under five minutes now.',
  dim_identity_before: "\"I'm just bad with money, I'll never really get ahead no matter what I try.\"",
  dim_identity_after: "\"I'm someone who has this handled, I'm in control of my own future now.\"",
  dim_pain_point_before: 'Opening the banking app and feeling a stomach-drop of dread before the number.',
  dim_pain_point_after: 'Opening the banking app on autopilot now, no dread, no surprises left to find.',
});

describe('generateTransformationMap', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a validated TransformationMapContent on a valid first response', async () => {
    mockGroqResponse(validJson);
    const result = await generateTransformationMap(baseInput);
    expect(result.headlineBefore).toContain('Dreads');
    expect(result.dimPainPointAfter).toContain('autopilot');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed/degenerate output, then succeeds on the second attempt', async () => {
    mockGroqResponse(JSON.stringify({ headline_before: 'too short' })); // fails min-length + missing fields
    mockGroqResponse(validJson);

    const result = await generateTransformationMap(baseInput);
    expect(result.headlineBefore).toContain('Dreads');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive malformed responses (retry exhausted)', async () => {
    mockGroqResponse(JSON.stringify({ headline_before: 'x' }));
    mockGroqResponse(JSON.stringify({ headline_before: 'y' }));

    await expect(generateTransformationMap(baseInput)).rejects.toThrow(/Transformation map generation failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
