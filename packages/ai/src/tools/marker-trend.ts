import { tool } from "ai";
import { z } from "zod";

/**
 * `markerTrend` demo tool (Issue #13).
 *
 * TODO(#13c): query the real marker series (anchovy `getMarkerTrend`) and
 * compute a genuine direction. This issue returns a placeholder trend.
 */

export const markerTrendInput = z.object({
  markerKey: z.string().min(1).max(64),
});

export const markerTrendOutput = z.object({
  markerKey: z.string(),
  trend: z.enum(["up", "down", "flat"]),
});

export type MarkerTrendInput = z.infer<typeof markerTrendInput>;
export type MarkerTrendOutput = z.infer<typeof markerTrendOutput>;

/** Deterministic placeholder. No PHI, no DB reads. */
export function buildMarkerTrend(input: MarkerTrendInput): MarkerTrendOutput {
  return {
    markerKey: input.markerKey,
    trend: "flat",
  };
}

export const markerTrendTool = tool({
  description:
    "Get the direction of a marker's trend over time. Placeholder result in Issue #13; real series land in #13c.",
  inputSchema: markerTrendInput,
  execute: async (input) => buildMarkerTrend(input),
});
