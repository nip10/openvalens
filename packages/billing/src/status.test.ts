import { describe, expect, test } from "bun:test";

import { BillingConfigError, parseBillingConfig, planForPrice } from "./config";
import type { ProviderSubscription } from "./provider";
import { deriveState, pickSubscription } from "./service";
import {
  blocksNewCheckout,
  effectiveStatus,
  hasFullAccess,
  statusFromStripe,
  trialDaysLeft,
} from "./status";

const DAY = 86_400_000;
const now = new Date("2026-11-15T12:00:00Z");

function sub(over: Partial<ProviderSubscription>): ProviderSubscription {
  return {
    id: "sub_1",
    customerId: "cus_1",
    status: "active",
    priceId: "price_m",
    currentPeriodEnd: new Date(now.getTime() + 30 * DAY),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    created: new Date(now.getTime() - DAY),
    ...over,
  };
}

describe("status model", () => {
  test("a local trial past its end is ended even before the job records it", () => {
    const row = { status: "trialing" as const, stripeSubscriptionId: null };
    expect(effectiveStatus({ ...row, trialEndsAt: new Date(now.getTime() + 1) }, now)).toBe(
      "trialing",
    );
    expect(effectiveStatus({ ...row, trialEndsAt: now }, now)).toBe("ended");
    // A Stripe-side trial is Stripe's to move on.
    expect(
      effectiveStatus({ status: "trialing", stripeSubscriptionId: "sub_1", trialEndsAt: now }, now),
    ).toBe("trialing");
  });

  test("Stripe statuses map onto ours; incomplete attempts do not count", () => {
    expect(statusFromStripe("active")).toBe("active");
    expect(statusFromStripe("trialing")).toBe("trialing");
    expect(statusFromStripe("past_due")).toBe("past_due");
    expect(statusFromStripe("unpaid")).toBe("past_due");
    expect(statusFromStripe("canceled")).toBe("canceled");
    expect(statusFromStripe("incomplete")).toBeNull();
    expect(statusFromStripe("incomplete_expired")).toBeNull();
  });

  test("full access for trialing, active and past_due only (#298 adds the grace rules)", () => {
    expect(["trialing", "active", "past_due"].every((s) => hasFullAccess(s as never))).toBe(true);
    expect(hasFullAccess("canceled")).toBe(false);
    expect(hasFullAccess("ended")).toBe(false);
  });

  test("trial days left: rounded, at least 1 while running, then zero", () => {
    expect(trialDaysLeft(new Date(now.getTime() + 30 * DAY), now)).toBe(30);
    expect(trialDaysLeft(new Date(now.getTime() + 30 * DAY + 5_000), now)).toBe(30);
    expect(trialDaysLeft(new Date(now.getTime() + DAY / 3), now)).toBe(1);
    expect(trialDaysLeft(new Date(now.getTime() - DAY), now)).toBe(0);
  });

  test("a live Stripe subscription blocks a second Checkout", () => {
    expect(blocksNewCheckout("active", true)).toBe(true);
    expect(blocksNewCheckout("past_due", true)).toBe(true);
    expect(blocksNewCheckout("trialing", false)).toBe(false);
    expect(blocksNewCheckout("canceled", true)).toBe(false);
  });
});

describe("deriving state from Stripe's subscriptions", () => {
  const row = { trial_ends_at: new Date(now.getTime() + 10 * DAY) };

  test("no subscription keeps the local trial", () => {
    expect(deriveState(row, [], now)).toMatchObject({
      status: "trialing",
      stripeSubscriptionId: null,
    });
    expect(deriveState({ trial_ends_at: now }, [], now).status).toBe("ended");
  });

  test("a live subscription wins over a newer cancelled one", () => {
    const live = sub({ id: "sub_live", created: new Date(now.getTime() - 5 * DAY) });
    const old = sub({ id: "sub_old", status: "canceled", created: new Date(now.getTime() - DAY) });
    expect(pickSubscription([old, live])?.id).toBe("sub_live");
  });

  test("an incomplete attempt alone leaves the local state", () => {
    expect(deriveState(row, [sub({ status: "incomplete" })], now).status).toBe("trialing");
  });

  test("a Stripe-side trial takes its end from Stripe", () => {
    const trialEnd = new Date(now.getTime() + 9 * DAY);
    const next = deriveState(row, [sub({ status: "trialing", trialEnd })], now);
    expect(next.status).toBe("trialing");
    expect(next.trialEndsAt).toEqual(trialEnd);
  });

  test("period end and cancel-at-period-end are kept", () => {
    const next = deriveState(row, [sub({ cancelAtPeriodEnd: true })], now);
    expect(next).toMatchObject({ status: "active", cancelAtPeriodEnd: true, priceId: "price_m" });
  });
});

describe("billing config", () => {
  const valid = {
    STRIPE_SECRET_KEY: "rk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_abc",
    STRIPE_PRICE_MONTHLY: "price_m",
    STRIPE_PRICE_ANNUAL: "price_a",
  };

  test("parses a complete set", () => {
    const config = parseBillingConfig(valid);
    expect(config.prices).toEqual({ monthly: "price_m", annual: "price_a" });
    expect(planForPrice(config.prices, "price_a")).toBe("annual");
    expect(planForPrice(config.prices, "price_other")).toBeNull();
  });

  test("names missing or malformed keys, never values", () => {
    let error: unknown;
    try {
      parseBillingConfig({
        ...valid,
        STRIPE_SECRET_KEY: "pk_live_secretish",
        STRIPE_PRICE_ANNUAL: "",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BillingConfigError);
    const message = (error as Error).message;
    expect(message).toContain("STRIPE_SECRET_KEY");
    expect(message).toContain("STRIPE_PRICE_ANNUAL");
    expect(message).not.toContain("pk_live_secretish");
  });

  test("refuses the same price for both plans", () => {
    expect(() => parseBillingConfig({ ...valid, STRIPE_PRICE_ANNUAL: "price_m" })).toThrow(
      BillingConfigError,
    );
  });
});
