import type { RealCopyPlatform, PlatformFields, CopyHardLimitStatus } from './types';
import { getPlatformSpec } from './platforms';

// Decision 14 (whole-batch regenerate cap), same number as every prior phase, own copy.
export const REGENERATE_CAP = 5;

export function hasReachedRegenerateCap(regenerateCount: number): boolean {
  return regenerateCount >= REGENERATE_CAP;
}

export interface PlatformDraftFields {
  title: string | null;
  body: string;
  platformFields: PlatformFields;
}

export interface HardLimitCheckResult {
  status: CopyHardLimitStatus;
  violations: string[];
}

/**
 * §4 rule 1 / decision 4: deterministic, code-level, no AI judgment involved. Returns
 * 'within_limit' trivially when the platform has no configured hardLimits at all
 * (decision 5: StanStore/Whop stay unenforced until Arman verifies real account
 * behavior) — this is the correct value, not a placeholder.
 */
export function checkHardLimits(platform: RealCopyPlatform, draft: PlatformDraftFields): HardLimitCheckResult {
  const spec = getPlatformSpec(platform);
  const limits = spec.hardLimits;
  if (!limits) return { status: 'within_limit', violations: [] };

  const violations: string[] = [];

  if (limits.titleMaxChars !== undefined && draft.title !== null && draft.title.length > limits.titleMaxChars) {
    violations.push(`Title is ${draft.title.length} chars, exceeds the ${limits.titleMaxChars}-char hard limit by ${draft.title.length - limits.titleMaxChars}.`);
  }
  if (limits.bodyMaxChars !== undefined && draft.body.length > limits.bodyMaxChars) {
    violations.push(`Body is ${draft.body.length} chars, exceeds the ${limits.bodyMaxChars}-char hard limit by ${draft.body.length - limits.bodyMaxChars}.`);
  }
  if (limits.tagMaxCount !== undefined || limits.tagMaxCharsEach !== undefined) {
    const tags = draft.platformFields.tags ?? [];
    if (limits.tagMaxCount !== undefined && tags.length > limits.tagMaxCount) {
      violations.push(`${tags.length} tags provided, exceeds the ${limits.tagMaxCount}-tag hard limit.`);
    }
    if (limits.tagMaxCharsEach !== undefined) {
      for (const tag of tags) {
        if (tag.length > limits.tagMaxCharsEach) {
          violations.push(`Tag "${tag}" is ${tag.length} chars, exceeds the ${limits.tagMaxCharsEach}-char-per-tag hard limit.`);
        }
      }
    }
  }

  return { status: violations.length > 0 ? 'exceeds_limit' : 'within_limit', violations };
}

/**
 * §2.7's soft targets — "aim for, non-blocking." No retry is triggered on a soft-target
 * miss (only a hard-limit violation triggers a retry, §4.1); this just classifies the
 * outcome for the `succeeded_outside_soft_target` generation_status (§9.3).
 */
export function meetsSoftTargets(platform: RealCopyPlatform, draft: PlatformDraftFields): boolean {
  const spec = getPlatformSpec(platform);
  const targets = spec.softTargets;
  if (targets.titleMaxChars !== undefined && draft.title !== null && draft.title.length > targets.titleMaxChars) return false;
  if (targets.bodyMaxChars !== undefined && draft.body.length > targets.bodyMaxChars) return false;
  return true;
}

// §8's 6-way document-level staleness, all soft. Own copies of the FK-equality/
// timestamp-comparison techniques established since Step 5 — no cross-phase import.
export function isTitleStale(buildTitleCandidateId: string, projectSelectedCandidateId: string | null): boolean {
  return buildTitleCandidateId !== projectSelectedCandidateId;
}

export function isFormatStale(buildFormatRecommendationId: string, projectCurrentFormatRecommendationId: string | null): boolean {
  return buildFormatRecommendationId !== projectCurrentFormatRecommendationId;
}

export function isMapStale(buildSnapshotAt: string, mapUpdatedAt: string): boolean {
  return buildSnapshotAt !== mapUpdatedAt;
}

// Gap-fill (§8.3): a direct copy of content_builds' own subtopic_list_confirmed_at
// technique — the original locked doc named this dependency but never operationalized
// a detection path for it.
export function isSubtopicsListStale(buildSnapshotAt: string, subtopicListSnapshotAt: string): boolean {
  return buildSnapshotAt !== subtopicListSnapshotAt;
}

export function isContentBuildStale(buildSnapshotAt: string, contentBuildSnapshotAt: string): boolean {
  return buildSnapshotAt !== contentBuildSnapshotAt;
}

export function isCoverLookStale(buildCoverLookSnapshot: string, liveConfirmedLookId: string): boolean {
  return buildCoverLookSnapshot !== liveConfirmedLookId;
}

export type DocumentStalenessReason = 'title_changed' | 'format_changed' | 'transformation_map_changed' | 'subtopics_list_changed' | 'content_build_changed' | 'cover_look_changed' | null;

/**
 * Precedence completed during build planning (§8.3): the original draft only named 4
 * of these 6 dependencies. Completed the way every phase has ordered precedence —
 * pipeline order — extending Step 8's own `title > format > map` exactly, with
 * subtopics list slotted between map and content since content is generated from
 * subtopics.
 */
export function detectDocumentStalenessReason(
  build: {
    titleCandidateId: string;
    formatRecommendationId: string;
    transformationMapSnapshotAt: string;
    subtopicListConfirmedAt: string;
    contentBuildConfirmedAt: string;
    coverLookSnapshot: string;
  },
  current: {
    selectedCandidateId: string | null;
    currentFormatRecommendationId: string | null;
    transformationMapUpdatedAt: string | null;
    subtopicListSnapshotAt: string | null;
    contentBuildSnapshotAt: string | null;
    confirmedLookId: string | null;
  },
): DocumentStalenessReason {
  if (isTitleStale(build.titleCandidateId, current.selectedCandidateId)) return 'title_changed';
  if (isFormatStale(build.formatRecommendationId, current.currentFormatRecommendationId)) return 'format_changed';
  if (current.transformationMapUpdatedAt !== null && isMapStale(build.transformationMapSnapshotAt, current.transformationMapUpdatedAt)) {
    return 'transformation_map_changed';
  }
  if (current.subtopicListSnapshotAt !== null && isSubtopicsListStale(build.subtopicListConfirmedAt, current.subtopicListSnapshotAt)) {
    return 'subtopics_list_changed';
  }
  if (current.contentBuildSnapshotAt !== null && isContentBuildStale(build.contentBuildConfirmedAt, current.contentBuildSnapshotAt)) {
    return 'content_build_changed';
  }
  if (current.confirmedLookId !== null && isCoverLookStale(build.coverLookSnapshot, current.confirmedLookId)) {
    return 'cover_look_changed';
  }
  return null;
}

/**
 * §8.4's new per-row dimension, independent of the 6 document-level dependencies above:
 * flags a single real platform row as stale relative to the narrative it was last
 * adapted from — the exact same frozen-snapshot-vs-live-value technique as Step 8's own
 * isSubtopicContentStale, applied one level up. `platformNarrativeSnapshotAt` is null
 * only for a platform that has never been generated yet (nothing to compare).
 */
export function isNarrativeStale(platformNarrativeSnapshotAt: string | null, liveNarrativeUpdatedAt: string): boolean {
  if (platformNarrativeSnapshotAt === null) return false;
  return platformNarrativeSnapshotAt !== liveNarrativeUpdatedAt;
}
