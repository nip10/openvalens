import { z } from "zod";

import { protectedProcedure, raiseApiError } from "../index";

/**
 * Issue #298 — the access state of the workspace in use, for the web banner
 * and the mobile app (which pauses phone sync while it is read-only).
 *
 * Deliberately plan-neutral: no price, no plan name and no link, so the
 * mobile app can call it without showing anything to buy (App Store Review
 * Guideline 3.1.3(f)). On a self-hosted server it always answers full access
 * without resolving anything.
 */

const statusOutput = z.object({
  mode: z.enum(["self-hosted", "cloud"]),
  /** `read_only`: writes are refused (`ACCESS_READ_ONLY`); reads and export work. */
  level: z.enum(["full", "read_only"]),
  /** Cloud only; `null` on self-host. */
  state: z.enum(["none", "trialing", "active", "past_due", "canceled", "ended"]).nullable(),
  /** While `past_due`: when write access stops unless the payment goes through. */
  graceEndsAt: z.string().nullable(),
  /** `owner`: the signed-in person owns the workspace in use. */
  viewer: z.enum(["owner", "member"]),
  /** The workspace owner's display name (`member` only). */
  ownerName: z.string().nullable(),
});

export const accessRouter = {
  status: protectedProcedure
    .input(z.object({}).optional())
    .output(statusOutput)
    .handler(async ({ context }) => {
      if (context.deployment?.mode !== "cloud") {
        return {
          mode: "self-hosted" as const,
          level: "full" as const,
          state: null,
          graceEndsAt: null,
          viewer: "owner" as const,
          ownerName: null,
        };
      }
      if (!context.billing) throw raiseApiError("INTERNAL", "Something went wrong.");
      const access = await context.billing.resolveAccess({
        userId: context.session.user.id,
        organizationId: context.session.session?.activeOrganizationId ?? null,
      });
      return {
        mode: "cloud" as const,
        level: access.level,
        state: access.status,
        graceEndsAt: access.graceEndsAt?.toISOString() ?? null,
        viewer: access.viewerIsOwner ? ("owner" as const) : ("member" as const),
        ownerName: access.ownerName,
      };
    }),
};
