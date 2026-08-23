import { describe, it, expect } from 'vitest';
import { applyFullListGuardrail, applySingleItemGuardrail, validateSubtopicFields } from '../lib/subtopics/guardrail';
import { MIN_DESCRIPTION_LENGTH } from '../lib/subtopics/rules';

const okDescription = 'x'.repeat(MIN_DESCRIPTION_LENGTH);

function item(title: string, description = okDescription, depth: 'shallow' | 'medium' | 'deep' = 'medium') {
  return { title, description, depth };
}

describe('applyFullListGuardrail — field validation (rule 1)', () => {
  it('throws when subtopics is not an array', () => {
    expect(() => applyFullListGuardrail({ subtopics: 'nope' }, { min: 1, max: 10 })).toThrow(/subtopics/);
  });

  it('throws on an empty title', () => {
    expect(() => applyFullListGuardrail({ subtopics: [item('  ')] }, { min: 1, max: 10 })).toThrow(/title/);
  });

  it('throws on a description below the minimum length', () => {
    expect(() => applyFullListGuardrail({ subtopics: [item('Title', 'short')] }, { min: 1, max: 10 })).toThrow(
      /shorter than the minimum length/,
    );
  });

  it('throws on an invalid depth', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => applyFullListGuardrail({ subtopics: [item('Title', okDescription, 'deep-ish' as any)] }, { min: 1, max: 10 })).toThrow(
      /invalid depth/,
    );
  });

  it('passes through valid items unchanged', () => {
    const result = applyFullListGuardrail({ subtopics: [item('Title One'), item('Title Two')] }, { min: 1, max: 10 });
    expect(result.subtopics).toEqual([item('Title One'), item('Title Two')]);
  });
});

describe('applyFullListGuardrail — count-range enforcement (rule 3)', () => {
  it('truncates over-max, dropping the tail', () => {
    const subtopics = [item('One'), item('Two'), item('Three'), item('Four')];
    const result = applyFullListGuardrail({ subtopics }, { min: 1, max: 2 });
    expect(result.subtopics.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(result.generationStatus).toBe('succeeded');
  });

  it('accepts and flags under-min instead of padding', () => {
    const subtopics = [item('One'), item('Two')];
    const result = applyFullListGuardrail({ subtopics }, { min: 5, max: 8 });
    expect(result.subtopics).toHaveLength(2);
    expect(result.generationStatus).toBe('succeeded_below_target');
  });

  it('an empty list is succeeded_below_target for any positive minimum, not a throw', () => {
    const result = applyFullListGuardrail({ subtopics: [] }, { min: 5, max: 8 });
    expect(result.subtopics).toEqual([]);
    expect(result.generationStatus).toBe('succeeded_below_target');
  });

  it('exactly at min/max boundaries is succeeded, not below-target', () => {
    const atMin = applyFullListGuardrail({ subtopics: [item('One'), item('Two')] }, { min: 2, max: 5 });
    expect(atMin.generationStatus).toBe('succeeded');

    const atMax = applyFullListGuardrail(
      { subtopics: [item('One'), item('Two'), item('Three')] },
      { min: 1, max: 3 },
    );
    expect(atMax.subtopics).toHaveLength(3);
    expect(atMax.generationStatus).toBe('succeeded');
  });
});

describe('applyFullListGuardrail — dedup runs before truncation (rule 2)', () => {
  it('drops a later near-duplicate, keeping the earlier occurrence', () => {
    const subtopics = [item('Budget Basics'), item('Meal Planning'), item('Budget Basics for Beginners')];
    const result = applyFullListGuardrail({ subtopics }, { min: 1, max: 10 });
    expect(result.subtopics.map((s) => s.title)).toEqual(['Budget Basics', 'Meal Planning']);
  });

  it('dedup reclaims a slot before truncation would otherwise drop real content', () => {
    // 4 raw items, 2 of which are near-duplicates of each other; max=2. Deduping first
    // leaves 3 unique items, THEN truncation drops only the true excess (the 3rd
    // unique item) — not an item that would've collided with a duplicate anyway.
    const subtopics = [item('Budget Basics'), item('Budget Basics Overview'), item('Meal Planning'), item('Sleep Hygiene')];
    const result = applyFullListGuardrail({ subtopics }, { min: 1, max: 2 });
    expect(result.subtopics.map((s) => s.title)).toEqual(['Budget Basics', 'Meal Planning']);
  });
});

describe('applySingleItemGuardrail', () => {
  it('passes through a valid, non-duplicate item', () => {
    const result = applySingleItemGuardrail({ subtopic: item('Sleep Hygiene') }, ['Budget Basics', 'Meal Planning']);
    expect(result).toEqual(item('Sleep Hygiene'));
  });

  it('throws on an empty subtopic object', () => {
    expect(() => applySingleItemGuardrail({ subtopic: null }, [])).toThrow(/not an object/);
  });

  it('throws (rather than silently dropping) when the result near-duplicates a sibling', () => {
    expect(() =>
      applySingleItemGuardrail({ subtopic: item('Budget Basics for Beginners') }, ['Budget Basics', 'Meal Planning']),
    ).toThrow(/near-duplicate/);
  });
});

describe('validateSubtopicFields (manual-add/edit path, decision 18\'s bar applied to hand-entered content too)', () => {
  it('passes through valid fields, trimmed', () => {
    expect(validateSubtopicFields({ title: '  Sleep Hygiene  ', description: `  ${okDescription}  `, depth: 'deep' })).toEqual({
      title: 'Sleep Hygiene',
      description: okDescription,
      depth: 'deep',
    });
  });

  it('throws on an empty title', () => {
    expect(() => validateSubtopicFields({ title: '   ', description: okDescription, depth: 'medium' })).toThrow(/title cannot be empty/);
  });

  it('throws on an empty description', () => {
    expect(() => validateSubtopicFields({ title: 'Title', description: '  ', depth: 'medium' })).toThrow(
      /description cannot be empty/,
    );
  });

  it('throws on a description below the minimum length', () => {
    expect(() => validateSubtopicFields({ title: 'Title', description: 'too short', depth: 'medium' })).toThrow(
      /shorter than the minimum length/,
    );
  });

  it('throws on an invalid depth', () => {
    expect(() => validateSubtopicFields({ title: 'Title', description: okDescription, depth: 'super-deep' })).toThrow(
      /Invalid depth/,
    );
  });
});
