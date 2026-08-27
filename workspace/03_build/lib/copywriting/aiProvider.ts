import { groqJsonCompletion, GROQ_MODEL } from '../ai/groq';
import { claudeJsonCompletion, ANTHROPIC_MODEL } from '../ai/claude';
import { openaiJsonCompletion, OPENAI_MODEL } from '../ai/openai';

export type CopywritingProvider = 'groq' | 'claude' | 'openai';

/**
 * Decision 13's scoped provider switch — explicit and static (an env var), not the
 * general natural-language router described in the product spec (confirmed not built
 * anywhere in this codebase). Defaults to 'groq', the only path live-verified in this
 * build; Arman flips this himself once he has a real Claude/OpenAI key.
 */
export function getCopywritingProvider(): CopywritingProvider {
  const raw = (process.env.COPYWRITING_AI_PROVIDER || 'groq').toLowerCase();
  if (raw === 'groq' || raw === 'claude' || raw === 'openai') return raw;
  throw new Error(`Unknown COPYWRITING_AI_PROVIDER: "${raw}" — expected "groq", "claude", or "openai"`);
}

export function getCopywritingModelName(provider: CopywritingProvider = getCopywritingProvider()): string {
  switch (provider) {
    case 'groq':
      return GROQ_MODEL;
    case 'claude':
      return ANTHROPIC_MODEL;
    case 'openai':
      return OPENAI_MODEL;
  }
}

export interface JsonCompletionParams {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxCompletionTokens?: number;
}

export async function copywritingJsonCompletion(params: JsonCompletionParams): Promise<unknown> {
  const provider = getCopywritingProvider();
  switch (provider) {
    case 'groq':
      return groqJsonCompletion(params);
    case 'claude':
      return claudeJsonCompletion(params);
    case 'openai':
      return openaiJsonCompletion(params);
  }
}
