import type { BloodMarker, BloodPanel } from "@openvalens/clinical";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { BLOOD_PANEL_LOOKUP_LIMIT, findPanelByDate, panelDates } from "./blood-panels";
import { datePart, isoDateInput, round, shortText, unavailableReason } from "./format";

/**
 * `panelCompare` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Compares the markers of two recorded blood panels: by default the two
 * newest, or the panels recorded on two requested dates. Each row is the
 * recorded difference between the older and the newer value; it says nothing
 * about whether a change is good, bad or clinically relevant. Markers present
 * on only one side, or recorded as text, are reported as such instead of being
 * given an invented change.
 */

/** Cap on comparison rows returned, to keep the prompt small. */
export const PANEL_COMPARE_MAX_ROWS = 100;

export const panelCompareInput = z
  .strictObject({
    fromDate: isoDateInput.optional(),
    toDate: isoDateInput.optional(),
  })
  .refine((input) => (input.fromDate === undefined) === (input.toDate === undefined), {
    message: "Pass both fromDate and toDate, or neither for the two newest panels.",
  })
  .refine((input) => input.fromDate === undefined || input.fromDate !== input.toDate, {
    message: "fromDate and toDate must differ.",
  });

const comparisonDirection = z.enum([
  "up",
  "down",
  "same",
  "only_in_from",
  "only_in_to",
  "not_numeric",
]);

const comparisonRow = z.object({
  testKey: z.string(),
  testName: z.string(),
  unit: z.string().nullable(),
  fromValue: z.number().nullable(),
  toValue: z.number().nullable(),
  change: z.number().nullable(),
  changePct: z.number().nullable(),
  direction: comparisonDirection,
});

export const panelCompareOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    fromDate: z.string(),
    toDate: z.string(),
    panelCount: z.number(),
    comparedCount: z.number(),
    changedCount: z.number(),
    onlyInFromCount: z.number(),
    onlyInToCount: z.number(),
    rows: z.array(comparisonRow),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("insufficient_data"),
    panelCount: z.number(),
    availablePanelDates: z.array(z.string()),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("not_found"),
    missingDates: z.array(z.string()),
    availablePanelDates: z.array(z.string()),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type PanelCompareInput = z.infer<typeof panelCompareInput>;
export type PanelCompareOutput = z.infer<typeof panelCompareOutput>;
export type PanelComparisonRow = z.infer<typeof comparisonRow>;

type ComparableMarker = Pick<BloodMarker, "testKey" | "testName" | "valueNumeric" | "unit">;

export type PanelSelection =
  | { kind: "pair"; from: BloodPanel; to: BloodPanel }
  | { kind: "insufficient" }
  | { kind: "missing"; dates: string[] };

/**
 * Resolves the two panels to compare. `panels` is newest first. The older
 * panel is always `from`, whatever order the dates were given in.
 */
export function selectPanelPair(
  panels: readonly BloodPanel[],
  input: PanelCompareInput,
): PanelSelection {
  if (input.fromDate === undefined || input.toDate === undefined) {
    const [newest, previous] = panels;
    if (!newest || !previous) return { kind: "insufficient" };
    return { kind: "pair", from: previous, to: newest };
  }

  const first = findPanelByDate(panels, input.fromDate);
  const second = findPanelByDate(panels, input.toDate);
  const missing = [...(first ? [] : [input.fromDate]), ...(second ? [] : [input.toDate])];
  if (!first || !second) return { kind: "missing", dates: missing };
  return datePart(first.date) <= datePart(second.date)
    ? { kind: "pair", from: first, to: second }
    : { kind: "pair", from: second, to: first };
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) ? value : null;
}

/** Pure, deterministic per-marker comparison (sorted by test key). */
export function compareBloodPanels(
  fromMarkers: readonly ComparableMarker[],
  toMarkers: readonly ComparableMarker[],
): PanelComparisonRow[] {
  const fromByKey = new Map(fromMarkers.map((marker) => [marker.testKey, marker]));
  const toByKey = new Map(toMarkers.map((marker) => [marker.testKey, marker]));
  const keys = [...new Set([...fromByKey.keys(), ...toByKey.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );

  return keys.map((testKey) => {
    const from = fromByKey.get(testKey);
    const to = toByKey.get(testKey);
    const fromValue = finiteOrNull(from?.valueNumeric);
    const toValue = finiteOrNull(to?.valueNumeric);
    const base = {
      testKey,
      testName: shortText(to?.testName ?? from?.testName, 80) ?? testKey,
      unit: shortText(to?.unit ?? from?.unit),
      fromValue,
      toValue,
    };

    if (!from || !to) {
      return {
        ...base,
        change: null,
        changePct: null,
        direction: from ? ("only_in_from" as const) : ("only_in_to" as const),
      };
    }
    if (fromValue === null || toValue === null) {
      return { ...base, change: null, changePct: null, direction: "not_numeric" as const };
    }
    const change = round(toValue - fromValue, 3);
    return {
      ...base,
      change,
      changePct: fromValue === 0 ? null : round(((toValue - fromValue) / fromValue) * 100, 1),
      direction:
        change === 0 ? ("same" as const) : change > 0 ? ("up" as const) : ("down" as const),
    };
  });
}

/** Pure projection of the selection and loaded markers into the result. */
export function buildPanelCompareResult(
  panels: readonly BloodPanel[],
  selection: PanelSelection,
  markers: { from: readonly ComparableMarker[]; to: readonly ComparableMarker[] } | null,
  now: Date = new Date(),
): PanelCompareOutput {
  const generatedAt = now.toISOString();
  if (selection.kind === "insufficient") {
    return {
      status: "insufficient_data",
      panelCount: panels.length,
      availablePanelDates: panelDates(panels),
      generatedAt,
    };
  }
  if (selection.kind === "missing" || !markers) {
    return {
      status: "not_found",
      missingDates: selection.kind === "missing" ? selection.dates : [],
      availablePanelDates: panelDates(panels),
      generatedAt,
    };
  }

  const rows = compareBloodPanels(markers.from, markers.to);
  const compared = rows.filter((row) => row.change !== null);
  return {
    status: "ok",
    fromDate: datePart(selection.from.date),
    toDate: datePart(selection.to.date),
    panelCount: panels.length,
    comparedCount: compared.length,
    changedCount: compared.filter((row) => row.direction !== "same").length,
    onlyInFromCount: rows.filter((row) => row.direction === "only_in_from").length,
    onlyInToCount: rows.filter((row) => row.direction === "only_in_to").length,
    rows: rows.slice(0, PANEL_COMPARE_MAX_ROWS),
    generatedAt,
  };
}

/** Freshly reads the bound organization's two panels and compares them. */
export async function executePanelCompare(
  context: AiHealthToolContext,
  input: PanelCompareInput,
): Promise<PanelCompareOutput> {
  const access = await resolveToolAccess(context, "panelCompare");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const panels = await access.sources.listBloodPanels(organizationId, BLOOD_PANEL_LOOKUP_LIMIT);
  const selection = selectPanelPair(panels, input);
  let markers: { from: ComparableMarker[]; to: ComparableMarker[] } | null = null;
  if (selection.kind === "pair") {
    const [from, to] = await Promise.all([
      access.sources.getBloodPanel(organizationId, selection.from.id),
      access.sources.getBloodPanel(organizationId, selection.to.id),
    ]);
    markers = from && to ? { from: from.markers, to: to.markers } : null;
  }
  const result = buildPanelCompareResult(panels, selection, markers, access.now);

  logToolExecuted(context, access.logger, "panelCompare", result.status, {
    panelCount: panels.length,
    ...(result.status === "ok"
      ? { comparedCount: result.comparedCount, changedCount: result.changedCount }
      : {}),
  });
  return result;
}

export function createPanelCompareTool(context: AiHealthToolContext) {
  return tool({
    description:
      "Compare the markers of two recorded blood panels: the recorded value in each, the " +
      "difference and percent difference. Defaults to the two newest panels; pass fromDate " +
      "and toDate (YYYY-MM-DD) for specific panels. Markers on only one panel or recorded as " +
      "text have no change. Fewer than two panels returns insufficient_data.",
    inputSchema: panelCompareInput,
    execute: async (input) => executePanelCompare(context, input),
  });
}
