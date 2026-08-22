// The 10-field content shape (headline pair + 4 dimension pairs, phase4-requirements.md
// §2.1). CamelCase for app code, matching the snake_case DB columns 1:1.
export interface TransformationMapContent {
  headlineBefore: string;
  headlineAfter: string;
  dimEmotionalBefore: string;
  dimEmotionalAfter: string;
  dimPracticalBefore: string;
  dimPracticalAfter: string;
  dimIdentityBefore: string;
  dimIdentityAfter: string;
  dimPainPointBefore: string;
  dimPainPointAfter: string;
}

// Unvalidated shape as it comes back from the AI (or is synthesized by the fallback
// scaffold) — deliberately `unknown` throughout; applyTransformationMapGuardrail() in
// guardrail.ts is what actually validates this. Snake_case to match the AI's JSON
// contract (§3.5) and the DB columns directly.
export interface RawTransformationMapContent {
  headline_before: unknown;
  headline_after: unknown;
  dim_emotional_before: unknown;
  dim_emotional_after: unknown;
  dim_practical_before: unknown;
  dim_practical_after: unknown;
  dim_identity_before: unknown;
  dim_identity_after: unknown;
  dim_pain_point_before: unknown;
  dim_pain_point_after: unknown;
}
