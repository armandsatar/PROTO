import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { generateExportRecommendationCall, fallbackExportRecommendation } from '../lib/export/generateExportRecommendation';

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const baseInput = { confirmedFormat: 'tracker' as const, confirmedDeliveryMode: 'fillable' as const, totalWordCount: 4500 };

describe('generateExportRecommendationCall', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a validated result on a clean response', async () => {
    mockGroqResponse(JSON.stringify({ output_format: 'pdf', reasoning: 'Fillable tracker needs real interactive form fields.' }));
    const { result, usedFallback } = await generateExportRecommendationCall(baseInput);
    expect(result).toEqual({ outputFormat: 'pdf', reasoning: 'Fillable tracker needs real interactive form fields.' });
    expect(usedFallback).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output before falling back', async () => {
    mockGroqResponse(JSON.stringify({ output_format: 'epub', reasoning: 'bad' }));
    mockGroqResponse(JSON.stringify({ output_format: 'docx', reasoning: 'A retry-fixed reason.' }));
    const { result, usedFallback } = await generateExportRecommendationCall(baseInput);
    expect(result.outputFormat).toBe('docx');
    expect(usedFallback).toBe(false);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('falls back to the deterministic default after both attempts fail, never throwing', async () => {
    mockGroqResponse(JSON.stringify({ output_format: 'epub', reasoning: 'bad' }));
    mockGroqResponse('not json at all');
    const { result, usedFallback } = await generateExportRecommendationCall(baseInput);
    expect(result).toEqual(fallbackExportRecommendation());
    expect(usedFallback).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe('fallbackExportRecommendation', () => {
  it('always recommends pdf as the universal safe default', () => {
    expect(fallbackExportRecommendation().outputFormat).toBe('pdf');
  });
});
