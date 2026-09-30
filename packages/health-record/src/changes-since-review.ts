import type { TimelineEvent } from "./types";
export function buildTimelineChangeSummary(items: readonly TimelineEvent[]) {
  const byDomain: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let needsReview = 0;
  for (const item of items) {
    byDomain[item.domain] = (byDomain[item.domain] ?? 0) + 1;
    bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
    if (item.reviewState === "needs_review") needsReview++;
  }
  return { total: items.length, byDomain, bySeverity, needsReview };
}
