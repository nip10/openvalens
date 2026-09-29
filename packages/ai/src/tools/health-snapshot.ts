import { tool } from "ai";
import { z } from "zod";

/**
 * `healthSnapshot` demo tool (Issue #13).
 *
 * TODO(#13c): replace the hardcoded payload with real org-scoped queries
 * (labs, body composition, supplements, medications, goals). This issue ships
 * the tool-calling shape only — no domain reads.
 */

export const healthSnapshotOutput = z.object({
  status: z.literal("placeholder"),
  summary: z.string(),
  counts: z.object({
    outOfRangeMarkers: z.number(),
    activeSupplements: z.number(),
    activeGoals: z.number(),
  }),
  generatedAt: z.string(),
});

export type HealthSnapshotOutput = z.infer<typeof healthSnapshotOutput>;

/** Deterministic placeholder payload. No PHI, no DB reads. */
export function buildHealthSnapshot(now: Date = new Date()): HealthSnapshotOutput {
  return {
    status: "placeholder",
    summary: "Health snapshot placeholder — domain queries land in #13c.",
    counts: {
      outOfRangeMarkers: 0,
      activeSupplements: 0,
      activeGoals: 0,
    },
    generatedAt: now.toISOString(),
  };
}

export const healthSnapshotTool = tool({
  description:
    "Get a read-only health snapshot across labs, body composition, supplements and goals. Placeholder payload in Issue #13.",
  inputSchema: z.object({}),
  execute: async () => buildHealthSnapshot(),
});
