import { listLabMarkerHistory, listLabMarkerLatest } from "@openvalens/labs";
import { z } from "zod";

import { permissionedProcedure, validateInput } from "../index";

/**
 * Labs oRPC surface — `metric_sample` rows whose canonical code starts with
 * `blood_marker_` (e.g. `blood_marker_glucose`, `blood_marker_hba1c`).
 *
 * Two procedures:
 *
 * - `labs.latest` — read; `permissionedProcedure` on `records` with `read`
 *   action. Returns one entry per defined lab marker for the active org,
 *   each with the latest reading, the most recent samples (oldest-first for
 *   a sparkline) and the unit on file. `referenceRange` is the lab's own
 *   range stored with the latest reading (`null` when none was recorded);
 *   the app never supplies or looks up a range.
 *
 * - `labs.history` — read, same permission: every reading of one marker
 *   (up to 500, oldest first), each with the range the lab printed with it,
 *   for the marker's history view. `null` when the workspace has no such
 *   marker.
 *
 * Markers with no readings yet are included with `latestValue = null` so
 * the UI can show an empty state per marker. Org/user are taken
 * exclusively from authz — input is `strictObject` so any attempt to
 * override `organizationId` is rejected with `INVALID_INPUT` at the
 * boundary, before authz runs.
 */
const latestInput = z.strictObject({
  recentLimit: z.number().int().min(2).max(60).optional(),
});

const latestOutput = z.array(
  z.object({
    code: z.string(),
    displayName: z.string(),
    unit: z.string().nullable(),
    latestValue: z.number().nullable(),
    latestSampledAt: z.string().nullable(),
    sampleCount: z.number(),
    recentValues: z.array(
      z.object({
        sampledAt: z.string(),
        value: z.number(),
      }),
    ),
    referenceRange: z
      .object({
        low: z.number().nullable(),
        high: z.number().nullable(),
        text: z.string().nullable(),
        unit: z.string().nullable(),
      })
      .nullable(),
  }),
);

const historyInput = z.strictObject({
  code: z
    .string()
    .trim()
    .max(120)
    .regex(/^blood_marker_[a-z0-9_]+$/),
});

const historyOutput = z
  .object({
    code: z.string(),
    displayName: z.string(),
    unit: z.string().nullable(),
    readings: z.array(
      z.object({
        sampledAt: z.string(),
        value: z.number(),
        referenceRange: latestOutput.element.shape.referenceRange,
      }),
    ),
    truncated: z.boolean(),
  })
  .nullable();

export const labsRouter = {
  latest: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(latestInput))
    .input(latestInput)
    .output(latestOutput)
    .handler(async ({ input, context }) =>
      listLabMarkerLatest(context.db, context.authz.activeOrganizationId, input.recentLimit ?? 10),
    ),
  history: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(historyInput))
    .input(historyInput)
    .output(historyOutput)
    .handler(async ({ input, context }) =>
      listLabMarkerHistory(context.db, context.authz.activeOrganizationId, input.code),
    ),
};
