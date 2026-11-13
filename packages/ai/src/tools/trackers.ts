import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { daysBefore, round, shortText, unavailableReason } from "./format";
import type { AiTrackerWithDays } from "./sources";

/**
 * `trackers` tool (Issue #441).
 *
 * The member's own custom trackers (mood, sauna, dead hangs, …) that have
 * "Coach and connected AI apps can read this" on, with one value per day over
 * a recent window and the tracker's target. Mood, energy and stress are
 * self-ratings the member records (1 to 5): the tool reports them as such,
 * with no score and no interpretation.
 *
 * Redaction: entry notes are never read. Other members' trackers, shared or
 * not, are never included; a tracker with its AI switch off is invisible.
 * The tracker name is included (it names what is tracked), capped in length.
 */

export const TRACKERS_DEFAULT_DAYS = 30;
/** Cap on trackers returned. */
export const TRACKERS_MAX_ITEMS = 50;

export const trackersInput = z.strictObject({
  days: z.number().int().min(1).max(90).default(TRACKERS_DEFAULT_DAYS),
});

const KIND = {
  number: "number",
  scale: "self-rating from 1 (low) to 5 (high)",
  yes_no: "yes/no (1 = yes, 0 = no)",
  duration: "duration in minutes",
} as const;

const trackerRow = z.object({
  name: z.string(),
  kind: z.string(),
  unit: z.string().nullable(),
  howDaysCombine: z.string(),
  target: z.object({ value: z.number(), per: z.enum(["day", "week"]) }).nullable(),
  loggedDays: z.number(),
  average: z.number().nullable(),
  total: z.number().nullable(),
  days: z.array(z.object({ date: z.string(), value: z.number() })),
});

export const trackersOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    windowDays: z.number(),
    from: z.string(),
    to: z.string(),
    trackers: z.array(trackerRow),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    windowDays: z.number(),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type TrackersInput = z.input<typeof trackersInput>;
export type TrackersOutput = z.infer<typeof trackersOutput>;

const COMBINE = {
  sum: "a day's entries are added up",
  average: "a day's entries are averaged",
  last: "the day's last entry counts",
  any: "yes if any entry that day says yes",
} as const;

/** Durations are stored in seconds; the model reads minutes. */
function scaled(tracker: AiTrackerWithDays, value: number): number {
  return tracker.type === "duration" ? round(value / 60, 1) : round(value, 2);
}

/** Pure projection of the port's rows. */
export function buildTrackersSummary(
  trackers: readonly AiTrackerWithDays[],
  window: { days: number; from: string; to: string },
  now: Date,
): TrackersOutput {
  const generatedAt = now.toISOString();
  if (trackers.length === 0) {
    return {
      status: "no_data",
      windowDays: window.days,
      summary: "No custom trackers are shared with the Coach.",
      generatedAt,
    };
  }
  return {
    status: "ok",
    windowDays: window.days,
    from: window.from,
    to: window.to,
    trackers: trackers.slice(0, TRACKERS_MAX_ITEMS).map((tracker) => {
      const values = tracker.days.map((day) => day.value);
      const total = values.reduce((sum, value) => sum + value, 0);
      return {
        name: shortText(tracker.name, 40) ?? "Tracker",
        kind: KIND[tracker.type],
        unit: tracker.type === "number" ? shortText(tracker.unit, 12) : null,
        howDaysCombine: COMBINE[tracker.aggregation],
        target: tracker.target
          ? { value: scaled(tracker, tracker.target.value), per: tracker.target.period }
          : null,
        loggedDays: values.length,
        average: values.length ? scaled(tracker, total / values.length) : null,
        total:
          values.length && tracker.aggregation !== "average" && tracker.aggregation !== "last"
            ? scaled(tracker, total)
            : null,
        days: tracker.days.map((day) => ({ date: day.date, value: scaled(tracker, day.value) })),
      };
    }),
    generatedAt,
  };
}

export async function executeTrackers(
  context: AiHealthToolContext,
  input: TrackersInput,
): Promise<TrackersOutput> {
  const access = await resolveToolAccess(context, "trackers");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }
  const days = input.days ?? TRACKERS_DEFAULT_DAYS;
  const to = access.now.toISOString().slice(0, 10);
  const window = { days, from: daysBefore(access.now, days - 1), to };
  const trackers = await access.sources.listAiTrackers(
    { organizationId: context.organizationId, userId: context.userId },
    { from: window.from, to: window.to },
  );
  const result = buildTrackersSummary(trackers, window, access.now);
  logToolExecuted(context, access.logger, "trackers", result.status, {
    windowDays: days,
    ...(result.status === "ok" ? { trackerCount: result.trackers.length } : {}),
  });
  return result;
}

export function createTrackersTool(context: AiHealthToolContext) {
  return tool({
    description:
      "List the user's own custom trackers (for example mood, sauna minutes, dead hangs or " +
      "flossing) that they let the Coach read, with one value per day over the last N days " +
      "(default 30, max 90), how a day's entries combine, and any daily or weekly target. Mood, " +
      "energy and stress are the user's own 1-5 self-ratings: report them as recorded, not as " +
      "scores or screening results. Notes are not included.",
    inputSchema: trackersInput,
    execute: async (input) => executeTrackers(context, input),
  });
}
