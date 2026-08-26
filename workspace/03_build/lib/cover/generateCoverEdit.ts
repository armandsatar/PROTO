import { nanoBananaInteraction } from '../ai/nanobanana';
import { computeCostUsd } from './rules';
import type { GenerateCoverCandidateResult } from './generateCoverCandidate';

export interface GenerateCoverEditInput {
  editInstruction: string;
  previousInteractionId: string;
}

/**
 * §7.8's Style-edit action's AI call (trigger_scope='style_edit') — uses Gemini's own
 * multi-turn continuation (previous_interaction_id, confirmed live per this
 * increment's own verify-gemini-edit-connector.ts), so the model already has the
 * prior image/context and only needs the new instruction, not the full product
 * context re-supplied. No prompt-construction beyond the raw instruction — §6.2
 * scopes this to a "thin prompt-construction function," not a rewritten request.
 */
export async function generateCoverEdit(input: GenerateCoverEditInput): Promise<GenerateCoverCandidateResult> {
  const prompt = `Apply this edit to the image: ${input.editInstruction}`;
  const result = await nanoBananaInteraction({ input: prompt, previousInteractionId: input.previousInteractionId });

  return {
    interactionId: result.interactionId,
    imageDataBase64: result.imageDataBase64,
    mimeType: result.mimeType,
    costUsd: computeCostUsd({ totalInputTokens: result.totalInputTokens, totalOutputTokens: result.totalOutputTokens }),
    promptSent: prompt,
  };
}
