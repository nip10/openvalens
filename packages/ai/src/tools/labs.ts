import type { BloodPanel, BloodPanelWithContext } from "@openvalens/clinical";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import {
  BLOOD_PANEL_LOOKUP_LIMIT,
  compareLabMarkerRows,
  findPanelByDate,
  labMarkerRow,
  matchesCategory,
  panelDates,
  projectLabMarker,
} from "./blood-panels";
import { datePart, isoDateInput, shortText, unavailableReason } from "./format";

/**
 * `labs` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Returns the markers of one recorded blood panel — the newest one, or the one
 * recorded on a requested date — optionally narrowed to a category. Values,
 * units and reference ranges are what the lab report recorded; the tool adds
 * no interpretation. Unknown dates return `not_found` with the org's own panel
 * dates; an org with no panels returns `no_data`.
 */

/** Cap on markers returned for one panel, to keep the prompt small. */
export const LABS_MAX_MARKERS = 80;
const MAX_CATEGORIES = 30;

export const labsInput = z.strictObject({
  date: isoDateInput.optional(),
  category: z.string().trim().min(1).max(64).optional(),
});

export const labsOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    panelDate: z.string(),
    panelCount: z.number(),
    availablePanelDates: z.array(z.string()),
    availableCategories: z.array(z.string()),
    category: z.string().nullable(),
    markerCount: z.number(),
    returnedMarkerCount: z.number(),
    markers: z.array(labMarkerRow),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("not_found"),
    requestedDate: z.string().nullable(),
    availablePanelDates: z.array(z.string()),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type LabsInput = z.infer<typeof labsInput>;
export type LabsOutput = z.infer<typeof labsOutput>;

const NO_PANELS = "No blood panels are recorded yet.";

/** Picks the panel to show: the requested date, else the newest panel. */
export function selectLabPanel(panels: readonly BloodPanel[], input: LabsInput): BloodPanel | null {
  if (input.date !== undefined) return findPanelByDate(panels, input.date);
  return panels[0] ?? null;
}

/** Pure projection of one loaded panel into the redacted `labs` result. */
export function buildLabsResult(
  panels: readonly BloodPanel[],
  detail: BloodPanelWithContext | null,
  input: LabsInput,
  now: Date = new Date(),
): LabsOutput {
  const generatedAt = now.toISOString();
  if (panels.length === 0) return { status: "no_data", summary: NO_PANELS, generatedAt };
  if (!detail) {
    return {
      status: "not_found",
      requestedDate: input.date ?? null,
      availablePanelDates: panelDates(panels),
      generatedAt,
    };
  }

  const categories = [
    ...new Set(
      detail.markers.map((marker) => shortText(marker.category, 80)).filter((c) => c !== null),
    ),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_CATEGORIES);
  const markers = detail.markers
    .filter((marker) => matchesCategory(marker, input.category))
    .map(projectLabMarker)
    .sort(compareLabMarkerRows);

  return {
    status: "ok",
    panelDate: datePart(detail.panel.date),
    panelCount: panels.length,
    availablePanelDates: panelDates(panels),
    availableCategories: categories,
    category: input.category ?? null,
    markerCount: markers.length,
    returnedMarkerCount: Math.min(markers.length, LABS_MAX_MARKERS),
    markers: markers.slice(0, LABS_MAX_MARKERS),
    generatedAt,
  };
}

/** Freshly reads the bound organization's panels and builds the result. */
export async function executeLabs(
  context: AiHealthToolContext,
  input: LabsInput,
): Promise<LabsOutput> {
  const access = await resolveToolAccess(context, "labs");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const panels = await access.sources.listBloodPanels(organizationId, BLOOD_PANEL_LOOKUP_LIMIT);
  const selected = selectLabPanel(panels, input);
  const detail = selected ? await access.sources.getBloodPanel(organizationId, selected.id) : null;
  const result = buildLabsResult(panels, detail, input, access.now);

  // No date, category or values — only counts.
  logToolExecuted(context, access.logger, "labs", result.status, {
    panelCount: panels.length,
    ...(result.status === "ok" ? { markerCount: result.markerCount } : {}),
  });
  return result;
}

export function createLabsTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Get the markers recorded in one blood panel (lab report): value, unit, the lab's " +
      "reference range and flag, and whether the value sits outside a stored optimal range. " +
      "Defaults to the newest panel; pass date (YYYY-MM-DD) for another panel and category " +
      "(for example 'Hematology') to narrow it. An unknown date returns the recorded panel dates.",
    inputSchema: labsInput,
    execute: async (input) => executeLabs(context, input),
  });
}
