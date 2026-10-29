import { effectiveStatus, type StatusInput, type SubscriptionStatus } from "./status";

/**
 * Entitlement (Issue #298): what a workspace may do in each subscription
 * state. Pure: no database, no Stripe. OpenValens Cloud only; a self-hosted
 * deployment never asks (it always has full access).
 *
 * | State                         | Read | Write | Export / delete | AI coach |
 * |-------------------------------|------|-------|-----------------|----------|
 * | trialing, active              | yes  | yes   | yes             | yes      |
 * | past_due, within grace        | yes  | yes   | yes             | yes      |
 * | past_due after grace, canceled, ended, no plan | yes | no | yes | no    |
 *
 * Access follows the **owner** of the workspace in use: invited members never
 * pay and get whatever the owner's plan allows.
 */

export type AccessLevel = "full" | "read_only";

/** Default grace period after a renewal payment fails (`BILLING_PAST_DUE_GRACE_DAYS`). */
export const DEFAULT_PAST_DUE_GRACE_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessInput = StatusInput & {
  /** When the subscription went `past_due` (start of the grace period). */
  pastDueSince: Date | null;
};

export type AccessState = {
  /** `none`: the owner has no subscription row (never had a Cloud trial). */
  status: SubscriptionStatus | "none";
  level: AccessLevel;
  /** While `past_due`: when write access stops unless the payment goes through. */
  graceEndsAt: Date | null;
};

/**
 * The access a subscription row grants right now. `null` (no row) is
 * read-only: an owner without a trial goes straight to a paid plan (#297).
 * A `past_due` row without a recorded start counts from `now`, so a missing
 * timestamp never cuts access short.
 */
export function accessState(row: AccessInput | null, now: Date, graceMs: number): AccessState {
  if (!row) return { status: "none", level: "read_only", graceEndsAt: null };
  const status = effectiveStatus(row, now);
  switch (status) {
    case "trialing":
    case "active":
      return { status, level: "full", graceEndsAt: null };
    case "past_due": {
      const since = row.pastDueSince ?? now;
      const graceEndsAt = new Date(since.getTime() + graceMs);
      return {
        status,
        level: graceEndsAt.getTime() > now.getTime() ? "full" : "read_only",
        graceEndsAt,
      };
    }
    case "canceled":
    case "ended":
      return { status, level: "read_only", graceEndsAt: null };
  }
}

/** Parses `BILLING_PAST_DUE_GRACE_DAYS`: a whole number of days, 0–60. */
export function parseGraceDays(raw: string | number | undefined): number {
  if (raw === undefined || (typeof raw === "string" && raw.trim() === ""))
    return DEFAULT_PAST_DUE_GRACE_DAYS;
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > 60) {
    throw new RangeError("BILLING_PAST_DUE_GRACE_DAYS must be a whole number from 0 to 60");
  }
  return value;
}

/**
 * Retention of ended Cloud accounts (`CLOUD_ENDED_RETENTION_MONTHS`). `null`
 * (unset, the default) never deletes anything. The operator states the value
 * in the privacy policy (#300).
 */
export type RetentionConfig = {
  months: number | null;
  /** Count and log what would happen; send nothing, delete nothing. */
  dryRun: boolean;
};

/** How long before deletion the warning email goes out (and the minimum gap after it). */
export const RETENTION_WARNING_LEAD_DAYS = 30;
export const RETENTION_WARNING_LEAD_MS = RETENTION_WARNING_LEAD_DAYS * DAY_MS;

export function parseRetentionConfig(env: {
  CLOUD_ENDED_RETENTION_MONTHS?: string | number;
  CLOUD_ENDED_RETENTION_DRY_RUN?: string | boolean;
}): RetentionConfig {
  const raw = env.CLOUD_ENDED_RETENTION_MONTHS;
  let months: number | null = null;
  if (raw !== undefined && !(typeof raw === "string" && raw.trim() === "")) {
    const value = typeof raw === "number" ? raw : Number(raw.trim());
    if (!Number.isInteger(value) || value < 1 || value > 120) {
      throw new RangeError("CLOUD_ENDED_RETENTION_MONTHS must be a whole number from 1 to 120");
    }
    months = value;
  }
  const dry = env.CLOUD_ENDED_RETENTION_DRY_RUN;
  const dryRun = dry === true || (typeof dry === "string" && /^(1|true|yes)$/i.test(dry.trim()));
  return { months, dryRun };
}

/** `date` minus whole calendar months (UTC), clamped to the month's last day. */
export function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** `date` plus whole calendar months (UTC), clamped to the month's last day. */
export function addMonths(date: Date, months: number): Date {
  return subtractMonths(date, -months);
}
