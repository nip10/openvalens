import { PAIN_LIMITS, PAIN_REGION_IDS, PAIN_TYPES } from "@openvalens/pain/model";
import { TRACKER_LIMITS } from "@openvalens/trackers/model";
import { z } from "zod";

import { ToolInputError } from "./format";
import type { WriteScope } from "./scopes";
import type { McpToolContext, McpToolDefinition } from "./tools";
import {
  BODY_ENTRY_KINDS,
  FOOD_ENTRY_MEALS,
  VITAL_ENTRY_KINDS,
  WORKOUT_ENTRY_INTENSITIES,
  WORKOUT_ENTRY_TYPES,
  type AiAppWrites,
  type AiWriteDomain,
} from "./writes";

/**
 * The write tools (Issue #439): the save-at-once domains. M2a: water, weight
 * and body composition, vitals, a supplement taken. M2b: workouts (catalog
 * exercises only), sleep, custom trackers and the pain log. Each domain has a
 * `log` tool that adds entries and a `delete` tool that deletes entries this
 * same grant wrote, each behind the domain's own write scope.
 *
 * Every call needs a `mutationId`: a retry with the same id and arguments
 * returns the first result and writes nothing again. Entries are the member's
 * own manual entries, labelled "via <app>"; they never change device data.
 * Larger imports go through the app's import screens.
 *
 * M2c: food (a meal draft) and labs (a lab result), and a workout with an
 * exercise that is not in the catalog, are drafts the member confirms in the
 * app. Their entries come back with status `pending_review`; nothing lands in
 * the member's records until the member confirms. The same receipts, tags,
 * ownership and limits apply.
 */

/** Hard cap of the input schema; the configured per-call limit is checked at run time. */
const MAX_ENTRIES_SCHEMA = 1_000;

const mutationId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use letters, digits and . _ : - only.")
  .describe(
    "A new id for this write, for example a UUID. Retrying with the same id and arguments returns the first result and writes nothing again; never reuse it for a different write.",
  );

const at = z.iso
  .datetime({ offset: true })
  .describe(
    "When it happened: ISO 8601 with a UTC offset or Z, for example 2026-11-14T08:30:00+00:00. Not in the future.",
  );

function entriesOf<T extends z.ZodType>(entry: T) {
  return z.array(entry).min(1).max(MAX_ENTRIES_SCHEMA);
}

const entryIds = z
  .array(z.uuid())
  .min(1)
  .max(MAX_ENTRIES_SCHEMA)
  .describe("`entryId`s returned by this app's own log calls.");

const SAVED_NOTE =
  "Saved as the member's own manual entries, labelled with this app's name; device data is never changed or merged.";
const READING_OVERLAP_NOTE =
  "An entry within ten minutes of a device reading of the same kind is marked possibleDuplicate (the device reading counts in daily totals).";
const RETURNS_NOTE =
  "Returns an entryId per entry. Needs a mutationId; at most 100 entries per call by default.";
const DRAFT_NOTE =
  "Each entry is a draft labelled with this app's name (status pending_review) that the member confirms or discards in the app; nothing is saved to their records before that. Tell the member it is waiting for their review.";

const DELETE_NOTE =
  "Deletes only entries this same app wrote, by the entryIds its log calls returned. Any other id (the member's own entries, another app's, unknown) is answered not_found and left alone. Needs a mutationId.";

function requireWrites(context: McpToolContext): AiAppWrites {
  if (!context.writes) throw new ToolInputError("Writing is not available on this server.");
  return context.writes;
}

function logTool(input: {
  domain: AiWriteDomain;
  name: string;
  title: string;
  scope: WriteScope;
  description: string;
  entry: z.ZodType;
  /** How an overlap with device data is reported; empty for domains with no device data. */
  overlapNote?: string;
  /** What happens to the entries; drafts (M2c) say so instead of "saved". */
  savedNote?: string;
}): McpToolDefinition {
  const overlap = input.overlapNote ?? READING_OVERLAP_NOTE;
  return {
    name: input.name,
    title: input.title,
    description: [input.description, input.savedNote ?? SAVED_NOTE, overlap, RETURNS_NOTE]
      .filter(Boolean)
      .join(" "),
    scope: input.scope,
    write: "add",
    input: z.strictObject({ mutationId, entries: entriesOf(input.entry) }) as z.ZodType<
      Record<string, unknown>
    >,
    run: async (context, parsed) => {
      const result = await requireWrites(context).log({
        principal: context.principal,
        domain: input.domain,
        tool: input.name,
        mutationId: parsed.mutationId as string,
        entries: parsed.entries as unknown[],
        timeZone: context.timeZone,
        correlationId: context.correlationId,
      });
      return { result, rowCount: result.entries.length };
    },
  };
}

function deleteTool(input: {
  domain: AiWriteDomain;
  name: string;
  title: string;
  scope: WriteScope;
  what: string;
}): McpToolDefinition {
  return {
    name: input.name,
    title: input.title,
    description: `Deletes ${input.what} this app logged. ${DELETE_NOTE}`,
    scope: input.scope,
    write: "delete",
    input: z.strictObject({ mutationId, entryIds }) as z.ZodType<Record<string, unknown>>,
    run: async (context, parsed) => {
      const result = await requireWrites(context).remove({
        principal: context.principal,
        domain: input.domain,
        tool: input.name,
        mutationId: parsed.mutationId as string,
        entryIds: parsed.entryIds as string[],
        correlationId: context.correlationId,
      });
      return {
        result,
        rowCount: result.entries.filter((entry) => entry.status === "deleted").length,
      };
    },
  };
}

const positive = z.number().finite().positive();

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .describe("The session's day in the member's time zone, YYYY-MM-DD. Not in the future.");

const workoutSet = z.strictObject({
  reps: z.number().int().positive().max(1000),
  weight: z.number().finite().min(0).optional().describe("Load per rep; omit for bodyweight."),
  unit: z.enum(["kg", "lb"]).optional().describe("Unit of `weight` (default kg)."),
  rpe: z.number().finite().min(0).max(10).optional().describe("Effort of the set (RPE), 0-10."),
});

const workoutExercise = z.strictObject({
  exerciseId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The exercise's id from `exercises.search`. Search there first: a workout whose exercises all have an id is saved at once.",
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Only for an exercise `exercises.search` does not find: its name, without an exerciseId. The workout then becomes a draft the member reviews in the app, where they map the exercise to a catalog one or add it as their own.",
    ),
  sets: z.array(workoutSet).max(20).optional(),
});

const trackerNote = z.string().trim().min(1).max(TRACKER_LIMITS.noteLength).optional();

export const WRITE_TOOLS: readonly McpToolDefinition[] = Object.freeze([
  logTool({
    domain: "water",
    name: "water.log",
    title: "Log water",
    scope: "water:write",
    description:
      "Adds plain water the member drank. Only works when the member has plain-water logging on in the app.",
    entry: z.strictObject({
      at,
      amount: positive.describe("How much water."),
      unit: z.enum(["ml", "l", "fl_oz"]).describe("Unit of `amount`."),
    }),
  }),
  deleteTool({
    domain: "water",
    name: "water.delete",
    title: "Delete logged water",
    scope: "water:write",
    what: "water entries",
  }),
  logTool({
    domain: "body",
    name: "body.log",
    title: "Log weight and body composition",
    scope: "body:write",
    description:
      "Adds weight and body composition readings the member gives: weight, body fat (%), muscle mass, bone mass or body water (%). Masses in kg (default) or lb.",
    entry: z.strictObject({
      at,
      kind: z.enum(BODY_ENTRY_KINDS),
      value: positive,
      unit: z
        .enum(["kg", "lb", "%"])
        .optional()
        .describe(
          "kg or lb for weight, muscle and bone mass (default kg); % for body fat and body water.",
        ),
    }),
  }),
  deleteTool({
    domain: "body",
    name: "body.delete",
    title: "Delete logged body readings",
    scope: "body:write",
    what: "weight and body composition readings",
  }),
  logTool({
    domain: "vitals",
    name: "vitals.log",
    title: "Log vitals",
    scope: "vitals:write",
    description:
      "Adds vitals readings the member gives: blood pressure (systolic and diastolic in mmHg, optional pulse in bpm), heart rate or resting heart rate (bpm), blood oxygen (SpO₂, %) or respiratory rate (breaths/min).",
    entry: z.strictObject({
      at,
      kind: z.enum(VITAL_ENTRY_KINDS),
      value: positive.optional().describe("The reading; for every kind except blood_pressure."),
      systolic: positive.optional().describe("blood_pressure only, mmHg."),
      diastolic: positive.optional().describe("blood_pressure only, mmHg."),
      pulse: positive.optional().describe("blood_pressure only, optional, bpm."),
    }),
  }),
  deleteTool({
    domain: "vitals",
    name: "vitals.delete",
    title: "Delete logged vitals",
    scope: "vitals:write",
    what: "vitals readings",
  }),
  logTool({
    domain: "supplements",
    name: "supplements.logTaken",
    title: "Log a supplement taken",
    scope: "supplements:write",
    description:
      "Records that the member took one of their own supplements (as listed by the supplements tool), by its name. The dose defaults to the supplement's own dose.",
    entry: z.strictObject({
      at,
      supplement: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .describe("The supplement's name, as the supplements tool lists it."),
      dose: z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe('Dose taken, for example "1 capsule" or "4000 IU".'),
    }),
  }),
  deleteTool({
    domain: "supplements",
    name: "supplements.deleteTaken",
    title: "Delete a logged supplement intake",
    scope: "supplements:write",
    what: "supplement intakes",
  }),
  // ─── M2b ────────────────────────────────────────────────────
  logTool({
    domain: "workouts",
    name: "workouts.log",
    title: "Log a workout",
    scope: "workouts:write",
    description:
      "Adds workout sessions the member did, one entry per session. A session with only a type, a duration and an effort rating is fine. Give each exercise's exerciseId from `exercises.search` (the member's own custom exercises are there too) and optional sets (reps, weight in kg or lb, RPE). A session with an exercise `exercises.search` does not find, given by name only, is not saved at once: it becomes a draft (status pending_review) the member reviews in the app, mapping that exercise to a catalog one or adding it as their own. An exerciseId the catalog does not have is refused.",
    overlapNote: "",
    entry: z.strictObject({
      date: isoDay,
      type: z.enum(WORKOUT_ENTRY_TYPES).describe('Use "other" when none fits.'),
      durationMinutes: z.number().int().positive().max(1440).optional(),
      intensity: z
        .enum(WORKOUT_ENTRY_INTENSITIES)
        .optional()
        .describe("Talk test: light, moderate or vigorous."),
      effort: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("Session effort the member gave, 0 (rest) to 10 (maximal)."),
      notes: z.string().trim().min(1).max(2000).optional(),
      exercises: z.array(workoutExercise).max(24).optional(),
    }),
  }),
  deleteTool({
    domain: "workouts",
    name: "workouts.delete",
    title: "Delete a logged workout",
    scope: "workouts:write",
    what: "workouts",
  }),
  logTool({
    domain: "sleep",
    name: "sleep.log",
    title: "Log sleep",
    scope: "sleep:write",
    description:
      "Adds nights of sleep the member gives: bedtime and wake time, and an optional quality from 1 (rough) to 5 (great). Saved as manual nights, like the app's own sleep form; a night lasts 10 minutes to 24 hours and ends no later than now.",
    overlapNote:
      "A night that overlaps a device night is marked possibleDuplicate; the device night counts in the totals.",
    entry: z.strictObject({
      startAt: z.iso.datetime({ offset: true }).describe("Bedtime, ISO 8601 with a UTC offset."),
      endAt: z.iso.datetime({ offset: true }).describe("Wake time, ISO 8601 with a UTC offset."),
      quality: z.number().int().min(1).max(5).optional(),
    }),
  }),
  deleteTool({
    domain: "sleep",
    name: "sleep.delete",
    title: "Delete a logged night of sleep",
    scope: "sleep:write",
    what: "nights of sleep",
  }),
  logTool({
    domain: "trackers",
    name: "trackers.log",
    title: "Log a custom tracker",
    scope: "trackers:write",
    description:
      "Adds entries to the member's own custom trackers, by the trackerId `trackers.list` returns. Only trackers the member lets AI apps read; a shared tracker someone else owns is refused. The value follows the tracker's kind: a number for number trackers, 1-5 for ratings, true or false for yes/no trackers, minutes for durations.",
    overlapNote:
      "An entry within ten minutes of one imported from Apple Health or Health Connect in the same tracker is marked possibleDuplicate.",
    entry: z.strictObject({
      at,
      trackerId: z.uuid().describe("A `trackerId` from `trackers.list`."),
      value: z.union([z.number().finite(), z.boolean()]),
      note: trackerNote,
    }),
  }),
  deleteTool({
    domain: "trackers",
    name: "trackers.delete",
    title: "Delete logged tracker entries",
    scope: "trackers:write",
    what: "custom tracker entries",
  }),
  logTool({
    domain: "pain",
    name: "pain.log",
    title: "Log pain",
    scope: "pain:write",
    description:
      "Adds pain ratings the member gives, one entry per body region: the region id, the rating from 0 to 10 and an optional type. Record only what the member said, as they said it; this is a self-recorded log, not a diagnosis. Refused unless the member turned on the pain log and let AI apps read it.",
    overlapNote: "",
    entry: z.strictObject({
      at,
      region: z
        .enum(PAIN_REGION_IDS as [string, ...string[]])
        .describe("A body-map region or joint, for example front.thigh_left or joint.knee_right."),
      rating: z.number().int().min(0).max(10),
      type: z.enum(PAIN_TYPES).optional(),
      note: z.string().trim().min(1).max(PAIN_LIMITS.noteLength).optional(),
    }),
  }),
  deleteTool({
    domain: "pain",
    name: "pain.delete",
    title: "Delete logged pain entries",
    scope: "pain:write",
    what: "pain entries",
  }),
  // ─── M2c: drafts the member confirms ────────────────────────
  logTool({
    domain: "food",
    name: "food.log",
    title: "Suggest a meal",
    scope: "food:write",
    description:
      "Makes a meal draft from what the member said they ate, one entry per meal: either `description`, the meal in the member's words (split into items the same way as the app's \"Describe a meal\"), or `items` already split (the food, the quantity as stated, the unit). The member reviews it in the app, matches each item to a food and logs it in the meal diary; nothing is added to the food diary until they do. Send only what the member said: never nutrient values, and never a weight, volume or portion they did not state.",
    savedNote: DRAFT_NOTE,
    overlapNote: "",
    entry: z
      .strictObject({
        at: at.describe("When the meal was eaten, ISO 8601 with a UTC offset. Not in the future."),
        meal: z.enum(FOOD_ENTRY_MEALS).optional(),
        description: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .optional()
          .describe('The meal as the member described it, e.g. "two eggs, a slice of toast".'),
        items: z
          .array(
            z.strictObject({
              food: z.string().trim().min(1).max(200),
              quantity: z
                .union([z.number().finite().positive(), z.string().trim().min(1).max(40)])
                .optional()
                .describe('As stated: a number, or words such as "half" or "a couple".'),
              unit: z
                .string()
                .trim()
                .min(1)
                .max(20)
                .optional()
                .describe('"slice", "g", "cup"…; omit when none was stated.'),
            }),
          )
          .min(1)
          .max(20)
          .optional(),
      })
      .refine((entry) => (entry.description === undefined) !== (entry.items === undefined), {
        message: "Give either description or items.",
      }),
  }),
  deleteTool({
    domain: "food",
    name: "food.delete",
    title: "Delete a meal draft",
    scope: "food:write",
    what: "meal drafts that are still waiting for the member's review",
  }),
  logTool({
    domain: "labs",
    name: "labs.log",
    title: "Suggest lab results",
    scope: "labs:write",
    description:
      "Adds lab results the member gives, one entry per marker: one of the member's own lab markers (its code, e.g. ferritin, or its name), the value, and the unit exactly as written on the report. The unit must be one the marker already uses; otherwise the call fails and lists the accepted units. Never convert a value to another unit yourself. Give referenceRange only when the report printed one; it is saved labelled as the range from the report, and nothing else is added. Each result waits on the member's Labs screen until they confirm it.",
    savedNote: DRAFT_NOTE,
    overlapNote: "",
    entry: z.strictObject({
      at: at.describe("When the sample was taken, ISO 8601 with a UTC offset. Not in the future."),
      marker: z.string().trim().min(1).max(120),
      value: z.number().finite(),
      unit: z.string().trim().min(1).max(40),
      referenceRange: z
        .strictObject({
          low: z.number().finite().optional(),
          high: z.number().finite().optional(),
          text: z.string().trim().min(1).max(120).optional(),
        })
        .refine(
          (range) =>
            range.low !== undefined || range.high !== undefined || range.text !== undefined,
          { message: "Give low, high or text." },
        )
        .optional()
        .describe("The reference range printed on the report, only when it printed one."),
    }),
  }),
  deleteTool({
    domain: "labs",
    name: "labs.delete",
    title: "Delete lab results",
    scope: "labs:write",
    what: "lab results (waiting for review or confirmed)",
  }),
]);
