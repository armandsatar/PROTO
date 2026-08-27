import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked client only — decision 13's disclosed gap: this connector is not live-verified
// in this build (Groq stays the operative default). Live integration, whenever Arman
// activates a real OPENAI_API_KEY, is not covered here.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockOpenAI };
});

import { openaiJsonCompletion } from '../lib/ai/openai';

describe('openaiJsonCompletion', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('parses a valid JSON response', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"hook":"a real hook"}' } }] });
    const result = await openaiJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' });
    expect(result).toEqual({ hook: 'a real hook' });
  });

  it('throws when the response has no content', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: {} }] });
    await expect(openaiJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' })).rejects.toThrow(/no content/);
  });

  it('throws when the content is not valid JSON', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all' } }] });
    await expect(openaiJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' })).rejects.toThrow(/valid JSON/);
  });
});
