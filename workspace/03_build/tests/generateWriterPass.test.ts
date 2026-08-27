import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCompletion } = vi.hoisted(() => ({ mockCompletion: vi.fn() }));
vi.mock('../lib/copywriting/aiProvider', () => ({ copywritingJsonCompletion: mockCompletion }));

import { generateNarrativeWriterPass, generatePlatformAdaptationWriterPass } from '../lib/copywriting/generateWriterPass';

const baseNarrativeInput = {
  title: 'Notion Budget Tracker for Freelancers',
  rationale: 'Freelancers want ongoing tracking.',
  confirmedFormat: 'workbook' as const,
  confirmedDeliveryMode: 'fillable',
  headlineBefore: 'Overwhelmed by irregular income',
  headlineAfter: 'In control of every dollar',
  dimEmotionalBefore: 'Anxious',
  dimEmotionalAfter: 'Calm',
  dimPracticalBefore: 'No system',
  dimPracticalAfter: 'A real system',
  dimIdentityBefore: 'Reactive',
  dimIdentityAfter: 'Proactive',
  dimPainPointBefore: 'Missed payments',
  dimPainPointAfter: 'Never missed',
  subtopics: [{ title: 'Module 1', description: 'Intro' }],
  contentBodies: [{ subtopicTitle: 'Module 1', body: 'Real specific content about invoice tracking.' }],
  coverLookMoodDescriptor: 'editorial and serif-driven',
};

describe('generateNarrativeWriterPass', () => {
  beforeEach(() => mockCompletion.mockReset());

  it('returns validated narrative fields', async () => {
    mockCompletion.mockResolvedValueOnce({ hook: 'A real hook', transformation_story: 'A real story', cta: 'Buy now', summary: 'A real summary' });
    const result = await generateNarrativeWriterPass(baseNarrativeInput);
    expect(result.fields.hook).toBe('A real hook');
    expect(mockCompletion).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output, then throws if still malformed', async () => {
    mockCompletion.mockResolvedValueOnce({ hook: '' }).mockResolvedValueOnce({ hook: '' });
    await expect(generateNarrativeWriterPass(baseNarrativeInput)).rejects.toThrow(/failed after retry/);
    expect(mockCompletion).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the retry after an initial malformed response', async () => {
    mockCompletion
      .mockResolvedValueOnce({ hook: '' })
      .mockResolvedValueOnce({ hook: 'A real hook', transformation_story: 'A real story', cta: 'Buy now', summary: 'A real summary' });
    const result = await generateNarrativeWriterPass(baseNarrativeInput);
    expect(result.fields.hook).toBe('A real hook');
  });
});

const baseNarrative = { hook: 'A real hook', transformationStory: 'A real story', cta: 'Buy now', summary: 'A real summary' };
const basePlatformInput = { platform: 'etsy' as const, narrative: baseNarrative, title: 'Notion Budget Tracker', confirmedFormat: 'workbook' as const, confirmedDeliveryMode: 'fillable' };

describe('generatePlatformAdaptationWriterPass', () => {
  beforeEach(() => mockCompletion.mockReset());

  it('returns a within-limit result on the first attempt without retrying', async () => {
    mockCompletion.mockResolvedValueOnce({ title: 'Short Etsy Title', body: 'A description', platform_fields: { tags: ['budget'] } });
    const result = await generatePlatformAdaptationWriterPass(basePlatformInput);
    expect(result.hardLimitStatus).toBe('within_limit');
    expect(mockCompletion).toHaveBeenCalledTimes(1);
  });

  it('retries once when the title exceeds the hard limit, naming the overage in feedback', async () => {
    mockCompletion
      .mockResolvedValueOnce({ title: 'x'.repeat(150), body: 'A description', platform_fields: {} })
      .mockResolvedValueOnce({ title: 'A short fixed title', body: 'A description', platform_fields: {} });
    const result = await generatePlatformAdaptationWriterPass(basePlatformInput);
    expect(result.hardLimitStatus).toBe('within_limit');
    expect(mockCompletion).toHaveBeenCalledTimes(2);
    const secondCallArgs = mockCompletion.mock.calls[1][0];
    expect(secondCallArgs.userPrompt).toContain('hard limit');
  });

  it('returns exceeds_limit as-is (not thrown) if still over after the retry — never silently dropped', async () => {
    mockCompletion.mockResolvedValue({ title: 'x'.repeat(150), body: 'A description', platform_fields: {} });
    const result = await generatePlatformAdaptationWriterPass(basePlatformInput);
    expect(result.hardLimitStatus).toBe('exceeds_limit');
    expect(result.title?.length).toBe(150);
    expect(mockCompletion).toHaveBeenCalledTimes(2);
  });

  it('never retries for a platform with no configured hard limit (StanStore)', async () => {
    mockCompletion.mockResolvedValueOnce({ title: 'x'.repeat(500), body: 'y'.repeat(500), platform_fields: {} });
    const result = await generatePlatformAdaptationWriterPass({ ...basePlatformInput, platform: 'stanstore' });
    expect(result.hardLimitStatus).toBe('within_limit');
    expect(mockCompletion).toHaveBeenCalledTimes(1);
  });

  it('throws when the body is malformed even after retry', async () => {
    mockCompletion.mockResolvedValue({ title: 'ok', body: '', platform_fields: {} });
    await expect(generatePlatformAdaptationWriterPass(basePlatformInput)).rejects.toThrow(/failed after retry/);
  });
});
