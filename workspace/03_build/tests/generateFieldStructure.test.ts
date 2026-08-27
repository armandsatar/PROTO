import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { generateFieldStructurePass } from '../lib/export/generateFieldStructure';

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const body = "Week 1 Check-In\nLog today's income below.\nAmount: ____________";
const baseInput = { subtopicTitle: 'Week 1 Check-In', body, confirmedFormat: 'tracker' as const };

describe('generateFieldStructurePass', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns validated blocks extracted from the real source text', async () => {
    mockGroqResponse(
      JSON.stringify({
        blocks: [
          { field_type: 'heading', text: 'Week 1 Check-In' },
          { field_type: 'instructional_paragraph', text: "Log today's income below." },
          { field_type: 'user_input_blank', text: 'Amount: ____________' },
        ],
      }),
    );
    const result = await generateFieldStructurePass(baseInput);
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks.map((b) => b.fieldType)).toEqual(['heading', 'instructional_paragraph', 'user_input_blank']);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('drops a fabricated block (not a real substring of the source) rather than trusting it', async () => {
    mockGroqResponse(
      JSON.stringify({
        blocks: [
          { field_type: 'heading', text: 'Week 1 Check-In' },
          { field_type: 'instructional_paragraph', text: 'This sentence was never in the source content at all.' },
        ],
      }),
    );
    const result = await generateFieldStructurePass(baseInput);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].text).toBe('Week 1 Check-In');
  });

  it('retries once when the first attempt yields zero valid blocks', async () => {
    mockGroqResponse(JSON.stringify({ blocks: [{ field_type: 'heading', text: 'completely fabricated text' }] }));
    mockGroqResponse(JSON.stringify({ blocks: [{ field_type: 'heading', text: 'Week 1 Check-In' }] }));
    const result = await generateFieldStructurePass(baseInput);
    expect(result.blocks).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after retry when the response stays malformed', async () => {
    mockGroqResponse('not json at all');
    mockGroqResponse('still not json');
    await expect(generateFieldStructurePass(baseInput)).rejects.toThrow(/failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});
