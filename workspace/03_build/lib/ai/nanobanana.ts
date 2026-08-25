import { GoogleGenAI } from '@google/genai';

// Standard "Nano Banana 2" tier, confirmed live 2026-08-25 per
// phase7-requirements.md §3.1/§3.2 — not Lite, not Pro. Only `image/jpeg` is actually
// accepted by response_format.mime_type (live-caught correction — Google's own
// documented examples show PNG, which the real API rejects with a 400).
export const NANOBANANA_MODEL = 'gemini-3.1-flash-image';
const RESPONSE_MIME_TYPE = 'image/jpeg';

let client: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export interface NanoBananaResult {
  interactionId: string;
  imageDataBase64: string;
  mimeType: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Thin wrapper around ai.interactions.create(), mirroring lib/ai/groq.ts's shape for
 * a genuinely different call type (binary image output, not JSON text). Handles both
 * call shapes this phase needs: a fresh generation (previousInteractionId omitted,
 * trigger_scope='initial_candidate'/'style_edit'-from-scratch) and a multi-turn edit
 * continuation (previousInteractionId set to a prior call's real interactionId,
 * trigger_scope='style_edit') — confirmed live that `previous_interaction_id` is the
 * correct top-level field name per @google/genai's own type definitions, not guessed.
 *
 * Never leaks provider error internals beyond what's needed to debug (spec §2), same
 * posture as groqJsonCompletion.
 */
export async function nanoBananaInteraction(params: {
  input: string;
  previousInteractionId?: string;
  aspectRatio?: string;
  imageSize?: '0.5K' | '1K' | '2K' | '4K';
}): Promise<NanoBananaResult> {
  const ai = getGeminiClient();

  const interaction = await ai.interactions.create({
    model: NANOBANANA_MODEL,
    input: params.input,
    ...(params.previousInteractionId !== undefined ? { previous_interaction_id: params.previousInteractionId } : {}),
    response_format: {
      type: 'image',
      mime_type: RESPONSE_MIME_TYPE,
      aspect_ratio: params.aspectRatio ?? '3:4',
      image_size: params.imageSize ?? '1K',
    },
  });

  const outputImage = (interaction as unknown as { output_image?: { data?: string; mime_type?: string } }).output_image;
  if (!outputImage?.data) {
    throw new Error('Nano Banana 2 interaction returned no output_image data');
  }

  const usage = (interaction as unknown as { usage?: { total_input_tokens?: number; total_output_tokens?: number } }).usage;
  if (!usage || typeof usage.total_input_tokens !== 'number' || typeof usage.total_output_tokens !== 'number') {
    throw new Error('Nano Banana 2 interaction response missing a usable usage field');
  }

  const interactionId = (interaction as unknown as { id?: string }).id;
  if (!interactionId) {
    throw new Error('Nano Banana 2 interaction response missing its own id — cannot support future style-edit continuation');
  }

  return {
    interactionId,
    imageDataBase64: outputImage.data,
    mimeType: outputImage.mime_type ?? RESPONSE_MIME_TYPE,
    totalInputTokens: usage.total_input_tokens,
    totalOutputTokens: usage.total_output_tokens,
  };
}
