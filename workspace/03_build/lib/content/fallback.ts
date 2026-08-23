/**
 * Decision 10 continuation (Step 7's honest-empty precedent, applied per-subtopic
 * here): on total writer-pass failure (retry-once exhausted), persist an honest empty
 * body rather than fabricating placeholder prose with no basis. The caller sets
 * `content_status='failed_empty'` and keeps `target_word_min/max` populated so the UI
 * can show "aim for roughly N-M words, add manually."
 *
 * Review-pass-only failure has no equivalent fallback function — there is nothing to
 * synthesize, the draft content is simply kept as-is with a `review_pass_failed` flag.
 * That's an orchestration decision (runContentGeneration.ts, increment 4), not a
 * fallback-content concept, so it doesn't live here.
 */
export function writerFailureFallback(): string {
  return '';
}
