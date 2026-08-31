import { groqJsonCompletion } from '../ai/groq';
import type { GeneratedSeed } from './types';

const SYSTEM_PROMPT = `You are a digital product market analyst specializing in Etsy, Gumroad, and similar creator marketplaces. Generate specific digital product niche ideas that:
1. Target creators, solopreneurs, freelancers, or small businesses
2. Are deliverable as templates, guides, trackers, workbooks, planners, or systems
3. Have potential demand on digital product marketplaces
4. Are specific enough to be an actual product title (not a broad category)

Respond with ONLY valid JSON in this exact shape:
{"seeds": [{"title": "Notion Budget Tracker for Freelancers", "rationale": "Freelancers need expense tracking..."}, ...]}

Each title must be 10-100 characters. Each rationale must be one sentence explaining why this niche has potential.`;

/**
 * AI brainstorm pass: generates 20-30 niche seed ideas via Groq (the "Suggest
 * More Niches" feature, decision 5). Validates output and rejects malformed seeds.
 */
export async function generateSeeds(params?: { count?: number }): Promise<GeneratedSeed[]> {
  const count = params?.count ?? 20;

  const userPrompt = `Generate exactly ${count} digital product niche ideas. Each should be a specific, standalone product title a customer could find in a store listing. Avoid oversaturated niches like generic "resume template" or "social media planner." Focus on underserved angles, specific audiences, or emerging needs.`;

  const result = await groqJsonCompletion({ systemPrompt: SYSTEM_PROMPT, userPrompt });
  const parsed = result as { seeds?: unknown };

  if (!Array.isArray(parsed.seeds)) {
    throw new Error('Groq seed generation did not return a seeds array');
  }

  const seeds = (parsed.seeds as GeneratedSeed[]).filter((s) => {
    if (typeof s.title !== 'string' || typeof s.rationale !== 'string') return false;
    if (s.title.trim().length < 10 || s.title.trim().length > 100) return false;
    if (s.rationale.trim().length === 0) return false;
    return true;
  });

  if (seeds.length === 0) {
    throw new Error('Groq seed generation returned no valid seeds after validation');
  }

  return seeds.map((s) => ({
    title: s.title.trim(),
    rationale: s.rationale.trim(),
  }));
}
