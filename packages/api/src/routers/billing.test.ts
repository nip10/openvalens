import { describe, expect, test } from "bun:test";
import { BillingError, type BillingService, type BillingStatusView } from "@openvalens/billing";

import type { Context } from "../context";
import { appRouter } from "./index";

/** Issue #297 — `billing` RPC: Cloud only, the person's own plan, typed errors. */

const STATUS: BillingStatusView = {
  status: "trialing",
  plan: null,
  trialEndsAt: "2026-11-28T00:00:00.000Z",
  trialDaysLeft: 30,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  canSubscribe: true,
  canManage: false,
  prices: { monthly: { amount: 799, currency: "eur" }, annual: { amount: 6900, currency: "eur" } },
};

function billing(overrides: Partial<BillingService> = {}) {
  const calls: unknown[] = [];
  const service: BillingService = {
    getStatus: async (userId) => {
      calls.push({ getStatus: userId });
      return STATUS;
    },
    startCheckout: async (input) => {
      calls.push({ startCheckout: input });
      return { url: "https://checkout.stripe.test/c/1" };
    },
    openPortal: async (input) => {
      calls.push({ openPortal: input });
      return { url: "https://billing.stripe.test/p/1" };
    },
    handleWebhook: async () => ({ status: 200, outcome: "ignored" }),
    processErasures: async () => ({ completed: 0, failed: 0 }),
    runScheduled: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
  return { service, calls };
}

function context(overrides: Record<string, unknown> = {}, impersonatedBy: string | null = null) {
  return {
    session: { user: { id: "user-1" }, session: { id: "s-1", impersonatedBy } },
    db: {},
    correlationId: "corr-1",
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  } as unknown as Context;
}

describe("billing procedures", () => {
  test("self-host (no billing service): every procedure is NOT_FOUND", async () => {
    const ctx = context({ billing: null });
    await expect(appRouter.billing.status.callable({ context: ctx })({})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      appRouter.billing.checkout.callable({ context: ctx })({ plan: "monthly" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(appRouter.billing.portal.callable({ context: ctx })({})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("signed-out callers are refused", async () => {
    const { service } = billing();
    await expect(
      appRouter.billing.status.callable({ context: context({ billing: service, session: null }) })(
        {},
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("status and checkout act on the signed-in person only", async () => {
    const { service, calls } = billing();
    const ctx = context({ billing: service });
    expect(await appRouter.billing.status.callable({ context: ctx })({})).toEqual(STATUS);
    expect(
      await appRouter.billing.checkout.callable({ context: ctx })({
        plan: "annual",
        locale: "pt-PT",
      }),
    ).toEqual({ url: "https://checkout.stripe.test/c/1" });
    expect(calls).toEqual([
      { getStatus: "user-1" },
      { startCheckout: { userId: "user-1", plan: "annual", locale: "pt-PT" } },
    ]);
  });

  test("an impersonated session cannot start checkout or open the portal", async () => {
    const { service, calls } = billing();
    const ctx = context({ billing: service }, "admin-1");
    await expect(
      appRouter.billing.checkout.callable({ context: ctx })({ plan: "monthly" }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(appRouter.billing.portal.callable({ context: ctx })({})).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(calls).toEqual([]);
  });

  test("billing errors map to stable codes", async () => {
    const cases: [BillingError["code"], string][] = [
      ["ALREADY_SUBSCRIBED", "CONFLICT"],
      ["NO_CUSTOMER", "NOT_FOUND"],
      ["PROVIDER_UNAVAILABLE", "SOURCE_UNAVAILABLE"],
    ];
    for (const [billingCode, apiCode] of cases) {
      const { service } = billing({
        startCheckout: async () => {
          throw new BillingError(billingCode);
        },
        openPortal: async () => {
          throw new BillingError(billingCode);
        },
      });
      const ctx = context({ billing: service });
      await expect(
        appRouter.billing.checkout.callable({ context: ctx })({ plan: "monthly" }),
      ).rejects.toMatchObject({ code: apiCode });
      await expect(appRouter.billing.portal.callable({ context: ctx })({})).rejects.toMatchObject({
        code: apiCode,
      });
    }
  });

  test("an unknown plan is invalid input", async () => {
    const { service } = billing();
    await expect(
      appRouter.billing.checkout.callable({ context: context({ billing: service }) })({
        plan: "lifetime",
      } as never),
    ).rejects.toBeDefined();
  });
});
