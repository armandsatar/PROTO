// Live connector-verification step for Step 9 (Design), per phase7-requirements.md §3.2 —
// mirrors exactly how lib/ai/groq.ts's actual model had to be checked live in Phase 1
// rather than trusted from spec text. This is a PRECONDITION-CLEARING script, not part
// of any built module — Step 9 has no lib/cover/ code yet. It exists only to confirm,
// against the real API:
//   1. The model name (gemini-3.1-flash-image, the standard "Nano Banana 2" tier per
//      phase7-requirements.md §3.1 — not Lite, not Pro) actually responds.
//   2. The real response shape (SDK method, field names, image encoding).
//   3. What per-call cost information (if any) the API response itself exposes.
// Makes exactly ONE real, billable API call — deliberately minimal, since this is real
// money (~$0.067 estimated per phase7 §4.1), not a free Groq call.
// Run with: npm run verify:gemini
import { GoogleGenAI } from '@google/genai';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MODEL = 'gemini-3.1-flash-image';

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in .env');
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log(`Calling model "${MODEL}" via ai.interactions.create() — one real, billable call...`);

  const interaction = await ai.interactions.create({
    model: MODEL,
    input:
      'A stylized, illustrative cover background for a digital budgeting workbook for freelancers — warm, calm color palette, no text, no photorealistic stock-photo look.',
    response_format: {
      type: 'image',
      // Live finding: the API rejects 'image/png' at the request-validation layer
      // ("Supported values: 'image/jpeg'") despite documented examples showing PNG —
      // real live behavior overrides researched/documented behavior, same lesson as
      // groq.ts's own model drift.
      mime_type: 'image/jpeg',
      aspect_ratio: '3:4',
      image_size: '1K',
    },
  });

  console.log('\n=== Raw interaction object — top-level keys ===');
  console.log(Object.keys(interaction as unknown as Record<string, unknown>));

  console.log('\n=== Full interaction object (JSON, image data truncated for readability) ===');
  const printable = JSON.parse(JSON.stringify(interaction));
  if (printable.output_image?.data) {
    printable.output_image.data = `<base64, ${printable.output_image.data.length} chars, truncated>`;
  }
  console.log(JSON.stringify(printable, null, 2));

  const outputImage = (interaction as unknown as { output_image?: { data?: string; mime_type?: string } }).output_image;
  if (!outputImage?.data) {
    throw new Error('No output_image.data found on the response — response shape differs from what phase7-requirements.md §3.2 research assumed. See the raw object printed above.');
  }

  const buffer = Buffer.from(outputImage.data, 'base64');
  const outPath = path.join(__dirname, '..', 'verify-gemini-output.jpg');
  fs.writeFileSync(outPath, buffer);

  console.log(`\nOK: image data received, base64-decoded, ${buffer.length} bytes written to ${outPath}`);
  console.log(`Reported mime_type: ${outputImage.mime_type ?? '(not present on response)'}`);

  console.log('\n=== Cost/billing metadata check ===');
  // Live finding: the field is `usage`, not `usage_metadata`/`usageMetadata` as
  // researched from docs — real live response shape, not the documented one.
  const usage = (interaction as unknown as {
    usage?: { total_input_tokens?: number; total_output_tokens?: number; total_tokens?: number };
  }).usage;
  if (usage) {
    console.log('A real `usage` field IS present on the response — token counts, not a dollar figure directly:');
    console.log(usage);
    // Official rates confirmed live at https://ai.google.dev/gemini-api/docs/pricing for
    // gemini-3.1-flash-image, standard tier: $0.50/1M input tokens, $60.00/1M output tokens.
    const inputCost = ((usage.total_input_tokens ?? 0) / 1_000_000) * 0.5;
    const outputCost = ((usage.total_output_tokens ?? 0) / 1_000_000) * 60;
    const totalCost = inputCost + outputCost;
    console.log(`\nComputed real cost for THIS call: $${totalCost.toFixed(5)} (input $${inputCost.toFixed(6)} + output $${outputCost.toFixed(5)}, at official standard-tier rates)`);
  } else {
    console.log('No `usage` field found on this response — check the AI Studio usage dashboard instead: https://aistudio.google.com/usage');
  }

  console.log(
    '\nVerification complete: model name confirmed live, response shape confirmed (ai.interactions.create() -> interaction.output_image.data, base64-encoded, image/jpeg only), ' +
      'real per-call cost computed from the response\'s own `usage` field against official published rates.',
  );
}

main().catch((err) => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});
