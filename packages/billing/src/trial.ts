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

/**
 * Keeps a local, card-free trial running for `days` more from now (database
 * time), for the app store review account's nightly refresh: reviewers must
 * never land on a read-only workspace. Only a local trial is touched: a row
 * with a Stripe customer or subscription is left to Stripe and reported as
 * `stripe`. An ended local trial starts running again, and its end and
 * retention markers are cleared, so the retention job never counts it as
 * ended. Never shortens a trial. No row (a deployment without billing):
 * `none`.
 */
export async function keepLocalTrialRunning(
  tx: DbTransaction | Database,
  input: { userId: string; days?: number },
): Promise<"extended" | "stripe" | "none"> {
  const days = input.days ?? TRIAL_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("Invalid trial length.");
  const rows = (
    await tx.execute<{ local: boolean }>(
      sql`select ("stripe_customer_id" is null and "stripe_subscription_id" is null) as "local"
        from "subscription" where "user_id" = ${input.userId} for update`,
    )
  ).rows;
  if (rows.length === 0) return "none";
  if (!rows[0]!.local) return "stripe";
  await tx.execute(
    sql`update "subscription" set "status" = 'trialing',
        "trial_ends_at" = greatest("trial_ends_at", clock_timestamp() + make_interval(days => ${days}::int)),
        "ended_at" = null, "retention_warning_sent_at" = null,
        "trial_reminder_sent_at" = null, "trial_ended_sent_at" = null,
        "updated_at" = clock_timestamp()
      where "user_id" = ${input.userId}`,
  );
  return "extended";
}
