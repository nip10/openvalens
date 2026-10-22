import {
  CYCLE_FLOWS,
  CYCLE_IMPORT_SOURCES,
  createCycleService,
  cycleEnableInput,
  cycleEraseInput,
  cycleEstimatesInput,
  cycleImportIdInput,
  cycleImportInput,
  cyclePeriodIdInput,
  cyclePeriodInput,
  cyclePeriodUpdateInput,
  cycleSettingsInput,
} from "@openvalens/body";
import { z } from "zod";

import { permissionedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #91 — optional cycle logging, mounted as `appRouter.cycle`.
 *
 * Member-private: every call needs the member's own, non-impersonated
 * session, and rows are keyed by the session's user and organization, never
 * the input. Off by default behind a separate consent (`enable`); while off,
 * reads are empty and writes return `CONFLICT`. Nothing here writes audit
 * metadata or logs that could carry cycle dates, and nothing touches
 * nutrition targets.
 */

const empty = z.strictObject({});
const settingsOutput = z.object({
  enabled: z.boolean(),
  noNaturalCycle: z.boolean(),
  consentVersion: z.string().nullable(),
});
const period = z.object({
  id: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  flow: z.enum(CYCLE_FLOWS).nullable(),
  notes: z.string().nullable(),
  source: z.enum(["manual", ...CYCLE_IMPORT_SOURCES]),
  importId: z.string().nullable(),
});
const importRun = z.object({
  id: z.string(),
  source: z.enum(CYCLE_IMPORT_SOURCES),
  periodCount: z.number(),
  importedAt: z.string(),
});
const cycleEstimate = z.object({
  startDate: z.string(),
  nextStartDate: z.string().nullable(),
  lengthDays: z.number().nullable(),
  lutealEstimate: z.object({ from: z.string(), likelyFrom: z.string(), to: z.string() }).nullable(),
});
const estimatesOutput = z.discriminatedUnion("state", [
  z.object({ state: z.literal("off"), reason: z.literal("no_natural_cycle") }),
  z.object({ state: z.literal("no_data") }),
  z.object({
    state: z.literal("estimated"),
    cycles: z.array(cycleEstimate),
    current: z
      .object({ startDate: z.string(), dayOfCycle: z.number(), confidence: z.literal("low") })
      .nullable(),
  }),
]);

const OFF_MESSAGE = "Turn on cycle logging first.";

function member(context: {
  session: Parameters<typeof requireProfileOwner>[0];
  authz: { user: { id: string }; activeOrganizationId: string };
}) {
  const userId = requireProfileOwner(context.session);
  if (userId !== context.authz.user.id)
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { userId, organizationId: context.authz.activeOrganizationId };
}

const read = () => permissionedProcedure({ resource: "records", action: "read" });
const write = () => permissionedProcedure({ resource: "records", action: "write" });

export const cycleRouter = {
  settings: read()
    .use(validateInput(empty))
    .input(empty)
    .output(settingsOutput)
    .handler(async ({ context }) => {
      const { userId } = member(context);
      return createCycleService({ db: context.db }).settings(userId);
    }),

  enable: write()
    .use(validateInput(cycleEnableInput))
    .input(cycleEnableInput)
    .output(settingsOutput)
    .handler(async ({ context, input }) => {
      const { userId } = member(context);
      return createCycleService({ db: context.db }).enable(userId, input.consentVersion);
    }),

  updateSettings: write()
    .use(validateInput(cycleSettingsInput))
    .input(cycleSettingsInput)
    .output(settingsOutput)
    .handler(async ({ context, input }) => {
      const { userId } = member(context);
      const result = await createCycleService({ db: context.db }).updateSettings(
        userId,
        input.noNaturalCycle,
      );
      if (!result) throw raiseApiError("CONFLICT", OFF_MESSAGE);
      return result;
    }),

  turnOffAndErase: write()
    .use(validateInput(cycleEraseInput))
    .input(cycleEraseInput)
    .output(z.object({ periods: z.number(), imports: z.number() }))
    .handler(async ({ context }) => {
      const { userId } = member(context);
      return createCycleService({ db: context.db }).turnOffAndErase(userId);
    }),

  periods: read()
    .use(validateInput(empty))
    .input(empty)
    .output(z.array(period))
    .handler(async ({ context }) => createCycleService({ db: context.db }).list(member(context))),

  logPeriod: write()
    .use(validateInput(cyclePeriodInput))
    .input(cyclePeriodInput)
    .output(period)
    .handler(async ({ context, input }) => {
      const created = await createCycleService({ db: context.db }).create(member(context), input);
      if (!created) throw raiseApiError("CONFLICT", OFF_MESSAGE);
      return created;
    }),

  updatePeriod: write()
    .use(validateInput(cyclePeriodUpdateInput))
    .input(cyclePeriodUpdateInput)
    .output(period)
    .handler(async ({ context, input }) => {
      const updated = await createCycleService({ db: context.db }).update(
        member(context),
        input.id,
        input.period,
      );
      if (!updated) throw raiseApiError("NOT_FOUND", "Period not found.");
      return updated;
    }),

  deletePeriod: write()
    .use(validateInput(cyclePeriodIdInput))
    .input(cyclePeriodIdInput)
    .output(z.object({ deleted: z.literal(true) }))
    .handler(async ({ context, input }) => {
      const deleted = await createCycleService({ db: context.db }).remove(
        member(context),
        input.id,
      );
      if (!deleted) throw raiseApiError("NOT_FOUND", "Period not found.");
      return { deleted: true as const };
    }),

  importPeriods: write()
    .use(validateInput(cycleImportInput))
    .input(cycleImportInput)
    .output(
      z.object({ importId: z.string().nullable(), imported: z.number(), skipped: z.number() }),
    )
    .handler(async ({ context, input }) => {
      const result = await createCycleService({ db: context.db }).importPeriods(
        member(context),
        input,
      );
      if (!result) throw raiseApiError("CONFLICT", OFF_MESSAGE);
      return result;
    }),

  imports: read()
    .use(validateInput(empty))
    .input(empty)
    .output(z.array(importRun))
    .handler(async ({ context }) =>
      createCycleService({ db: context.db }).imports(member(context)),
    ),

  undoImport: write()
    .use(validateInput(cycleImportIdInput))
    .input(cycleImportIdInput)
    .output(z.object({ removed: z.number() }))
    .handler(async ({ context, input }) => {
      const removed = await createCycleService({ db: context.db }).undoImport(
        member(context),
        input.importId,
      );
      if (removed === null) throw raiseApiError("NOT_FOUND", "Import not found.");
      return { removed };
    }),

  estimates: read()
    .use(validateInput(cycleEstimatesInput))
    .input(cycleEstimatesInput)
    .output(estimatesOutput)
    .handler(async ({ context, input }) => {
      const result = await createCycleService({ db: context.db }).estimates(
        member(context),
        input.today,
      );
      if (!result) throw raiseApiError("CONFLICT", OFF_MESSAGE);
      return result;
    }),
};
