import type { ScoreColor } from './types';

// Thresholds locked by decision 4 / §3.1: green >=7, amber 5-6, red <=4.
// Mirrored as a CHECK constraint on title_candidates in migration 0001 — keep in sync.
export function scoreToColor(score: number): ScoreColor {
  if (score >= 7) return 'green';
  if (score >= 5) return 'amber';
  return 'red';
}
