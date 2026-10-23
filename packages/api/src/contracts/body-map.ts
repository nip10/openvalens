import { z } from "zod";

/**
 * `bodyMap.*` wire contract (Issue #94). Shared by the server router,
 * `apps/web` and `apps/native`, so this file imports only `zod`. The colours
 * and region mapping live in `presenters/body-map.ts`.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const bodyMapCompositionInput = z.strictObject({
  scanId: z.number().int().positive(),
  /** An earlier scan of the same record, for compare mode. */
  compareScanId: z.number().int().positive().optional(),
});

const dexaValue = z.object({ region: z.string(), measurementType: z.string(), value: z.number() });
const scanSummary = z.object({ id: z.number(), date: z.string(), source: z.string() });

export const bodyMapCompositionOutput = z.object({
  scan: scanSummary,
  values: z.array(dexaValue),
  compare: z.object({ scan: scanSummary, values: z.array(dexaValue) }).nullable(),
});
export type BodyMapComposition = z.infer<typeof bodyMapCompositionOutput>;

export const bodyMapTrainingInput = z.strictObject({
  /** The member's local date; the window is this day and the 6 before it. */
  today: date,
});

export const bodyMapTrainingOutput = z.object({
  from: z.string(),
  to: z.string(),
  /** Catalog-linked exercises with their logged sets and catalog muscles. */
  exercises: z.array(
    z.object({
      exerciseId: z.number(),
      name: z.string(),
      sets: z.number(),
      muscles: z.array(z.object({ name: z.string(), role: z.enum(["primary", "secondary"]) })),
    }),
  ),
  /** Logged exercises with no catalog link or no muscle data: listed, not counted. */
  unmapped: z.array(z.object({ name: z.string(), sets: z.number() })),
});
export type BodyMapTraining = z.infer<typeof bodyMapTrainingOutput>;
