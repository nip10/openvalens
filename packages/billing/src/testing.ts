import type { StripeClientLike } from "./providers/stripe";

/**
 * In-memory stand-in for the Stripe API (Issue #297), for tests only. It
 * implements the slice of the client `providers/stripe.ts` calls, records
 * every request's parameters (so the privacy tests can assert exactly what
 * would reach Stripe), and lets a test move a subscription between states the
 * way Stripe would. Webhook signatures are not faked: tests sign payloads with
 * Stripe's own `generateTestHeaderString` (`signStripeTestPayload`).
 */

export type FakeStripeCall = {
  method: string;
  params: unknown;
  options?: unknown;
};

export type FakeSubscriptionState = {
  id: string;
  customer: string;
  status: string;
  priceId: string;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: number | null;
  created: number;
  metadata: Record<string, string>;
};

export type FakeStripe = {
  client: Omit<StripeClientLike, "webhooks">;
  calls: FakeStripeCall[];
  customers: Map<string, { id: string; email: string; metadata: Record<string, string> }>;
  subscriptions: Map<string, FakeSubscriptionState>;
  /** Simulates a completed Checkout: Stripe creates the subscription. */
  completeCheckout(input: {
    customer: string;
    priceId: string;
    status?: string;
    ref?: string;
    periodEnd?: Date;
    trialEnd?: Date | null;
  }): FakeSubscriptionState;
  /** Moves a subscription the way Stripe would (renewal failure, cancel, …). */
  update(id: string, changes: Partial<Omit<FakeSubscriptionState, "id" | "customer">>): void;
  /** Makes the next call to `method` fail with a Stripe-style error code. */
  failNext(method: string, code: string): void;
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}_test_${(++counter).toString().padStart(6, "0")}`;

function subscriptionObject(state: FakeSubscriptionState) {
  return {
    id: state.id,
    object: "subscription",
    customer: state.customer,
    status: state.status,
    cancel_at_period_end: state.cancelAtPeriodEnd,
    trial_end: state.trialEnd,
    created: state.created,
    metadata: state.metadata,
    items: {
      data: [{ price: { id: state.priceId }, current_period_end: state.currentPeriodEnd }],
    },
  };
}

export function createFakeStripe(
  prices: Record<string, { unitAmount: number; interval: "month" | "year" }> = {},
): FakeStripe {
  const calls: FakeStripeCall[] = [];
  const customers: FakeStripe["customers"] = new Map();
  const subscriptions: FakeStripe["subscriptions"] = new Map();
  const failures = new Map<string, string>();
  const idempotent = new Map<string, unknown>();

  const record = (method: string, params: unknown, options?: unknown) => {
    calls.push({ method, params, ...(options === undefined ? {} : { options }) });
    const failure = failures.get(method);
    if (failure) {
      failures.delete(method);
      throw Object.assign(new Error(`fake stripe ${method} failed`), {
        type: "StripeInvalidRequestError",
        code: failure,
      });
    }
  };

  const missing = () =>
    Object.assign(new Error("No such object"), {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
    });

  const client: FakeStripe["client"] = {
    customers: {
      async create(params, options) {
        record("customers.create", params, options);
        const key = options?.idempotencyKey;
        if (key && idempotent.has(key)) return idempotent.get(key) as { id: string };
        const customer = {
          id: nextId("cus"),
          email: String(params.email ?? ""),
          metadata: { ...(params.metadata as Record<string, string>) },
        };
        customers.set(customer.id, customer);
        if (key) idempotent.set(key, { id: customer.id });
        return { id: customer.id };
      },
      async del(id) {
        record("customers.del", id);
        if (!customers.has(id)) throw missing();
        customers.delete(id);
        for (const sub of subscriptions.values()) {
          if (sub.customer === id && sub.status !== "canceled") sub.status = "canceled";
        }
        return { id, deleted: true };
      },
    },
    checkout: {
      sessions: {
        async create(params, options) {
          record("checkout.sessions.create", params, options);
          const id = nextId("cs");
          return { id, url: `https://checkout.stripe.test/c/${id}` };
        },
      },
    },
    billingPortal: {
      sessions: {
        async create(params) {
          record("billingPortal.sessions.create", params);
          return { url: `https://billing.stripe.test/p/${nextId("bps")}` };
        },
      },
    },
    subscriptions: {
      async list(params) {
        record("subscriptions.list", params);
        const data = [...subscriptions.values()]
          .filter((sub) => sub.customer === params.customer)
          .sort((a, b) => b.created - a.created)
          .map(subscriptionObject);
        return { data } as never;
      },
      async cancel(id, params) {
        record("subscriptions.cancel", { id, ...params });
        const sub = subscriptions.get(id);
        if (!sub) throw missing();
        sub.status = "canceled";
        return subscriptionObject(sub);
      },
    },
    prices: {
      async retrieve(id) {
        record("prices.retrieve", id);
        const price = prices[id];
        if (!price) throw missing();
        return {
          id,
          unit_amount: price.unitAmount,
          currency: "eur",
          recurring: { interval: price.interval },
        } as never;
      },
    },
  };

  return {
    client,
    calls,
    customers,
    subscriptions,
    completeCheckout({ customer, priceId, status = "active", ref, periodEnd, trialEnd = null }) {
      const created = Math.floor(Date.now() / 1000) + counter;
      const state: FakeSubscriptionState = {
        id: nextId("sub"),
        customer,
        status,
        priceId,
        currentPeriodEnd: Math.floor(
          (periodEnd ?? new Date(Date.now() + 30 * 86_400_000)).getTime() / 1000,
        ),
        cancelAtPeriodEnd: false,
        trialEnd: trialEnd ? Math.floor(trialEnd.getTime() / 1000) : null,
        created,
        metadata: ref ? { ov_ref: ref } : {},
      };
      subscriptions.set(state.id, state);
      return state;
    },
    update(id, changes) {
      const sub = subscriptions.get(id);
      if (!sub) throw new Error("unknown fake subscription");
      Object.assign(sub, changes);
    },
    failNext(method, code) {
      failures.set(method, code);
    },
  };
}

/** A Stripe event envelope as the webhook endpoint receives it. */
export function stripeEventPayload(input: {
  id: string;
  type: string;
  object: Record<string, unknown>;
  created?: number;
}): string {
  return JSON.stringify({
    id: input.id,
    object: "event",
    api_version: "2026-09-30.endive",
    created: input.created ?? Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: input.type,
    data: { object: input.object },
  });
}
