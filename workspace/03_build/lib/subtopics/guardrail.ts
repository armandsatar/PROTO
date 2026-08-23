import type {
  RawFullListResponse,
  RawSingleItemResponse,
  RawSubtopicItem,
  Subtopic,
  SubtopicDepth,
  FullListGuardrailResult,
  TargetCountRange,
} from './types';
import { meetsMinLength, isNearDuplicate } from './rules';

const VALID_DEPTHS: readonly SubtopicDepth[] = ['shallow', 'medium', 'deep'];

function isValidDepth(v: unknown): v is SubtopicDepth {
  return typeof v === 'string' && (VALID_DEPTHS as readonly string[]).includes(v);
}

function validateSubtopicItem(raw: unknown, index: number): Subtopic {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Subtopic at index ${index} is not an object`);
  }
  const item = raw as RawSubtopicItem;

  if (typeof item.title !== 'string' || !item.title.trim()) {
    throw new Error(`Subtopic at index ${index} has an empty or missing title`);
  }
  const title = item.title.trim();

  if (typeof item.description !== 'string' || !item.description.trim()) {
    throw new Error(`Subtopic at index ${index} has an empty or missing description`);
  }
  const description = item.description.trim();
  if (!meetsMinLength(description)) {
    throw new Error(`Subtopic at index ${index} description is shorter than the minimum length: "${description}"`);
  }

  if (!isValidDepth(item.depth)) {
    throw new Error(`Subtopic at index ${index} has an invalid depth: ${JSON.stringify(item.depth)}`);
  }

  return { title, description, depth: item.depth };
}

/**
 * §3.4's full-list guardrail. Rule 1: field validation (empty/short/invalid-enum
 * throws, same retry-once posture as every prior phase's AI call). Rule 2: dedup —
 * drop later near-duplicates, keep the earlier occurrence (decision 8: not worth a
 * third call over one redundant item). Rule 3: count-range enforcement — truncate
 * over-max (drop the tail), accept-but-flag under-min via generationStatus rather than
 * padding with fabricated content (decisions 8/9/10). Dedup runs BEFORE truncation:
 * deduping first reclaims slots from redundant items so real content isn't dropped to
 * make room for a duplicate that would've been dropped anyway.
 */
export function applyFullListGuardrail(raw: RawFullListResponse, target: TargetCountRange): FullListGuardrailResult {
  if (!Array.isArray(raw.subtopics)) {
    throw new Error('AI response missing a "subtopics" array');
  }

  const validated = raw.subtopics.map((item, i) => validateSubtopicItem(item, i));

  const deduped: Subtopic[] = [];
  for (const item of validated) {
    const isDup = deduped.some((existing) => isNearDuplicate(existing.title, item.title));
    if (!isDup) deduped.push(item);
  }

  const truncated = deduped.length > target.max ? deduped.slice(0, target.max) : deduped;

  const generationStatus: 'succeeded' | 'succeeded_below_target' =
    truncated.length < target.min ? 'succeeded_below_target' : 'succeeded';

  return { subtopics: truncated, generationStatus };
}

/**
 * §3.4's single-item guardrail: same rule-1 field validation, plus a dedup check
 * against the CURRENT live sibling list (not the original generation's own output —
 * a different comparison set than the full-list guardrail's rule 2). Unlike the
 * full-list guardrail, a duplicate here is not silently dropped — it throws, so the
 * caller's existing retry-once wrapper gets another attempt at a genuinely new title.
 */
export function applySingleItemGuardrail(raw: RawSingleItemResponse, siblingTitles: string[]): Subtopic {
  const item = validateSubtopicItem(raw.subtopic, 0);

  const isDup = siblingTitles.some((sibling) => isNearDuplicate(sibling, item.title));
  if (isDup) {
    throw new Error(`Regenerated subtopic "${item.title}" is a near-duplicate of an existing sibling`);
  }

  return item;
}
