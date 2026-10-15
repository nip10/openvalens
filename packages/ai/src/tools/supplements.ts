import type { SupplementListItem, SupplementSchedule } from "@openvalens/plans";
import { tool } from "ai";
import { z } from "zod";

import { logToolExecuted, resolveToolAccess, type AiHealthToolContext } from "./access";
import { shortText, unavailableReason } from "./format";

/**
 * `supplements` tool (Issue #13 plan, implemented in Issue #130).
 *
 * Lists the supplements the bound organization has scheduled
 * (`@openvalens/plans`) with their catalog dose / form / category and the
 * schedule details (time of day, frequency, quantity, status). By default only
 * supplements with an `active` schedule are returned.
 *
 * Redaction: row ids, schedule notes and change reasons / details are never
 * copied. Medications are a separate record and are not part of this tool.
 */

/** Cap on supplements returned. */
export const SUPPLEMENTS_MAX_ITEMS = 40;

export const supplementsInput = z.strictObject({
  includeInactive: z.boolean().default(false),
});

const supplementStatus = z.enum(["active", "paused", "stopped"]);

const scheduleRow = z.object({
  timeOfDay: z.string(),
  frequency: z.string().nullable(),
  quantity: z.string().nullable(),
  status: supplementStatus,
});

const supplementRow = z.object({
  name: z.string(),
  dose: z.string().nullable(),
  form: z.string().nullable(),
  category: z.string().nullable(),
  status: supplementStatus,
  latestChangeDate: z.string().nullable(),
  schedules: z.array(scheduleRow),
});

export const supplementsOutput = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    includeInactive: z.boolean(),
    totalCount: z.number(),
    activeCount: z.number(),
    supplements: z.array(supplementRow),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("no_data"),
    summary: z.string(),
    generatedAt: z.string(),
  }),
  z.object({
    status: z.literal("unavailable"),
    reason: unavailableReason,
    generatedAt: z.string(),
  }),
]);

export type SupplementsInput = z.input<typeof supplementsInput>;
export type SupplementsOutput = z.infer<typeof supplementsOutput>;

function scheduleStatus(status: string): z.infer<typeof supplementStatus> {
  return status === "active" || status === "paused" ? status : "stopped";
}

/** Overall status: active if any schedule is active, else paused if any is paused. */
function overallStatus(
  schedules: ReadonlyArray<z.infer<typeof scheduleRow>>,
): z.infer<typeof supplementStatus> {
  if (schedules.some((schedule) => schedule.status === "active")) return "active";
  if (schedules.some((schedule) => schedule.status === "paused")) return "paused";
  return "stopped";
}

/** Pure projection of the supplement list and each one's schedules. */
export function buildSupplements(
  items: ReadonlyArray<{ supplement: SupplementListItem; schedules: SupplementSchedule[] }>,
  input: SupplementsInput,
  now: Date = new Date(),
): SupplementsOutput {
  const generatedAt = now.toISOString();
  if (items.length === 0) {
    return { status: "no_data", summary: "No supplements are scheduled yet.", generatedAt };
  }

  const rows = items
    .map(({ supplement, schedules }) => {
      const scheduleRows = schedules.map((schedule) => ({
        timeOfDay: shortText(schedule.timeOfDay) ?? "unspecified",
        frequency: shortText(schedule.frequency),
        quantity: shortText(schedule.quantity),
        status: scheduleStatus(schedule.status),
      }));
      return {
        name: shortText(supplement.name, 80) ?? "Unnamed supplement",
        dose: shortText(supplement.dose),
        form: shortText(supplement.form),
        category: shortText(supplement.category),
        status: overallStatus(scheduleRows),
        latestChangeDate: supplement.latestChangeDate,
        schedules: scheduleRows,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const includeInactive = input.includeInactive ?? false;
  const visible = includeInactive ? rows : rows.filter((row) => row.status === "active");

  return {
    status: "ok",
    includeInactive,
    totalCount: rows.length,
    activeCount: rows.filter((row) => row.status === "active").length,
    supplements: visible.slice(0, SUPPLEMENTS_MAX_ITEMS),
    generatedAt,
  };
}

/** Freshly reads the bound organization's supplements and schedules. */
export async function executeSupplements(
  context: AiHealthToolContext,
  input: SupplementsInput,
): Promise<SupplementsOutput> {
  const access = await resolveToolAccess(context, "supplements");
  if (!access.allowed) {
    return { status: "unavailable", reason: access.reason, generatedAt: access.now.toISOString() };
  }

  const organizationId = context.organizationId;
  const supplements = await access.sources.listSupplements(organizationId);
  const items = await Promise.all(
    supplements.map(async (supplement) => ({
      supplement,
      schedules: await access.sources.listSupplementSchedules(organizationId, supplement.id),
    })),
  );
  const result = buildSupplements(items, input, access.now);

  logToolExecuted(
    context,
    access.logger,
    "supplements",
    result.status,
    result.status === "ok"
      ? { totalCount: result.totalCount, activeCount: result.activeCount }
      : {},
  );
  return result;
}

export function createSupplementsTool(context: AiHealthToolContext) {
  return tool({
    description:
      "List the supplements the user has scheduled: name, dose, form, category and each " +
      "schedule's time of day, frequency, quantity and status. Only active supplements by " +
      "default; set includeInactive to also list paused and stopped ones. Medications are " +
      "not included.",
    inputSchema: supplementsInput,
    execute: async (input) => executeSupplements(context, input),
  });
}
