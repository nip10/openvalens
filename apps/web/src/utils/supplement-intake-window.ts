/**
 * Start of the dose-history window: local midnight seven days back. Rounding
 * to the day keeps the `supplementIntake.list` query key the same across
 * renders and remounts on one day, so the list settles instead of refetching.
 */
export function supplementIntakeWindowStart(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  return start.toISOString();
}
