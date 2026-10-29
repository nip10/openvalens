import type { BillingService } from "@openvalens/billing";
import { isLocale } from "@openvalens/i18n";
import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, raiseApiError } from "../index";

/**
 * Issue #297 — Settings › Plan & billing (web, OpenValens Cloud only).
 *
 * Every procedure answers `NOT_FOUND` on a self-hosted deployment, where the
 * billing service is never built. The billing unit is the signed-in person as
 * owner of their own workspace: people invited into someone else's workspace
 * are covered by that owner and never pay for it. While such a person uses
 * that workspace, `status` answers the neutral `member` view (#298): the
 * owner's state and name, no prices, no Checkout and no portal.
 *
 * `checkout` and `portal` return a Stripe-hosted URL the web app navigates
 * to. The mobile app never calls these (App Store Review Guideline 3.1.3(f));
 * `scripts/native-no-billing.test.ts` guards that.
 */

const logger = createStructuredLogger({ level: "info" });

const price = z.object({ amount: z.number().int(), currency: z.string() }).nullable();
const statusOutput = z.object({
  viewer: z.enum(["owner", "member"]),
  ownerName: z.string().nullable(),
  status: z.enum(["none", "trialing", "active", "past_due", "canceled", "ended"]),
  access: z.enum(["full", "read_only"]),
  graceEndsAt: z.string().nullable(),
  plan: z.enum(["monthly", "annual"]).nullable(),
  trialEndsAt: z.string().nullable(),
  trialDaysLeft: z.number().int().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canSubscribe: z.boolean(),
  canManage: z.boolean(),
  prices: z.object({ monthly: price, annual: price }),
  checkoutAcknowledgement: z.object({ version: z.string(), termsUrl: z.string().url() }).nullable(),
});
const locale = z.string().max(16).optional();
const redirectOutput = z.object({ url: z.string() });

function requireBilling(context: Context): BillingService {
  if (!context.billing) throw raiseApiError("NOT_FOUND", "Not found.");
  return context.billing;
}

/** Billing changes are the person's own: never through an impersonated session. */
function requireOwnSession(context: { session: { session?: { impersonatedBy?: string | null } } }) {
  if (context.session.session?.impersonatedBy != null) {
    throw raiseApiError("PERMISSION_DENIED", "Billing can only be changed by the account owner.");
  }
}

/**
 * #298 — only the owner of the workspace in use subscribes: a member is
 * covered by the owner's plan and is never sent to Checkout for it.
 */
async function requireWorkspaceOwner(
  billing: BillingService,
  session: { user: { id: string }; session?: { activeOrganizationId?: string | null } },
) {
  const access = await billing.resolveAccess({
    userId: session.user.id,
    organizationId: session.session?.activeOrganizationId ?? null,
  });
  if (!access.viewerIsOwner) {
    throw raiseApiError("PERMISSION_DENIED", "Only the workspace owner chooses its plan.");
  }
}

function mapBillingError(error: unknown, correlationId: string): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : null;
  switch (code) {
    case "ALREADY_SUBSCRIBED":
      throw raiseApiError("CONFLICT", "You already have a plan. Manage it instead.");
    case "ACKNOWLEDGEMENT_REQUIRED":
      throw raiseApiError("INVALID_INPUT", "Both checkout acknowledgements are required.");
    case "ACKNOWLEDGEMENT_STALE":
      throw raiseApiError("CONFLICT", "Checkout terms changed. Review them and try again.");
    case "NO_CUSTOMER":
    case "NOT_FOUND":
      throw raiseApiError("NOT_FOUND", "No plan to manage yet.");
    case "PROVIDER_UNAVAILABLE":
      logger.warn("billing.request.provider_unavailable", { correlationId });
      throw raiseApiError("SOURCE_UNAVAILABLE", "Billing is unavailable right now. Try again.");
    default:
      throw error;
  }
}

export const billingRouter = {
  status: protectedProcedure
    .input(z.object({}))
    .output(statusOutput)
    .handler(async ({ context }) =>
      requireBilling(context).getStatus(
        context.session.user.id,
        context.session.session?.activeOrganizationId ?? null,
      ),
    ),

  checkout: protectedProcedure
    .input(
      z.object({
        plan: z.enum(["monthly", "annual"]),
        locale,
        acceptedImmediateStart: z.literal(true),
        acceptedWithdrawalAcknowledgement: z.literal(true),
        acknowledgementVersion: z.string().min(1).max(64),
      }),
    )
    .output(redirectOutput)
    .handler(async ({ context, input }) => {
      const billing = requireBilling(context);
      requireOwnSession(context);
      await requireWorkspaceOwner(billing, context.session);
      try {
        return await billing.startCheckout({
          userId: context.session.user.id,
          plan: input.plan,
          acceptedImmediateStart: input.acceptedImmediateStart,
          acceptedWithdrawalAcknowledgement: input.acceptedWithdrawalAcknowledgement,
          acknowledgementVersion: input.acknowledgementVersion,
          ...(isLocale(input.locale) ? { locale: input.locale } : {}),
        });
      } catch (error) {
        mapBillingError(error, context.correlationId);
      }
    }),

  portal: protectedProcedure
    .input(z.object({ locale }))
    .output(redirectOutput)
    .handler(async ({ context, input }) => {
      const billing = requireBilling(context);
      requireOwnSession(context);
      try {
        return await billing.openPortal({
          userId: context.session.user.id,
          ...(isLocale(input.locale) ? { locale: input.locale } : {}),
        });
      } catch (error) {
        mapBillingError(error, context.correlationId);
      }
    }),
};
