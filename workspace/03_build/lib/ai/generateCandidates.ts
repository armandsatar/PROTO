import { groqJsonCompletion } from './groq';

// The 3 generated variant axes — PROPOSED in §3.2, approved to build. The original
// title is never generated here; it's always the 4th candidate, added by the caller.
export type VariantAxis = 'niche_down' | 'format_hint' | 'keyword_optimized';

export interface GeneratedVariant {
  axis: VariantAxis;
  text: string;
}

const SYSTEM_PROMPT = `You generate 3 alternative digital product title variants from an original title idea, each along a specific axis. Respond with ONLY valid JSON in this exact shape:
{"variants": [
  {"axis": "niche_down", "text": "..."},
  {"axis": "format_hint", "text": "..."},
  {"axis": "keyword_optimized", "text": "..."}
]}

Axis definitions:
- "niche_down": same core concept, narrower audience or use-case appended, informed by the user's stated rationale for why they're pursuing this topic.
- "format_hint": same concept, different deliverable-type framing (e.g. "Template" vs "System" vs "Kit" vs "Guide" vs "Tracker").
- "keyword_optimized": rephrased to match the highest-signal phrasing found in the real competing Etsy listing titles provided below, while still describing the same core product concept.

Each variant must be a complete, standalone product title a customer could see in a store listing — not a fragment, not an explanation of the change.`;

export async function generateTitleVariants(params: {
  originalTitle: string;
  rationale: string;
  exactAngleMatchListingTitles: string[];
}): Promise<GeneratedVariant[]> {
  const userPrompt = JSON.stringify({
    originalTitle: params.originalTitle,
    rationale: params.rationale,
    exactAngleMatchListingTitles: params.exactAngleMatchListingTitles,
  });

  const result = await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt });
  const parsed = result as { variants?: unknown };

  if (!Array.isArray(parsed.variants) || parsed.variants.length !== 3) {
    throw new Error('Groq candidate generation did not return exactly 3 variants');
  }

  const validAxes: VariantAxis[] = ['niche_down', 'format_hint', 'keyword_optimized'];
  const variants = parsed.variants as GeneratedVariant[];

  for (const v of variants) {
    if (typeof v.text !== 'string' || !v.text.trim() || !validAxes.includes(v.axis)) {
      throw new Error('Groq candidate generation returned a malformed variant');
    }
  }

  const axesPresent = new Set(variants.map((v) => v.axis));
  if (axesPresent.size !== 3) {
    throw new Error('Groq candidate generation did not return one variant per axis');
  }

  return variants;
}
