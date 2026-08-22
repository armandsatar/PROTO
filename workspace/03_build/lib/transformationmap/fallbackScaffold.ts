import type { RawTransformationMapContent } from './types';

/**
 * Decision 6: labeled placeholder scaffolding, not a computed value. Neither Phase 2's
 * keyword heuristic nor Phase 3's conservative safe default has a real analog here —
 * no keyword rule or default enum can write genuine emotional narrative prose.
 * Takes no title/rationale params — always the same scaffold, distinct in KIND from
 * the prior two fallbacks, not a smaller version of either. Deliberately long enough
 * and before/after-distinct enough to still pass applyTransformationMapGuardrail()
 * cleanly, so the fallback path composes through the same guardrail as the AI path
 * (same precedent as Phase 2/3's fallbacks).
 */
export function transformationMapFallbackScaffold(): RawTransformationMapContent {
  return {
    headline_before: '[Describe how your customer feels or where they are before using this product]',
    headline_after: '[Describe how your customer feels or where they are after using this product]',
    dim_emotional_before: "[Describe the customer's emotional state before — how they feel, gut-level, not what they think]",
    dim_emotional_after: "[Describe the customer's emotional state after — how they feel, gut-level, not what they think]",
    dim_practical_before: '[Describe what the customer concretely does day-to-day before — actions, time spent, tools used]',
    dim_practical_after: '[Describe what the customer concretely does day-to-day after — actions, time spent, tools used]',
    dim_identity_before: '[Describe how the customer sees themselves before — the story they tell about who they are]',
    dim_identity_after: '[Describe how the customer sees themselves after — the story they tell about who they are]',
    dim_pain_point_before: '[Describe one specific, sensory, moment-level trigger of the problem before]',
    dim_pain_point_after: '[Describe that same specific moment, resolved, after]',
  };
}
