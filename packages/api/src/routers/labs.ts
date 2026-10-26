import { listLabMarkerLatest } from "@openvalens/labs";
import { z } from "zod";

import { permissionedProcedure, validateInput } from "../index";

/**
 * Labs oRPC surface — `metric_sample` rows whose canonical code starts with
 * `blood_marker_` (e.g. `blood_marker_glucose`, `blood_marker_hba1c`).
 *
 * One procedure today:
 *
 * - `labs.latest` — read; `permissionedProcedure` on `records` with `read`
 *   action. Returns one entry per defined lab marker for the active org,
 *   each with the latest reading, the most recent samples (oldest-first for
 *   a sparkline) and the unit on file. `referenceRange` is the lab's own
 *   range stored with the latest reading (`null` when none was recorded);
 *   the app never supplies or looks up a range.
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

export const labsRouter = {
  latest: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(latestInput))
    .input(latestInput)
    .output(latestOutput)
    .handler(async ({ input, context }) =>
      listLabMarkerLatest(context.db, context.authz.activeOrganizationId, input.recentLimit ?? 10),
    ),
};
