// Decision 13: minimum content length per field — catches degenerate stub output
// ("Feels bad." -> "Feels good.") without judging tone or quality beyond length.
// Approved as a default, same "approve now, tune once real output is seen" treatment
// every prior phase's arbitrary thresholds got.
export const MIN_CONTENT_LENGTH = 30;

export function meetsMinLength(value: string): boolean {
  return value.length >= MIN_CONTENT_LENGTH;
}
