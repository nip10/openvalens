import { z } from "zod";

import { ToolInputError } from "./format";
import type { WriteScope } from "./scopes";
import type { McpToolContext, McpToolDefinition } from "./tools";
import {
  BODY_ENTRY_KINDS,
  VITAL_ENTRY_KINDS,
  type AiAppWrites,
  type AiWriteDomain,
} from "./writes";

/**
 * The write tools (Issue #439, M2a): the save-at-once domains. Each domain has
 * a `log` tool that adds entries and a `delete` tool that deletes entries this
 * same grant wrote, each behind the domain's own write scope.
 *
 * Every call needs a `mutationId`: a retry with the same id and arguments
 * returns the first result and writes nothing again. Entries are the member's
 * own manual entries, labelled "via <app>"; they never change a device reading.
 * Larger imports go through the app's import screens.
 *
 * Later: workouts, sleep, trackers and pain (M2b); food and lab drafts (M2c).
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

const LOG_NOTE =
  "Saved as the member's own manual entries, labelled with this app's name; a device reading is never changed or merged, and an entry within ten minutes of a device reading of the same kind is marked possibleDuplicate (the device reading counts in daily totals). Returns an entryId per entry. Needs a mutationId; at most 100 entries per call by default.";

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
}): McpToolDefinition {
  return {
    name: input.name,
    title: input.title,
    description: `${input.description} ${LOG_NOTE}`,
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
]);
