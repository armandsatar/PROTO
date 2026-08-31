import { describe, it, expect, vi } from 'vitest';

const { mockGroq } = vi.hoisted(() => ({ mockGroq: vi.fn() }));

vi.mock('../lib/ai/groq', () => ({
  groqJsonCompletion: mockGroq,
  GROQ_MODEL: 'test-model',
}));

import { generateSeeds } from '../lib/discovery/generateSeeds';

describe('generateSeeds', () => {
  it('returns valid seeds from a well-formed response', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: 'Notion Habit Tracker for Students', rationale: 'Students want habit tracking.' },
        { title: 'Wedding Budget Spreadsheet Template', rationale: 'Wedding budgets are complex.' },
        { title: 'Freelance Invoice Template PDF', rationale: 'Freelancers need invoicing.' },
      ],
    });

    const result = await generateSeeds({ count: 3 });

    expect(result).toHaveLength(3);
    expect(result[0].title).toBe('Notion Habit Tracker for Students');
    expect(result[0].rationale).toBe('Students want habit tracking.');
  });

  it('filters out seeds with too-short titles', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: 'Short', rationale: 'Too short title.' },
        { title: 'Notion Budget Tracker for Small Business', rationale: 'Valid seed.' },
      ],
    });

    const result = await generateSeeds();

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Notion Budget Tracker for Small Business');
  });

  it('filters out seeds with too-long titles', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: 'A'.repeat(101), rationale: 'Way too long.' },
        { title: 'Meal Prep Planner with Grocery List', rationale: 'Valid seed.' },
      ],
    });

    const result = await generateSeeds();

    expect(result).toHaveLength(1);
  });

  it('filters out seeds with empty rationale', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: 'Valid Title For Seed', rationale: '' },
        { title: 'Meal Prep Planner with Grocery List', rationale: 'Valid rationale.' },
      ],
    });

    const result = await generateSeeds();

    expect(result).toHaveLength(1);
  });

  it('filters out seeds with non-string fields', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: 123, rationale: 'Not a string title.' },
        { title: 'Valid Seed Title Here', rationale: null },
        { title: 'Meal Prep Planner with Grocery List', rationale: 'Valid.' },
      ],
    });

    const result = await generateSeeds();

    expect(result).toHaveLength(1);
  });

  it('trims whitespace from title and rationale', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: '  Notion Tracker Template  ', rationale: '  Needs trimming.  ' },
      ],
    });

    const result = await generateSeeds();

    expect(result[0].title).toBe('Notion Tracker Template');
    expect(result[0].rationale).toBe('Needs trimming.');
  });

  it('throws when response has no seeds array', async () => {
    mockGroq.mockResolvedValue({ niches: [] });

    await expect(generateSeeds()).rejects.toThrow('did not return a seeds array');
  });

  it('throws when all seeds are filtered out', async () => {
    mockGroq.mockResolvedValue({
      seeds: [
        { title: 'Bad', rationale: 'Too short.' },
      ],
    });

    await expect(generateSeeds()).rejects.toThrow('no valid seeds after validation');
  });

  it('passes count to the prompt', async () => {
    mockGroq.mockResolvedValueOnce({
      seeds: [{ title: 'Valid Seed Title Here', rationale: 'Good one.' }],
    });

    await generateSeeds({ count: 30 });

    const call = mockGroq.mock.calls[mockGroq.mock.calls.length - 1][0];
    expect(call.userPrompt).toContain('30');
  });

  it('defaults to 20 seeds when count is not provided', async () => {
    mockGroq.mockResolvedValueOnce({
      seeds: [{ title: 'Valid Seed Title Here', rationale: 'Good one.' }],
    });

    await generateSeeds();

    const call = mockGroq.mock.calls[mockGroq.mock.calls.length - 1][0];
    expect(call.userPrompt).toContain('20');
  });
});
