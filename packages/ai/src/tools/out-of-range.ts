import type { BloodPanelWithContext } from "@openvalens/clinical";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import {
  compareLabMarkerRows,
  isFlagged,
  labMarkerRow,
  matchesCategory,
  projectLabMarker,
} from "./blood-panels";
import { datePart, unavailableReason } from "./format";

/**
 * `outOfRange` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Looks at the most recent reading of every marker across the newest recorded
 * blood panels and lists the ones that carry a flag: either the flag printed
 * on the lab report (`HIGH` / `LOW` / `CRITICAL`) or a value outside the
 * stored optimal range. Older readings of a marker are ignored once a newer
 * one exists, so a marker that has since come back inside its range is not
 * reported. The flags describe recorded values; they are not a diagnosis.
 */

/** Newest panels scanned for each marker's latest reading. */
export const OUT_OF_RANGE_MAX_PANELS = 6;
/** Cap on flagged markers returned. */
export const OUT_OF_RANGE_MAX_MARKERS = 60;

export const OUT_OF_RANGE_BASIS =
  "Flags come from the lab report or compare the recorded value with a stored optimal range. " +
  "They describe the records only and are not a diagnosis.";

export const outOfRangeInput = z.strictObject({
  category: z.string().trim().min(1).max(64).optional(),
});

const flaggedMarker = labMarkerRow.extend({ panelDate: z.string() });

export const outOfRangeOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    basis: z.string(),
    category: z.string().nullable(),
    panelsChecked: z.number(),
    newestPanelDate: z.string(),
    oldestPanelDate: z.string(),
    markersChecked: z.number(),
    flaggedCount: z.number(),
    markers: z.array(flaggedMarker),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    summary: z.string(),
    panelsChecked: z.number(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type OutOfRangeInput = z.infer<typeof outOfRangeInput>;
export type OutOfRangeOutput = z.infer<typeof outOfRangeOutput>;

/**
 * Pure projection. `panels` must be newest first; the first reading of a
 * test key wins.
 */
export function buildOutOfRange(
  panels: readonly BloodPanelWithContext[],
  input: OutOfRangeInput,
  now: Date = new Date(),
): OutOfRangeOutput {
  const generatedAt = now.toISOString();
  const latestByKey = new Map<string, z.infer<typeof flaggedMarker>>();
  for (const { panel, markers } of panels) {
    for (const marker of markers) {
      if (latestByKey.has(marker.testKey) || !matchesCategory(marker, input.category)) continue;
      latestByKey.set(marker.testKey, {
        ...projectLabMarker(marker),
        panelDate: datePart(panel.date),
      });
    }
  }

  const newest = panels[0];
  const oldest = panels.at(-1);
  if (!newest || !oldest || latestByKey.size === 0) {
    return {
      status: "no_data",
      summary:
        panels.length === 0
          ? "No blood panels are recorded yet."
          : "No markers are recorded in the newest blood panels for this request.",
      panelsChecked: panels.length,
      generatedAt,
    };
  }

  const flagged = [...latestByKey.values()].filter(isFlagged).sort(compareLabMarkerRows);
  return {
    status: "ok",
    basis: OUT_OF_RANGE_BASIS,
    category: input.category ?? null,
    panelsChecked: panels.length,
    newestPanelDate: datePart(newest.panel.date),
    oldestPanelDate: datePart(oldest.panel.date),
    markersChecked: latestByKey.size,
    flaggedCount: flagged.length,
    markers: flagged.slice(0, OUT_OF_RANGE_MAX_MARKERS),
    generatedAt,
  };
}

/** Freshly reads the bound organization's newest panels and lists flags. */
export async function executeOutOfRange(
  context: AiHealthToolContext,
  input: OutOfRangeInput,
): Promise<OutOfRangeOutput> {
  const access = await resolveToolAccess(context, "outOfRange");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const panels = await access.sources.listBloodPanels(organizationId, OUT_OF_RANGE_MAX_PANELS);
  const details = await Promise.all(
    panels.map((panel) => access.sources.getBloodPanel(organizationId, panel.id)),
  );
  const loaded = details.filter((detail): detail is BloodPanelWithContext => detail !== null);
  const result = buildOutOfRange(loaded, input, access.now);

  logToolExecuted(context, access.logger, "outOfRange", result.status, {
    panelsChecked: loaded.length,
    ...(result.status === "ok"
      ? { markersChecked: result.markersChecked, flaggedCount: result.flaggedCount }
      : {}),
  });
  return result;
}

export function createOutOfRangeTool(context: AiHealthToolContext) {
  return tool({
    description:
      "List lab markers whose most recent recorded reading carries a flag: the lab report's " +
      "own HIGH/LOW/CRITICAL flag, or a value outside a stored optimal range. Scans the newest " +
      "blood panels; pass category to narrow it. An empty list means no recorded reading is " +
      "flagged, not that anything was assessed clinically.",
    inputSchema: outOfRangeInput,
    execute: async (input) => executeOutOfRange(context, input),
  });
}
