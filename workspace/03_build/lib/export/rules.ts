// §7's 4-way document-level staleness, all soft, per format (§7.2's own precedence:
// title > format > content bodies > cover). Own copies of the FK-equality/timestamp-
// comparison techniques established since Step 5 — no cross-phase import.
export function isTitleStale(stateTitleCandidateId: string, projectSelectedCandidateId: string | null): boolean {
  return stateTitleCandidateId !== projectSelectedCandidateId;
}

export function isFormatStale(stateFormatRecommendationId: string, projectCurrentFormatRecommendationId: string | null): boolean {
  return stateFormatRecommendationId !== projectCurrentFormatRecommendationId;
}

export function isContentBuildStale(stateSnapshotAt: string, liveSnapshotAt: string): boolean {
  return stateSnapshotAt !== liveSnapshotAt;
}

// FK-equality on the embedded cover generation — §7.2's "cover_generation_id... vs.
// live current cover state."
export function isCoverStale(stateCoverGenerationId: string | null, liveCurrentCoverGenerationId: string | null): boolean {
  return stateCoverGenerationId !== liveCurrentCoverGenerationId;
}

export type DocumentStalenessReason = 'title_changed' | 'format_changed' | 'content_build_changed' | 'cover_changed' | null;

/**
 * §7.2's precedence, checked per (project, output_format) independently — a build-time
 * completion (each export_format_states row tracks its own staleness, not one
 * document-level flag per project) required once decision 6 confirmed multiple formats
 * can coexist per project.
 */
export function detectDocumentStalenessReason(
  state: { titleCandidateId: string; formatRecommendationId: string; contentBuildConfirmedAt: string; coverGenerationId: string | null },
  current: {
    selectedCandidateId: string | null;
    currentFormatRecommendationId: string | null;
    contentBuildSnapshotAt: string | null;
    currentCoverGenerationId: string | null;
  },
): DocumentStalenessReason {
  if (isTitleStale(state.titleCandidateId, current.selectedCandidateId)) return 'title_changed';
  if (isFormatStale(state.formatRecommendationId, current.currentFormatRecommendationId)) return 'format_changed';
  if (current.contentBuildSnapshotAt !== null && isContentBuildStale(state.contentBuildConfirmedAt, current.contentBuildSnapshotAt)) {
    return 'content_build_changed';
  }
  if (isCoverStale(state.coverGenerationId, current.currentCoverGenerationId)) return 'cover_changed';
  return null;
}

/**
 * §5 rule 4: a coarse sanity band, explicitly not an exact formula — catches a
 * catastrophic rendering bug (e.g. 30,000 words collapsing onto 3 pages) without
 * claiming to validate layout quality (§5 rule 9 is honest that quality isn't
 * checkable at all). Bounds are a deliberately generous starting heuristic: as few as
 * ~50 words/page (a sparse tracker page) up to ~600 words/page (a dense chapter),
 * plus a small buffer for cover/title pages.
 */
export function isPageCountWithinSanityBand(wordCount: number, pageCount: number): boolean {
  if (wordCount === 0) return pageCount >= 1;
  const minExpectedPages = Math.max(1, Math.floor(wordCount / 600));
  const maxExpectedPages = Math.ceil(wordCount / 50) + 2;
  return pageCount >= minExpectedPages && pageCount <= maxExpectedPages;
}

/**
 * §5 rule 5: a mechanical per-page content-presence check, operating on already-
 * extracted per-page text (the rendering layer's job to supply, not this function's).
 */
export function findBlankPageIndices(pageTexts: string[]): number[] {
  return pageTexts.reduce<number[]>((indices, text, i) => {
    if (text.trim().length === 0) indices.push(i);
    return indices;
  }, []);
}
