import { groqJsonCompletion } from '../ai/groq';
import { applyTransformationMapGuardrail } from './guardrail';
import type { TransformationMapContent, RawTransformationMapContent } from './types';

export interface GenerateTransformationMapInput {
  title: string;
  rationale: string;
  demandScore: number;
  demandSignalDetail: unknown;
  competitionScore: number;
  competitionSignalDetail: unknown;
}

// §3.1's inputs — format and lead magnet decision are deliberately excluded (decision
// 7): the transformation is about the customer's psychology on the topic, not the
// product's delivery mechanism. §3.2: the "visceral" requirement is carried by the
// prompt itself (structure + a genuine few-shot example), not a post-hoc guardrail —
// there's no hard business rule to enforce here the way Phase 2/3 had (decision 4).
const SYSTEM_PROMPT = `You generate a "Visceral Transformation Map" for a digital product: a structured before/after customer journey across 5 pairs of fields, describing the customer's emotional, practical, and identity-level transformation — not a feature list.

This must be VISCERAL: gut-level, sensory, and specific — not generic mood words or feature-benefit phrasing. Ground every field in a specific, concrete moment or feeling, not an abstract category.

Respond with ONLY valid JSON in this exact shape:
{
  "headline_before": "...",
  "headline_after": "...",
  "dim_emotional_before": "...",
  "dim_emotional_after": "...",
  "dim_practical_before": "...",
  "dim_practical_after": "...",
  "dim_identity_before": "...",
  "dim_identity_after": "...",
  "dim_pain_point_before": "...",
  "dim_pain_point_after": "..."
}

Field definitions:
- headline_before/after: one-sentence, high-level summary of the transformation — the "at a glance" version.
- dim_emotional_before/after: how the customer FEELS, gut-level — not what they think or do.
- dim_practical_before/after: what the customer concretely DOES day-to-day — actions, time spent, tools used.
- dim_identity_before/after: how the customer sees THEMSELVES — the story they tell about who they are.
- dim_pain_point_before/after: one concrete, sensory, moment-specific trigger scenario — a single specific moment, not an abstract category. This field is most responsible for making the map feel visceral rather than generic.

Rules:
- Every field must be several sentences of genuine, specific narrative — never a single generic phrase like "feels stressed" or "saves time."
- Avoid generic feature-benefit language ("saves time," "more organized," "less stressed") — ground every claim in a specific feeling, moment, or behavior instead.
- Before and after must never be near-copies of each other within a pair — show a real transformation.

Example (for a DIFFERENT product, showing the expected tone and specificity only — do not reuse this content):

Input: title="Notion Budget Tracker for Freelancers", rationale="Freelancers want ongoing tracking, and dread the unpredictability of irregular income."

Output:
{
  "headline_before": "Dreads opening her finances every Sunday night.",
  "headline_after": "Feels a calm, almost boring sense that money is handled.",
  "dim_emotional_before": "A knot in her stomach every Sunday night before the week's bills are due — a low-grade dread that builds all weekend.",
  "dim_emotional_after": "Sunday nights are just Sunday nights again. No dread, no bracing herself before opening the banking app.",
  "dim_practical_before": "Manually reconciling four spreadsheets and two banking apps, roughly two hours every week, often redone from scratch after a mistake.",
  "dim_practical_after": "Opens one dashboard that updates itself. Checks it in under five minutes, twice a week, out of habit rather than necessity.",
  "dim_identity_before": "\\"I'm just bad with money. I'll never really get ahead, no matter how hard I try.\\"",
  "dim_identity_after": "\\"I'm someone who has this handled. I'm not perfect with money, but I'm in control of my own future.\\"",
  "dim_pain_point_before": "Opening the banking app and feeling a stomach-drop of dread before she's even looked at the number.",
  "dim_pain_point_after": "Opening the banking app on autopilot — no bracing, no dread — because there are no surprises left to find."
}

Now generate a new, original transformation map for the actual product described in the user message below — do not reuse the example's content, only its tone and structure.`;

/**
 * §2.2's single Groq call. Retries once on malformed/degenerate output (guardrail
 * rules), same pattern as every prior phase's AI call. No hybrid deterministic
 * scoring layer to combine with here — unlike Steps 4/5, there's no classification to
 * make, just generation, so the guardrail's job is structural validation only (§3.3).
 */
export async function generateTransformationMap(input: GenerateTransformationMapInput): Promise<TransformationMapContent> {
  const userPrompt = JSON.stringify({
    title: input.title,
    rationale: input.rationale,
    demand_score: input.demandScore,
    demand_signal_detail: input.demandSignalDetail,
    competition_score: input.competitionScore,
    competition_signal_detail: input.competitionSignalDetail,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = (await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt })) as RawTransformationMapContent;
      return applyTransformationMapGuardrail(raw);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Transformation map generation failed after retry: ${lastError instanceof Error ? lastError.message : 'unknown error'}`,
  );
}
