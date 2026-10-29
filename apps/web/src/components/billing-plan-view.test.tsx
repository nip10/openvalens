import "@/testing/varlock-test-setup";

import { describe, expect, test } from "bun:test";
import { I18nProvider } from "@lingui/react";
import { englishI18n } from "@openvalens/i18n/testing";
import { renderToStaticMarkup } from "react-dom/server";

import { BillingPlanView, type BillingStatus } from "./billing-plan-view";

/** Issue #297 — Settings › Plan & billing. */

const PRICES = {
  monthly: { amount: 799, currency: "eur" },
  annual: { amount: 6900, currency: "eur" },
};
const base: BillingStatus = {
  viewer: "owner",
  ownerName: null,
  status: "trialing",
  access: "full",
  graceEndsAt: null,
  plan: null,
  trialEndsAt: "2026-11-28T12:00:00.000Z",
  trialDaysLeft: 30,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canSubscribe: true,
  canManage: false,
  prices: PRICES,
};

function render(status: Partial<BillingStatus>, checkout: "success" | "cancelled" | null = null) {
  return renderToStaticMarkup(
    <I18nProvider i18n={englishI18n}>
      <BillingPlanView
        status={{ ...base, ...status }}
        checkout={checkout}
        busy={null}
        actionError={null}
        onSubscribe={() => {}}
        onManage={() => {}}
      />
    </I18nProvider>,
  );
}

describe("BillingPlanView", () => {
  test("trial: days left, end date, both plans with VAT-inclusive prices", () => {
    const html = render({});
    expect(html).toInclude("Free trial");
    expect(html).toInclude("30 days left");
    expect(html).toInclude("November 28, 2026");
    expect(html).toInclude("€7.99 per month");
    expect(html).toInclude("€69.00 per year");
    expect(html).toInclude("Prices include VAT");
    expect(html.match(/Subscribe/g)?.length).toBe(2);
    expect(html).not.toInclude("Manage billing");
  });

  test("active: plan, renewal date and the portal instead of Checkout", () => {
    const html = render({
      status: "active",
      plan: "annual",
      currentPeriodEnd: "2027-11-01T00:00:00.000Z",
      canSubscribe: false,
      canManage: true,
      trialEndsAt: null,
      trialDaysLeft: null,
    });
    expect(html).toInclude("Active");
    expect(html).toInclude("Annual plan");
    expect(html).toInclude("Renews on November 1, 2027");
    expect(html).toInclude("Manage billing");
    expect(html).not.toInclude("Subscribe");
  });

  test("cancelled at period end and payment failure are spelled out", () => {
    expect(
      render({
        status: "active",
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2027-01-01T00:00:00.000Z",
        canSubscribe: false,
        canManage: true,
      }),
    ).toInclude("stays active until January 1, 2027");
    expect(render({ status: "past_due", canSubscribe: false, canManage: true })).toInclude(
      "Payment failed",
    );
  });

  test("ended trial offers the plans and says records stay", () => {
    const html = render({ status: "ended", trialEndsAt: null, trialDaysLeft: null });
    expect(html).toInclude("Trial ended");
    expect(html).toInclude("Choose a plan");
    expect(html).toInclude("always export or delete them");
  });

  test("return from Checkout", () => {
    expect(render({}, "success")).toInclude("as soon as Stripe confirms");
    expect(render({}, "cancelled")).toInclude("Nothing was charged");
  });

  test("prices that could not be loaded leave the buttons without an amount", () => {
    const html = render({ prices: { monthly: null, annual: null } });
    expect(html).not.toInclude("€");
    expect(html.match(/Subscribe/g)?.length).toBe(2);
  });

  test("#298 past due: the grace end date while writes still work, then read-only", () => {
    expect(
      render({
        status: "past_due",
        graceEndsAt: "2026-11-17T12:00:00.000Z",
        canSubscribe: false,
        canManage: true,
      }),
    ).toInclude("by November 17, 2026 to keep adding and syncing records");
    const html = render({
      status: "past_due",
      access: "read_only",
      graceEndsAt: "2026-11-17T12:00:00.000Z",
      canSubscribe: false,
      canManage: true,
    });
    expect(html).toInclude("your workspace is read-only");
    expect(html).toInclude("You can still read, export and delete your");
  });

  test("#298 member of someone else's workspace: neutral note, no prices or buttons", () => {
    for (const access of ["full", "read_only"] as const) {
      const html = render({
        viewer: "member",
        ownerName: "Ana",
        status: access === "full" ? "active" : "canceled",
        access,
        canSubscribe: false,
        canManage: false,
        prices: { monthly: null, annual: null },
      });
      expect(html).toInclude("Your access to this workspace comes from Ana’s plan");
      expect(html).not.toInclude("Subscribe");
      expect(html).not.toInclude("Choose a plan");
      expect(html).not.toInclude("Manage billing");
      expect(html).not.toInclude("€");
    }
  });
});
