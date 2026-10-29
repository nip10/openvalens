import { startTrial } from "@openvalens/billing/trial";
import type { Database } from "@openvalens/db";

/**
 * Cloud variant hook (`--cloud`, Issue #301).
 *
 * The App Review demo account (#304, #305) is a Cloud account on a trialing
 * subscription (#297): the demo workspace owner gets the same local, card-free
 * 30-day trial a real Cloud sign-up starts, through the billing module's own
 * writer. The trial runs from the real time of seeding (not `today`), so it is
 * still running while reviewers use the account. No Stripe customer is
 * created; nothing is sent to Stripe.
 */
export async function markTrialingSubscription(
  db: Database,
  input: { ownerUserId: string; organizationId: string; today: string },
): Promise<{ applied: true; reason: string }> {
  await startTrial(db, { userId: input.ownerUserId });
  return { applied: true, reason: "the demo owner is on a 30-day free trial (no Stripe customer)" };
}
