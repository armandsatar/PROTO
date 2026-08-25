import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    interactions = { create: mockCreate };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

import { generateCoverEdit } from '../lib/cover/generateCoverEdit';

function mockInteractionResponse(overrides: Partial<Record<string, unknown>> = {}) {
  mockCreate.mockResolvedValueOnce({
    id: 'v1_edited_interaction_id',
    status: 'completed',
    usage: { total_input_tokens: 40, total_output_tokens: 1200 },
    output_image: { data: 'ZWRpdGVkLWltYWdlLWRhdGE=', mime_type: 'image/jpeg' },
    ...overrides,
  });
}

describe('generateCoverEdit', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('returns a validated result and passes previous_interaction_id through for continuation', async () => {
    mockInteractionResponse();
    const result = await generateCoverEdit({ editInstruction: 'Move the title header to middle-left', previousInteractionId: 'v1_test_interaction_id' });

    expect(result.interactionId).toBe('v1_edited_interaction_id');
    expect(result.imageDataBase64).toBe('ZWRpdGVkLWltYWdlLWRhdGE=');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.previous_interaction_id).toBe('v1_test_interaction_id');
    expect(callArgs.input).toContain('Move the title header to middle-left');
  });

  it('computes cost from the edit call\'s own usage numbers', async () => {
    mockInteractionResponse();
    const result = await generateCoverEdit({ editInstruction: 'x', previousInteractionId: 'v1_test_interaction_id' });
    // 40/1e6*0.5 + 1200/1e6*60 = 0.00002 + 0.072 = 0.07202 -> rounds to 0.072
    expect(result.costUsd).toBe(0.072);
  });

  it('throws when the response has no output_image data', async () => {
    mockInteractionResponse({ output_image: undefined });
    await expect(generateCoverEdit({ editInstruction: 'x', previousInteractionId: 'id' })).rejects.toThrow(/no output_image data/);
  });
});
