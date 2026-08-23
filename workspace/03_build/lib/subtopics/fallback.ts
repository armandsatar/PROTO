import type { RawFullListResponse } from './types';

/**
 * Decision 10: AI-failure fallback for whole-list generation is an honest empty list,
 * not a fabricated placeholder count — there's no principled basis for how many items
 * to invent, unlike Step 4/6's fallbacks which had a fixed shape to scaffold into.
 * Single-item failures need no fallback module at all (decision 11) — the
 * orchestration layer just leaves the target row untouched, since nothing was
 * overwritten yet.
 */
export function fullListFallback(): RawFullListResponse {
  return { subtopics: [] };
}
