import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked client only — decision 13's disclosed gap: this connector is not live-verified
// in this build (Groq stays the operative default). Live integration, whenever Arman
// activates a real ANTHROPIC_API_KEY, is not covered here.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

import { claudeJsonCompletion } from '../lib/ai/claude';

describe('claudeJsonCompletion', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  it('parses a plain JSON text response', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"hook":"a real hook"}' }] });
    const result = await claudeJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' });
    expect(result).toEqual({ hook: 'a real hook' });
  });

  it('strips a markdown code fence if the model wraps its response in one', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '```json\n{"hook":"fenced hook"}\n```' }] });
    const result = await claudeJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' });
    expect(result).toEqual({ hook: 'fenced hook' });
  });

  it('throws when the response has no text content block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });
    await expect(claudeJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' })).rejects.toThrow(/no text content/);
  });

  it('throws when the text is not valid JSON', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json at all' }] });
    await expect(claudeJsonCompletion({ systemPrompt: 'sys', userPrompt: 'user' })).rejects.toThrow(/valid JSON/);
  });
});
