import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

// ─── Billing (Issue #297) ─────────────────────────────────────
//
// Cloud only (`DEPLOYMENT_MODE=cloud`); self-host never writes these tables.
// The billing unit is the workspace owner: one row per person who owns a
// workspace, never per member. People invited into someone else's workspace
// have no row of their own for that workspace. `packages/billing` reads and
// writes these tables through raw SQL, so the column contract here is frozen.
//
// Stripe sees the minimum: the account email and `customer_ref`, an opaque
// random reference that is not the user id. No health data, names or workspace
// names ever go to Stripe.

/** Subscription states (#297). #298 gates write access on them (see `@openvalens/billing` entitlement). */
export const SUBSCRIPTION_STATUS_VALUES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "ended",
] as const;

/**
 * One row per workspace owner. A row starts as a local, card-free 30-day
 * trial at sign-up (`trial_ends_at`); the Stripe customer and subscription ids
 * are filled in only after the person goes through Checkout on the web.
 *
 * Deleting a row with a Stripe customer queues that customer in
 * `billing_customer_erasure` (database trigger, see the migration), so account
 * deletion always cancels the Stripe subscription and deletes the customer,
 * whichever path removed the row.
 */
export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Opaque random reference: the only identifier Stripe metadata holds. */
    customerRef: text("customer_ref").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").unique(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    status: text("status").notNull(),
    priceId: text("price_id"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "date" }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** When the "trial ends in 3 days" email was claimed (sent once). */
    trialReminderSentAt: timestamp("trial_reminder_sent_at", { withTimezone: true, mode: "date" }),
    /** When the "trial ended" email was claimed (sent once). */
    trialEndedSentAt: timestamp("trial_ended_sent_at", { withTimezone: true, mode: "date" }),
    /** #298 — when the subscription went past due (start of the grace period). */
    pastDueSince: timestamp("past_due_since", { withTimezone: true, mode: "date" }),
    /** #298 — when the plan or trial ended (read-only; start of the retention clock). */
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    /** #298 — when the "your records will be deleted" email was claimed (sent once). */
    retentionWarningSentAt: timestamp("retention_warning_sent_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    subscriptionStatusCheck: check(
      "subscription_status_check",
      sql`${table.status} in ('trialing', 'active', 'past_due', 'canceled', 'ended')`,
    ),
    subscriptionStatusTrialIdx: index("subscription_status_trial_ends_at_idx").on(
      table.status,
      table.trialEndsAt,
    ),
    subscriptionStatusEndedIdx: index("subscription_status_ended_at_idx").on(
      table.status,
      table.endedAt,
    ),
  }),
);

/**
 * Stripe webhook events already applied, by Stripe event id (idempotency).
 * Holds only the id, the event type and when it was processed; never the
 * payload. Rows older than the retention window are pruned by the billing job.
 */
export const billingWebhookEvent = pgTable(
  "billing_webhook_event",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    billingWebhookEventProcessedAtIdx: index("billing_webhook_event_processed_at_idx").on(
      table.processedAt,
    ),
  }),
);

/**
 * Stripe customers to cancel and delete after the account that owned them was
 * erased (outbox). Filled by a trigger on `subscription` deletes and emptied
 * by the billing service once Stripe confirms. Deliberately no foreign key:
 * the account is gone by the time this is processed. Holds only Stripe ids.
 */
export const billingCustomerErasure = pgTable("billing_customer_erasure", {
  stripeCustomerId: text("stripe_customer_id").primaryKey(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "date" }),
});
