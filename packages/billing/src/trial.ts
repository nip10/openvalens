import { sql, type Database, type DbTransaction } from "@openvalens/db";

import { TRIAL_DAYS } from "./status";

/**
 * Starting the free trial (Issue #297). Pure database work, no Stripe: the
 * trial is tracked locally and a Stripe customer is created only when the
 * person goes through Checkout on the web. That is what lets someone who
 * signs up from the mobile app use OpenValens Cloud with no purchase flow.
 *
 * {@link startTrial} is the one place a trial starts. Every Cloud sign-up path
 * calls it from `onAccountCreated` (email sign-up today, Google and Apple in
 * #296), inside the account-creation transaction, so an account never exists
 * without its trial and a failure rolls the sign-up back.
 */

/** A fresh opaque reference for Stripe metadata: random, never the user id. */
export function newCustomerRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `ovc_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Gives the new workspace owner a 30-day, card-free trial from now (database
 * time). Idempotent: an owner who already has a subscription row keeps it.
 */
export async function startTrial(
  tx: DbTransaction | Database,
  input: { userId: string; trialDays?: number },
): Promise<void> {
  const days = input.trialDays ?? TRIAL_DAYS;
  if (!Number.isInteger(days) || days < 0 || days > 366) throw new Error("Invalid trial length.");
  await tx.execute(
    sql`insert into "subscription" ("id", "user_id", "customer_ref", "status", "trial_ends_at", "created_at", "updated_at")
      values (${crypto.randomUUID()}, ${input.userId}, ${newCustomerRef()}, 'trialing', clock_timestamp() + make_interval(days => ${days}::int), clock_timestamp(), clock_timestamp())
      on conflict ("user_id") do nothing`,
  );
}

/**
 * The `onAccountCreated` hook of every Cloud sign-up path
 * (`@openvalens/auth/admission`): the new person owns their personal
 * workspace, so they are the billing unit and their trial starts now.
 */
export async function onCloudAccountCreated(input: {
  tx: DbTransaction;
  userId: string;
  organizationId: string;
}): Promise<void> {
  await startTrial(input.tx, { userId: input.userId });
}
