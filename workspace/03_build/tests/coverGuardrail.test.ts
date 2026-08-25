import { describe, it, expect } from 'vitest';
import {
  assertCanApprove,
  assertValidLookId,
  assertCandidateCapNotExceeded,
  assertEditRoundCapNotExceeded,
} from '../lib/cover/guardrail';
import { CANDIDATE_CAP, EDIT_ROUND_CAP } from '../lib/cover/rules';
import { DEFAULT_LOOK_ID } from '../lib/cover/templates';

describe('assertCanApprove (§8 rule 1: the one deterministic hard rule)', () => {
  it('does not throw when a current generation exists', () => {
    expect(() => assertCanApprove('some-generation-id')).not.toThrow();
  });

  it('throws when there is no current generation', () => {
    expect(() => assertCanApprove(null)).toThrow(/no current cover generation/);
  });
});

describe('assertValidLookId (§8 rule 2)', () => {
  it('does not throw for a real registered look', () => {
    expect(() => assertValidLookId(DEFAULT_LOOK_ID)).not.toThrow();
  });

  it('throws for an unregistered look id', () => {
    expect(() => assertValidLookId('not-a-real-look')).toThrow(/not in the template registry/);
  });
});

describe('assertCandidateCapNotExceeded / assertEditRoundCapNotExceeded (decision 15: hard cap + acknowledgment)', () => {
  it('candidate: does not throw below the cap regardless of acknowledgment', () => {
    expect(() => assertCandidateCapNotExceeded(CANDIDATE_CAP - 1, undefined)).not.toThrow();
  });

  it('candidate: throws at the cap without acknowledgment', () => {
    expect(() => assertCandidateCapNotExceeded(CANDIDATE_CAP, undefined)).toThrow(/acknowledgeAdditionalCost/);
  });

  it('candidate: does not throw at the cap WITH acknowledgment', () => {
    expect(() => assertCandidateCapNotExceeded(CANDIDATE_CAP, true)).not.toThrow();
  });

  it('candidate: still throws with acknowledgeAdditionalCost=false explicitly', () => {
    expect(() => assertCandidateCapNotExceeded(CANDIDATE_CAP, false)).toThrow(/acknowledgeAdditionalCost/);
  });

  it('edit-round: does not throw below the cap', () => {
    expect(() => assertEditRoundCapNotExceeded(EDIT_ROUND_CAP - 1, undefined)).not.toThrow();
  });

  it('edit-round: throws at the cap without acknowledgment, passes with it', () => {
    expect(() => assertEditRoundCapNotExceeded(EDIT_ROUND_CAP, undefined)).toThrow(/acknowledgeAdditionalCost/);
    expect(() => assertEditRoundCapNotExceeded(EDIT_ROUND_CAP, true)).not.toThrow();
  });
});
