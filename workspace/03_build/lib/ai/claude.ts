import Anthropic from '@anthropic-ai/sdk';

// Decision 13 (phase8-requirements.md, added 2026-08-27): a real, scoped connector for
// Step 10's provider switch, not a stub. Configurable via env var since Anthropic's
// model lineup moves — same "don't hardcode a model name you can't re-verify" lesson
// lib/ai/groq.ts already learned the hard way.
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

let client: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Claude's Messages API has no native json_object response mode the way Groq/OpenAI
// do — some responses wrap JSON in a markdown code fence despite instructions not to.
function stripMarkdownCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return fenced ? fenced[1] : text;
}

/**
 * Same jsonCompletion shape as groqJsonCompletion, so lib/copywriting's writer/review
 * passes can call either through one dispatch function. NOT live-verified in this build
 * (a disclosed gap, phase8-requirements.md top-of-doc) — Groq stays the operative
 * default; verify this live before trusting it once a real ANTHROPIC_API_KEY is activated.
 */
export async function claudeJsonCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxCompletionTokens?: number;
}): Promise<unknown> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    system: params.systemPrompt,
    messages: [{ role: 'user', content: params.userPrompt }],
    temperature: params.temperature ?? 0.3,
    max_tokens: params.maxCompletionTokens ?? 4096,
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('Claude completion returned no text content');
  }

  const jsonText = stripMarkdownCodeFence(block.text);
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Claude completion did not return valid JSON');
  }
}
