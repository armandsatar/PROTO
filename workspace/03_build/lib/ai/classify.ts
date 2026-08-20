import { groqJsonCompletion } from './groq';
import type { EtsyListing } from '../data-sources/etsy';

// Tri-state per §2.1: "Exact angle" is an LLM semantic classification step, not a
// keyword-count heuristic — a discrete, structured call producing a label per listing.
export type AngleMatchLabel = 'exact_angle' | 'broad_topic' | 'unrelated';

export interface ClassifiedListing {
  listingId: string;
  label: AngleMatchLabel;
}

const SYSTEM_PROMPT = `You classify Etsy listing titles against a candidate digital product title to determine whether they target the exact same specific product angle, not just the same broad topic.

Respond with ONLY valid JSON in this exact shape:
{"classifications": [{"listingId": "...", "label": "exact_angle" | "broad_topic" | "unrelated"}, ...]}

Label definitions:
- "exact_angle": the listing is the same specific product concept as the candidate title — same core deliverable AND same specific angle/audience/use-case. Example: candidate "Notion Budget Tracker for Freelancers" vs listing "Notion Budget Template for Freelance Creatives" -> exact_angle. But candidate "Notion Budget Tracker for Freelancers" vs listing "Notion Budget Template" (no freelancer angle) -> broad_topic, NOT exact_angle, even though both are Notion budget products.
- "broad_topic": same general topic/category but a meaningfully different specific angle, audience, or use case than the candidate.
- "unrelated": not meaningfully related to the candidate title's topic at all.

Classify every single listing provided, in the same order. Do not skip any listing.`;

export async function classifyExactAngleMatches(
  candidateTitle: string,
  listings: EtsyListing[],
): Promise<ClassifiedListing[]> {
  if (listings.length === 0) return [];

  const userPrompt = JSON.stringify({
    candidateTitle,
    listings: listings.map((l) => ({ listingId: l.listingId, title: l.title })),
  });

  const result = await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt });
  const parsed = result as { classifications?: unknown };

  if (!Array.isArray(parsed.classifications)) {
    throw new Error('Groq classification response missing a "classifications" array');
  }

  const validLabels: AngleMatchLabel[] = ['exact_angle', 'broad_topic', 'unrelated'];
  const classifications = parsed.classifications as ClassifiedListing[];

  for (const c of classifications) {
    if (typeof c.listingId !== 'string' || !validLabels.includes(c.label)) {
      throw new Error('Groq classification response contained a malformed entry');
    }
  }

  return classifications;
}
