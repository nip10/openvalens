import { painRegionName } from "@openvalens/pain/model";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { daysBefore, unavailableReason } from "./format";
import type { AiPainRow } from "./sources";

/**
 * `pain` tool (Issue #442).
 *
 * The member's own pain log: what they rated (0 to 10) per body region, with
 * the optional type and the time. Only when the pain log is on, its own
 * "Coach and connected AI apps can read my pain log" switch is on (off by
 * default), and the chat runs in the member's own session (never an
 * impersonated one).
 *
 * Redaction: notes are never read. Another member's pain log is never
 * included. The output is the record only, with no score or interpretation.
 */

export const PAIN_DEFAULT_DAYS = 30;
/** Cap on entries returned. */
export const PAIN_MAX_ITEMS = 200;

export const painInput = z.strictObject({
  days: z.number().int().min(1).max(90).default(PAIN_DEFAULT_DAYS),
});

const entryRow = z.object({
  region: z.string(),
  rating: z.number(),
  outOf: z.literal(10),
  type: z.string().nullable(),
  loggedAt: z.string(),
  date: z.string(),
});

export const painOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    windowDays: z.number(),
    from: z.string(),
    to: z.string(),
    note: z.string(),
    entries: z.array(entryRow),
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

export type PainInput = z.input<typeof painInput>;
export type PainOutput = z.infer<typeof painOutput>;

const RECORD_NOTE =
  "Ratings the user recorded about themselves. Report them as recorded; do not diagnose, name causes, link them to other records or give advice that changes with the rating.";

/** Pure projection of the port's rows. */
export function buildPainSummary(
  rows: readonly AiPainRow[],
  window: { days: number; from: string; to: string },
  now: Date,
): PainOutput {
  const generatedAt = now.toISOString();
  if (rows.length === 0) {
    return {
      status: "no_data",
      windowDays: window.days,
      summary: "No pain ratings are shared with the Coach in this window.",
      generatedAt,
    };
  }
  return {
    status: "ok",
    windowDays: window.days,
    from: window.from,
    to: window.to,
    note: RECORD_NOTE,
    entries: rows.slice(0, PAIN_MAX_ITEMS).map((row) => ({
      region: painRegionName(row.region),
      rating: row.rating,
      outOf: 10,
      type: row.type,
      loggedAt: row.loggedAt,
      date: row.localDate,
    })),
    generatedAt,
  };
}

export async function executePain(
  context: AiHealthToolContext,
  input: PainInput,
): Promise<PainOutput> {
  const access = await resolveToolAccess(context, "pain");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }
  // Only the member's own, non-impersonated session (#442).
  if (context.trustedSelf !== true) {
    logToolExecuted(context, access.logger, "pain", "unavailable");
    return {
      status: "unavailable",
      reason: "permission_denied",
      generatedAt: access.now.toISOString(),
    };
  }
  const days = input.days ?? PAIN_DEFAULT_DAYS;
  // One extra day on each side so any member time zone is covered.
  const window = {
    days,
    from: daysBefore(access.now, days),
    to: daysBefore(access.now, -1),
  };
  const rows = await access.sources.listAiPain(
    { organizationId: context.organizationId, userId: context.userId },
    { from: window.from, to: window.to, limit: PAIN_MAX_ITEMS },
  );
  const result = buildPainSummary(rows, window, access.now);
  logToolExecuted(context, access.logger, "pain", result.status, {
    windowDays: days,
    ...(result.status === "ok" ? { entryCount: result.entries.length } : {}),
  });
  return result;
}

export function createPainTool(context: AiHealthToolContext) {
  return tool({
    description:
      "List the user's own pain log over the last N days (default 30, max 90): each rating " +
      "they recorded from 0 to 10 for a body region, with the optional type (ache, sharp, " +
      "burning, throbbing, stiffness, tingling) and the time. Available only when the user " +
      "turned on the pain log and let the Coach read it. These are self-recorded ratings, not " +
      "a diagnosis: report them as recorded, never suggest causes, conditions or patterns, and " +
      "never give advice that changes with the rating. Notes are not included.",
    inputSchema: painInput,
    execute: async (input) => executePain(context, input),
  });
}
