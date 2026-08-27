import OpenAI from 'openai';

// Decision 13 (phase8-requirements.md, added 2026-08-27): a real, scoped connector for
// Step 10's provider switch, not a stub. Configurable via env var for the same reason
// as ANTHROPIC_MODEL above.
export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let client: OpenAI | null = null;

function getOpenAiClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/**
 * Same jsonCompletion shape as groqJsonCompletion — Groq's own API is itself
 * OpenAI-compatible, so this is close to a 1:1 port. NOT live-verified in this build (a
 * disclosed gap, phase8-requirements.md top-of-doc) — Groq stays the operative default;
 * verify this live before trusting it once a real OPENAI_API_KEY is activated.
 */
export async function openaiJsonCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxCompletionTokens?: number;
}): Promise<unknown> {
  const openai = getOpenAiClient();

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: params.temperature ?? 0.3,
    ...(params.maxCompletionTokens !== undefined ? { max_completion_tokens: params.maxCompletionTokens } : {}),
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI completion returned no content');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('OpenAI completion did not return valid JSON');
  }
}
