import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class MockGroq {
    chat = { completions: { create: mockCreate } };
  }
  return { default: MockGroq };
});

import { generateReviewPass } from '../lib/content/generateReviewPass';

const baseInput = {
  title: 'Notion Budget Tracker for Freelancers',
  subtopicTitle: 'Setting Up Your Weekly Budget Foundation',
  subtopicDescription: 'Defines fixed vs. variable expenses before tracking begins.',
  draftContent: 'This routine guarantees great results and is 100% effective for everyone.',
};

function mockGroqResponse(content: string) {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

const cleanResponse = JSON.stringify({
  final_content: 'Set up your baseline weekly budget by separating fixed costs from variable spending.',
  compliance_changes: [],
  specificity_score: 8,
  specificity_issues: [],
});

describe('generateReviewPass', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.GROQ_API_KEY = 'test-key';
  });

  it('returns a validated result on a clean valid first response, no retry', async () => {
    mockGroqResponse(cleanResponse);
    const result = await generateReviewPass(baseInput);
    expect(result.specificityScore).toBe(8);
    expect(result.complianceChanges).toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retries once on malformed output, then succeeds on the second attempt', async () => {
    mockGroqResponse(JSON.stringify({ final_content: '' }));
    mockGroqResponse(cleanResponse);

    const result = await generateReviewPass(baseInput);
    expect(result.specificityScore).toBe(8);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('throws after two consecutive malformed responses (retry exhausted)', async () => {
    mockGroqResponse(JSON.stringify({ final_content: '' }));
    mockGroqResponse(JSON.stringify({ final_content: '' }));

    await expect(generateReviewPass(baseInput)).rejects.toThrow(/Review pass failed after retry/);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries once when the specificity score is below threshold, then accepts a passing second attempt', async () => {
    mockGroqResponse(JSON.stringify({ final_content: 'Generic content.', compliance_changes: [], specificity_score: 4, specificity_issues: ['too generic'] }));
    mockGroqResponse(cleanResponse);

    const result = await generateReviewPass(baseInput);
    expect(result.specificityScore).toBe(8);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const secondCallArgs = mockCreate.mock.calls[1][0];
    const userMessage = secondCallArgs.messages.find((m: { role: string }) => m.role === 'user');
    expect(JSON.parse(userMessage.content).retry_feedback).toMatch(/specificity/i);
  });

  it('retries once on 3+ distinct AI-slop hits, then accepts a clean second attempt', async () => {
    mockGroqResponse(
      JSON.stringify({
        final_content: 'It is crucial to leverage a robust, seamless system.',
        compliance_changes: [],
        specificity_score: 8,
        specificity_issues: [],
      }),
    );
    mockGroqResponse(cleanResponse);

    const result = await generateReviewPass(baseInput);
    expect(result.finalContent).toBe('Set up your baseline weekly budget by separating fixed costs from variable spending.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('force-flags an uncovered absolutist phrase still present after retry is exhausted', async () => {
    const stillClaimyContent = 'This routine guarantees great results for you.';
    mockGroqResponse(JSON.stringify({ final_content: stillClaimyContent, compliance_changes: [], specificity_score: 8, specificity_issues: [] }));
    mockGroqResponse(JSON.stringify({ final_content: stillClaimyContent, compliance_changes: [], specificity_score: 8, specificity_issues: [] }));

    const result = await generateReviewPass(baseInput);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    const forceFlagged = result.complianceChanges.find((c) => c.detectedBy === 'deterministic_keyword_catch');
    expect(forceFlagged).toBeDefined();
    expect(forceFlagged?.rewrittenText).toBe(forceFlagged?.originalText);
    expect(forceFlagged?.originalText).toContain('guarantees');
  });

  it('does not force-flag when the retry successfully addresses the claim', async () => {
    mockGroqResponse(JSON.stringify({ final_content: 'This routine guarantees great results.', compliance_changes: [], specificity_score: 8, specificity_issues: [] }));
    mockGroqResponse(
      JSON.stringify({
        final_content: 'This routine may support good results for some people.',
        compliance_changes: [
          { original_text: 'guarantees great results', rewritten_text: 'may support good results for some people', reason: 'Overstated claim.', risk_category: 'unsupported_claim' },
        ],
        specificity_score: 8,
        specificity_issues: [],
      }),
    );

    const result = await generateReviewPass(baseInput);
    expect(result.complianceChanges.some((c) => c.detectedBy === 'deterministic_keyword_catch')).toBe(false);
    expect(result.complianceChanges.some((c) => c.detectedBy === 'ai_judgment')).toBe(true);
  });
});
