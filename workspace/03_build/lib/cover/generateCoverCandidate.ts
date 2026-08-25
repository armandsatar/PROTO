import { nanoBananaInteraction } from '../ai/nanobanana';
import { computeCostUsd } from './rules';
import { getLookById } from './templates';
import type { CoverLook } from './types';
import type { FormatType } from '../format/types';

export interface GenerateCoverCandidateInput {
  title: string;
  rationale: string;
  confirmedFormat: FormatType;
  lookId: string;
}

export interface GenerateCoverCandidateResult {
  interactionId: string;
  imageDataBase64: string;
  mimeType: string;
  costUsd: number;
}

// §2.2's Anti-Slop imagery rule, carried as prompt-engineering responsibility (§8 rule
// 5 — this is the entire mechanism, there is no runtime image-quality guardrail).
function buildCandidatePrompt(input: GenerateCoverCandidateInput, look: CoverLook): string {
  return [
    `Generate a background/hero art image for a digital product cover.`,
    `Product title: "${input.title}"`,
    `Context: ${input.rationale}`,
    `Product format: ${input.confirmedFormat}`,
    `The cover's visual style is "${look.name}" — palette: background ${look.palette.background}, accent ${look.palette.accent}. Match this mood and color feel.`,
    `Style requirement: stylized, illustrative art — NOT a photorealistic stock-photo look. Avoid generic AI-stock-photo composition (centered subject, obvious airbrushed lighting). No text or lettering in the image — text is added separately by the template layout.`,
  ].join('\n');
}

/**
 * §7.8's Explicit Generate Cover / Regenerate candidate action's AI call
 * (trigger_scope='initial_candidate') — one Nano Banana 2 call, no continuation.
 */
export async function generateCoverCandidate(input: GenerateCoverCandidateInput): Promise<GenerateCoverCandidateResult> {
  const look = getLookById(input.lookId);
  if (!look) throw new Error(`Unknown look id: ${input.lookId}`);

  const prompt = buildCandidatePrompt(input, look);
  const result = await nanoBananaInteraction({ input: prompt });

  return {
    interactionId: result.interactionId,
    imageDataBase64: result.imageDataBase64,
    mimeType: result.mimeType,
    costUsd: computeCostUsd({ totalInputTokens: result.totalInputTokens, totalOutputTokens: result.totalOutputTokens }),
  };
}
