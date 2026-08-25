import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    interactions = { create: mockCreate };
  }
  return { GoogleGenAI: MockGoogleGenAI };
});

import { generateCoverCandidate } from '../lib/cover/generateCoverCandidate';
import { DEFAULT_LOOK_ID } from '../lib/cover/templates';

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking and dread irregular income.',
  confirmedFormat: 'workbook' as const,
  lookId: DEFAULT_LOOK_ID,
};

function mockInteractionResponse(overrides: Partial<Record<string, unknown>> = {}) {
  mockCreate.mockResolvedValueOnce({
    id: 'v1_test_interaction_id',
    status: 'completed',
    usage: { total_input_tokens: 32, total_output_tokens: 1485 },
    output_image: { data: 'ZmFrZS1pbWFnZS1kYXRh', mime_type: 'image/jpeg' },
    ...overrides,
  });
}

describe('generateCoverCandidate', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('returns validated result with cost computed from real usage numbers', async () => {
    mockInteractionResponse();
    const result = await generateCoverCandidate(baseInput);
    expect(result.interactionId).toBe('v1_test_interaction_id');
    expect(result.imageDataBase64).toBe('ZmFrZS1pbWFnZS1kYXRh');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.costUsd).toBe(0.0891);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('calls the API with the standard tier model and no previous_interaction_id (fresh generation)', async () => {
    mockInteractionResponse();
    await generateCoverCandidate(baseInput);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('gemini-3.1-flash-image');
    expect(callArgs.previous_interaction_id).toBeUndefined();
    expect(callArgs.response_format.mime_type).toBe('image/jpeg');
  });

  it('throws for an unknown look id', async () => {
    await expect(generateCoverCandidate({ ...baseInput, lookId: 'not-a-real-look' })).rejects.toThrow(/Unknown look id/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('throws when the response has no output_image data', async () => {
    mockInteractionResponse({ output_image: undefined });
    await expect(generateCoverCandidate(baseInput)).rejects.toThrow(/no output_image data/);
  });

  it('throws when the response has no usable usage field', async () => {
    mockInteractionResponse({ usage: undefined });
    await expect(generateCoverCandidate(baseInput)).rejects.toThrow(/usage field/);
  });
});
