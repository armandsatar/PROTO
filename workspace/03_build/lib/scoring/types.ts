export type ScoreColor = 'green' | 'amber' | 'red';

export interface ScoreResult {
  /** 1-10, matches title_candidates.demand_score / competition_score (migration 0001) */
  score: number;
  color: ScoreColor;
  /** Raw/bucketed sub-scores that produced the number — persisted to *_signal_detail for auditability (§3.1) */
  detail: Record<string, unknown>;
}
