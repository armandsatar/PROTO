import { describe, it, expect } from 'vitest';
import { writerFailureFallback } from '../lib/content/fallback';

describe('writerFailureFallback (decision 10 continuation: honest empty body, never fabricated)', () => {
  it('returns an empty string', () => {
    expect(writerFailureFallback()).toBe('');
  });
});
