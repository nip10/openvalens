import {
  DELETE_CONFIRMATION,
  deleteSubjectData,
  isFreshSession,
  previewSubjectData,
  resolveSubject,
} from "@openvalens/data-rights";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Data-rights procedures (Issue #89): preview and perform "delete everything".
 *
 * The subject is always the signed-in user and the health records they own;
 * inputs are `strictObject` so no user or organization id can be supplied.
 * Deleting requires a sign-in within the last 10 minutes, the typed phrase
 * "DELETE", and no owned record shared with another owner. Logs carry counts
 * only; the erasure ledger keeps the ids.
 */

const logger = createStructuredLogger({ level: "info" });

const previewInput = z.strictObject({});
const deleteInput = z.strictObject({ confirmation: z.string().max(32) });

const previewOutput = z.object({
  organizations: z.array(z.object({ id: z.string(), name: z.string() })),
  blockers: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      reason: z.literal("OTHER_OWNER"),
    }),
  ),
  rowCounts: z.record(z.string(), z.number()),
  totalRows: z.number(),
  reauthRequired: z.boolean(),
  confirmationPhrase: z.string(),
});

const deleteOutput = z.object({
  erasedAt: z.string(),
  totalRows: z.number(),
});

function sessionCreatedAt(session: { session?: { createdAt?: Date | string } }): Date {
  const value = session.session?.createdAt;
  return value instanceof Date ? value : new Date(value ?? 0);
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

export const dataRightsRouter = {
  deletionPreview: protectedProcedure
    .use(validateInput(previewInput))
    .input(previewInput)
    .output(previewOutput)
    .handler(async ({ context }) => {
      const resolution = await resolveSubject(context.db, context.session.user.id);
      const rowCounts = await previewSubjectData(context.db, resolution.subject);
      return {
        organizations: resolution.organizations,
        blockers: resolution.blockers,
        rowCounts,
        totalRows: sum(rowCounts),
        reauthRequired: !isFreshSession(sessionCreatedAt(context.session)),
        confirmationPhrase: DELETE_CONFIRMATION,
      };
    }),

  deleteEverything: protectedProcedure
    .use(validateInput(deleteInput))
    .input(deleteInput)
    .output(deleteOutput)
    .handler(async ({ input, context }) => {
      if (input.confirmation !== DELETE_CONFIRMATION)
        throw raiseApiError("INVALID_INPUT", `Type ${DELETE_CONFIRMATION} to confirm.`);
      if (!isFreshSession(sessionCreatedAt(context.session)))
        throw raiseApiError("REAUTH_REQUIRED", "Sign in again to delete your data.");

      const resolution = await resolveSubject(context.db, context.session.user.id);
      if (resolution.blockers.length > 0)
        throw raiseApiError(
          "CONFLICT",
          "A record you own has another owner. Remove them or transfer it first.",
          { blockers: resolution.blockers },
        );

      const report = await deleteSubjectData(context.db, resolution.subject);
      const totalRows = sum(report.rowCounts);
      logger.info("data_rights.subject_erased", {
        correlationId: context.correlationId,
        organizations: report.organizationIds.length,
        tables: Object.keys(report.rowCounts).length,
        rows: totalRows,
      });
      return { erasedAt: report.erasedAt, totalRows };
    }),
};
