// Live connector-verification step specifically for the style-edit/continuation flow —
// scripts/verify-gemini-connector.ts (Step 9's precondition-clearing script) only ever
// proved a FRESH generation call works; it never exercised previous_interaction_id, the
// multi-turn continuation mechanism style-edit depends on (§6/§7.8 of
// phase7-requirements.md). This is this increment's own precondition-clearing step,
// same "don't trust research/docs, verify live" posture that already caught two real
// corrections during the first connector check.
//
// Makes TWO real, billable calls: one fresh generation, then one continuation edit
// against it. Run with: npm run verify:gemini-edit
import { generateCoverCandidate } from '../lib/cover/generateCoverCandidate';
import { generateCoverEdit } from '../lib/cover/generateCoverEdit';
import { DEFAULT_LOOK_ID, getLookById } from '../lib/cover/templates';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const look = getLookById(DEFAULT_LOOK_ID)!;
  console.log(`=== Fresh generation (trigger_scope=initial_candidate), look="${look.name}" ===`);
  const candidate = await generateCoverCandidate({
    title: 'Notion Budget Tracker for Freelancers',
    rationale: 'Freelancers want ongoing tracking and dread irregular income.',
    confirmedFormat: 'workbook',
    lookId: DEFAULT_LOOK_ID,
  });
  console.log(`interactionId=${candidate.interactionId}, costUsd=${candidate.costUsd}, mimeType=${candidate.mimeType}`);

  const beforeBuffer = Buffer.from(candidate.imageDataBase64, 'base64');
  const beforePath = path.join(__dirname, '..', 'verify-gemini-edit-before.jpg');
  fs.writeFileSync(beforePath, beforeBuffer);
  console.log(`Saved ${beforeBuffer.length} bytes to ${beforePath}`);

  console.log(`\n=== Style-edit continuation (trigger_scope=style_edit, previous_interaction_id=${candidate.interactionId}) ===`);
  const edited = await generateCoverEdit({
    editInstruction: 'Make the color palette noticeably warmer, with more orange and gold tones.',
    previousInteractionId: candidate.interactionId,
  });
  console.log(`interactionId=${edited.interactionId}, costUsd=${edited.costUsd}, mimeType=${edited.mimeType}`);

  if (edited.interactionId === candidate.interactionId) {
    throw new Error('Edited interaction returned the SAME interactionId as the original — continuation may not be working as expected');
  }

  const afterBuffer = Buffer.from(edited.imageDataBase64, 'base64');
  const afterPath = path.join(__dirname, '..', 'verify-gemini-edit-after.jpg');
  fs.writeFileSync(afterPath, afterBuffer);
  console.log(`Saved ${afterBuffer.length} bytes to ${afterPath}`);

  console.log(
    `\nVerification complete: continuation call succeeded, returned a DIFFERENT interactionId (${edited.interactionId}) from the original (${candidate.interactionId}), confirming previous_interaction_id genuinely chains a new turn rather than being silently ignored. Compare ${beforePath} and ${afterPath} to confirm the edit instruction was visually applied — no automated check can verify that (§8 rule 5), this needs a human look.`,
  );
}

main().catch((err) => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});
