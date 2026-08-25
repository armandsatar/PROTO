import { describe, it, expect } from 'vitest';
import { COVER_LOOKS, getLookById, isValidLookId, DEFAULT_LOOK_ID } from '../lib/cover/templates';

describe('COVER_LOOKS registry (decision 4: code-level, non-mixable bundles)', () => {
  it('has exactly 2 placeholder looks, each a complete bundle', () => {
    expect(COVER_LOOKS).toHaveLength(2);
    for (const look of COVER_LOOKS) {
      expect(look.id).toBeTruthy();
      expect(look.palette.background).toBeTruthy();
      expect(look.palette.accent).toBeTruthy();
      expect(look.palette.text).toBeTruthy();
      expect(look.fontPairing.heading).toBeTruthy();
      expect(look.fontPairing.body).toBeTruthy();
    }
  });

  it('has unique ids', () => {
    const ids = COVER_LOOKS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getLookById / isValidLookId', () => {
  it('finds a real registered look', () => {
    const look = getLookById(DEFAULT_LOOK_ID);
    expect(look).toBeDefined();
    expect(look?.id).toBe(DEFAULT_LOOK_ID);
  });

  it('returns undefined / false for an unregistered id', () => {
    expect(getLookById('not-a-real-look')).toBeUndefined();
    expect(isValidLookId('not-a-real-look')).toBe(false);
  });

  it('DEFAULT_LOOK_ID is itself a valid registered look', () => {
    expect(isValidLookId(DEFAULT_LOOK_ID)).toBe(true);
  });
});
