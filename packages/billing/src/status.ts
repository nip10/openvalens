/**
 * Subscription status model (Issue #297), shared with the entitlement check
 * that #298 adds. Pure: no database, no Stripe.
 *
 * | Status     | Meaning                                                              |
 * |------------|----------------------------------------------------------------------|
 * | `trialing` | The free trial is running (local, no card; or Stripe-side after an    |
 * |            | early Checkout, which keeps the rest of the trial).                  |
 * | `active`   | Paid and current. `cancel_at_period_end` may be set: still active.   |
 * | `past_due` | Stripe could not collect a renewal (`past_due` or `unpaid`).         |
 * | `canceled` | The Stripe subscription ended (cancelled, or not renewed).           |
 * | `ended`    | The trial ran out and the person never subscribed.                   |
 *
 * Read-only access, export and deletion in the last two states are #298's.
 */

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "ended",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Length of the free trial that starts at sign-up. */
export const TRIAL_DAYS = 30;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
/** The "your trial ends soon" email goes out this long before the end. */
export const TRIAL_REMINDER_MS = 3 * 24 * 60 * 60 * 1000;

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** The fields of a `subscription` row the status depends on. */
export type StatusInput = {
  status: SubscriptionStatus;
  trialEndsAt: Date;
  stripeSubscriptionId: string | null;
};

/**
 * The status right now. A local trial whose end has passed is `ended` even
 * before the scheduled job records it, so gating never depends on the job
 * having run. A Stripe-side trial is left to Stripe, which moves it on.
 */
export function effectiveStatus(row: StatusInput, now: Date): SubscriptionStatus {
  if (
    row.status === "trialing" &&
    row.stripeSubscriptionId === null &&
    row.trialEndsAt.getTime() <= now.getTime()
  ) {
    return "ended";
  }
  return row.status;
}

/**
 * Whether the state allows full use of the app. #298 refines `past_due` with a
 * grace period; `canceled` and `ended` keep reads, export and deletion only.
 */
export function hasFullAccess(status: SubscriptionStatus): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}

/**
 * Whole days left in the trial: rounded (so a fresh trial reads 30 despite
 * clock skew between the app and database), at least 1 while it is running,
 * 0 once it has ended.
 */
export function trialDaysLeft(trialEndsAt: Date, now: Date): number {
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Maps a Stripe subscription status onto ours. `null` means "this Stripe
 * subscription never became a paid plan" (`incomplete`,
 * `incomplete_expired`): the local trial state applies instead.
 */
export function statusFromStripe(stripeStatus: string): SubscriptionStatus | null {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "paused":
      return "ended";
    default:
      return null;
  }
}

/** Status from the local trial alone (no live Stripe subscription). */
export function localTrialStatus(trialEndsAt: Date, now: Date): SubscriptionStatus {
  return trialEndsAt.getTime() > now.getTime() ? "trialing" : "ended";
}

/**
 * Stripe subscription statuses that mean the person already has a plan, so
 * Checkout must not start a second one (they manage it in the portal).
 */
export function blocksNewCheckout(status: SubscriptionStatus, hasStripeSubscription: boolean) {
  if (!hasStripeSubscription) return false;
  return status === "trialing" || status === "active" || status === "past_due";
}
