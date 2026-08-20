import Groq from 'groq-sdk';

// Zero-setup default per decision 14 — no BYOK abstraction built yet (out of scope,
// spec §6 open item). Research itself never uses this for web access (decision 3);
// it's classification/generation only, per phase1-requirements.md §2.3.
//
// NOTE: llama-3.3-70b-versatile (the model this was originally written against) returns
// 404 model_not_found as of 2026-08-20 — confirmed via a live `client.models.list()` call,
// not assumption. Groq's active model lineup on this account no longer includes any
// Llama-branded chat model at all; picked openai/gpt-oss-120b as the closest equivalent
// (large, general-purpose, JSON-mode capable). This is a real drift from how decision 14 /
// spec §5 describe the zero-setup default ("Llama via Groq") — worth a spec correction,
// flagged back to Arman rather than silently patched over.
export const GROQ_MODEL = 'openai/gpt-oss-120b';

let client: Groq | null = null;

function getGroqClient(): Groq {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set');
    }
    client = new Groq({ apiKey });
  }
  return client;
}

/**
 * Structured JSON completion. Groq's json_object mode requires the literal word "JSON"
 * to appear somewhere in the messages, or the API rejects the request — callers must
 * follow that convention in their system prompts.
 */
export async function groqJsonCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}): Promise<unknown> {
  const groq = getGroqClient();

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: params.temperature ?? 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    // Never leak provider error internals beyond what's needed to debug (spec §2)
    throw new Error('Groq completion returned no content');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Groq completion did not return valid JSON');
  }
}
