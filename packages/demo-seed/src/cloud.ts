import type { Database } from "@openvalens/db";

/**
 * Cloud variant hook (`--cloud`, Issue #301).
 *
 * The App Review demo account (#304, #305) is a Cloud account on a trialing
 * subscription. Billing does not exist yet, so there is no table to write.
 *
 * TODO(#297): once Stripe subscriptions land, mark the demo workspace owner's
 * subscription as trialing here, through the billing module's own writer.
 */
export async function markTrialingSubscription(
  _db: Database,
  _input: { ownerUserId: string; organizationId: string; today: string },
): Promise<{ applied: false; reason: string }> {
  return { applied: false, reason: "Billing is not implemented yet (#297)." };
}
