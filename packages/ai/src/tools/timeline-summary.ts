import type { TimelineEvent } from "@openvalens/health-record";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { daysBefore, shortText, unavailableReason } from "./format";

/**
 * `timelineSummary` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Summarises the bound organization's merged health-record timeline
 * (`@openvalens/health-record`) over a recent window: how many entries were
 * recorded per domain, kind and severity label, how many need review, and the
 * newest entries' dates and categories.
 *
 * Redaction: timeline titles and summaries can carry free text (event titles,
 * consultation diagnoses, facility and physician names, insight bodies), and
 * source references carry device / source names, so none of them are copied.
 * Each recent entry is reduced to its time, kind, domain, severity label,
 * review state and — for metrics — the metric code.
 */

export const TIMELINE_SUMMARY_DEFAULT_DAYS = 30;
/** Entries read from the timeline; more are reported as `truncated`. */
export const TIMELINE_SUMMARY_SCAN_LIMIT = 200;
/** Newest entries listed individually. */
export const TIMELINE_SUMMARY_RECENT_ITEMS = 20;

export const timelineSummaryInput = z.strictObject({
  days: z.number().int().min(1).max(90).default(TIMELINE_SUMMARY_DEFAULT_DAYS),
});

const recentEntry = z.object({
  at: z.string(),
  kind: z.enum(["event", "metric"]),
  domain: z.string(),
  severity: z.string(),
  reviewState: z.string(),
  metricCode: z.string().nullable(),
});

export const timelineSummaryOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    windowDays: z.number(),
    from: z.string(),
    to: z.string(),
    entryCount: z.number(),
    truncated: z.boolean(),
    byDomain: z.record(z.string(), z.number()),
    byKind: z.record(z.string(), z.number()),
    bySeverity: z.record(z.string(), z.number()),
    needsReviewCount: z.number(),
    newestAt: z.string(),
    oldestAt: z.string(),
    recent: z.array(recentEntry),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    windowDays: z.number(),
    from: z.string(),
    to: z.string(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type TimelineSummaryInput = z.input<typeof timelineSummaryInput>;
export type TimelineSummaryOutput = z.infer<typeof timelineSummaryOutput>;

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function metricCode(entry: TimelineEvent): string | null {
  if (entry.kind !== "metric") return null;
  const code = entry.canonical.metricCode;
  return typeof code === "string" ? shortText(code, 64) : null;
}

/** Pure projection; `items` is newest first, as the timeline returns it. */
export function buildTimelineSummary(
  items: readonly TimelineEvent[],
  truncated: boolean,
  window: { days: number; from: string; to: string },
  now: Date = new Date(),
): TimelineSummaryOutput {
  const generatedAt = now.toISOString();
  const newest = items[0];
  const oldest = items.at(-1);
  if (!newest || !oldest) {
    return {
      status: "no_data",
      windowDays: window.days,
      from: window.from,
      to: window.to,
      generatedAt,
    };
  }

  const byDomain: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let needsReviewCount = 0;
  for (const entry of items) {
    increment(byDomain, entry.domain);
    increment(byKind, entry.kind);
    increment(bySeverity, entry.severity);
    if (entry.reviewState === "needs_review") needsReviewCount += 1;
  }

  return {
    status: "ok",
    windowDays: window.days,
    from: window.from,
    to: window.to,
    entryCount: items.length,
    truncated,
    byDomain,
    byKind,
    bySeverity,
    needsReviewCount,
    newestAt: newest.at,
    oldestAt: oldest.at,
    recent: items.slice(0, TIMELINE_SUMMARY_RECENT_ITEMS).map((entry) => ({
      at: entry.at,
      kind: entry.kind,
      domain: entry.domain,
      severity: entry.severity,
      reviewState: entry.reviewState,
      metricCode: metricCode(entry),
    })),
    generatedAt,
  };
}

/** Freshly reads the bound organization's timeline window and summarises it. */
export async function executeTimelineSummary(
  context: AiHealthToolContext,
  input: TimelineSummaryInput,
): Promise<TimelineSummaryOutput> {
  const access = await resolveToolAccess(context, "timelineSummary");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const days = input.days ?? TIMELINE_SUMMARY_DEFAULT_DAYS;
  const window = { days, from: daysBefore(access.now, days), to: access.now.toISOString() };
  const page = await access.sources.listTimeline(context.organizationId, {
    from: window.from,
    to: window.to,
    limit: TIMELINE_SUMMARY_SCAN_LIMIT,
  });
  const result = buildTimelineSummary(page.items, page.nextCursor !== null, window, access.now);

  logToolExecuted(context, access.logger, "timelineSummary", result.status, {
    windowDays: days,
    ...(result.status === "ok"
      ? { entryCount: result.entryCount, truncated: result.truncated }
      : {}),
  });
  return result;
}

export function createTimelineSummaryTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Summarise what was recorded in the user's health timeline over the last N days " +
      "(default 30, max 90): entry counts per domain (sleep, labs, body, vitals, ...), per kind " +
      "and per recorded severity label, how many need review, and the newest entries' dates " +
      "and categories. Titles and free-text notes are not included.",
    inputSchema: timelineSummaryInput,
    execute: async (input) => executeTimelineSummary(context, input),
  });
}
