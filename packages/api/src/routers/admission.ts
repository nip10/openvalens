import { z } from "zod";

import {
  ADMISSION_RATE_LIMIT_KEYS,
  admissionBeginInput,
  admissionCompleteInput,
  admissionIssueInput,
  admissionRevokeInput,
  checkAdmissionRateLimit,
  mapAdmissionError,
  requireAdmissionOrigin,
  requireAdmissionService,
  safeAdmissionInput,
} from "../admission";
import { instanceAdminProcedure, o, publicProcedure } from "../index";

/**
 * Issue #63 — `admission` RPC namespace.
 *
 * `status` is a public read (a harmless boolean). `begin`/`complete` bootstrap
 * or redeem admission without a session. `issueInvitation`/`revokeInvitation`/
 * `listInvitations` build on the default-deny `instanceAdminProcedure` (fresh
 * global role + banned check) and re-verify the issuer inside the service.
 *
 * Every mutation enforces an exact same-origin `Origin` header before input
 * validation or any service call; `mintSetupToken`/`pruneExpiredGrants` are
 * operator-only and are deliberately NOT exposed here.
 */

const originGuard = o.middleware(async ({ context, next }) => {
  requireAdmissionOrigin(context);
  return next({});
});

const rateLimit = (
  key: (typeof ADMISSION_RATE_LIMIT_KEYS)[keyof typeof ADMISSION_RATE_LIMIT_KEYS],
) =>
  o.middleware(async ({ context, next }) => {
    checkAdmissionRateLimit(context, key);
    return next({});
  });

const statusOutput = z.object({
  setupAvailable: z.boolean(),
  /** False when the server can't send email, so setup and invitations can't start. */
  emailDeliveryAvailable: z.boolean(),
});
const beginOutput = z.object({ enrollmentId: z.string() });
const completeOutput = z.object({ completed: z.literal(true) });
const issueOutput = z.object({ invitationId: z.string(), expiresAt: z.date() });
const revokeOutput = z.object({ revoked: z.boolean() });
const invitationSummary = z.object({
  id: z.string(),
  email: z.string(),
  expiresAt: z.date().nullable(),
  consumedAt: z.date().nullable(),
  status: z.enum(["pending", "consumed", "expired"]),
});
const listOutput = z.object({ invitations: z.array(invitationSummary) });

export const admissionRouter = {
  status: publicProcedure
    .input(z.object({}))
    .output(statusOutput)
    .handler(async ({ context }) => {
      try {
        return await requireAdmissionService(context).status();
      } catch (error) {
        mapAdmissionError(error);
      }
    }),

  begin: publicProcedure
    .use(originGuard)
    .use(rateLimit(ADMISSION_RATE_LIMIT_KEYS.begin))
    .use(safeAdmissionInput(admissionBeginInput))
    .input(admissionBeginInput)
    .output(beginOutput)
    .handler(async ({ context, input }) => {
      try {
        return await requireAdmissionService(context).begin(input);
      } catch (error) {
        mapAdmissionError(error);
      }
    }),

  complete: publicProcedure
    .use(originGuard)
    .use(rateLimit(ADMISSION_RATE_LIMIT_KEYS.complete))
    .use(safeAdmissionInput(admissionCompleteInput))
    .input(admissionCompleteInput)
    .output(completeOutput)
    .handler(async ({ context, input }) => {
      try {
        return await requireAdmissionService(context).complete(input, context.session);
      } catch (error) {
        mapAdmissionError(error);
      }
    }),

  issueInvitation: instanceAdminProcedure
    .use(originGuard)
    .use(rateLimit(ADMISSION_RATE_LIMIT_KEYS.issue))
    .use(safeAdmissionInput(admissionIssueInput))
    .input(admissionIssueInput)
    .output(issueOutput)
    .handler(async ({ context, input }) => {
      try {
        return await requireAdmissionService(context).issueInvitation(input, context.session);
      } catch (error) {
        mapAdmissionError(error);
      }
    }),

  revokeInvitation: instanceAdminProcedure
    .use(originGuard)
    .use(rateLimit(ADMISSION_RATE_LIMIT_KEYS.revoke))
    .use(safeAdmissionInput(admissionRevokeInput))
    .input(admissionRevokeInput)
    .output(revokeOutput)
    .handler(async ({ context, input }) => {
      try {
        return await requireAdmissionService(context).revokeInvitation(input, context.session);
      } catch (error) {
        mapAdmissionError(error);
      }
    }),

  listInvitations: instanceAdminProcedure
    .input(z.object({}))
    .output(listOutput)
    .handler(async ({ context }) => {
      try {
        return {
          invitations: await requireAdmissionService(context).listInvitations(context.session),
        };
      } catch (error) {
        mapAdmissionError(error);
      }
    }),
};
