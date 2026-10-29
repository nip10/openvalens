import Stripe from "stripe";

import {
  BillingProviderError,
  METADATA_REF_KEY,
  metadataFor,
  WebhookSignatureError,
  type BillingProvider,
  type CheckoutSessionInput,
  type ProviderEvent,
  type ProviderPrice,
  type ProviderSubscription,
} from "../provider";

/**
 * Stripe adapter (Issue #297) — the only module that imports the Stripe SDK
 * (`.oxlintrc.json`: vendor SDKs live under `packages/*\/src/providers/*`).
 *
 * What Stripe receives:
 * - customer: the account email and `metadata.ov_ref` (opaque reference);
 * - Checkout: that customer, `client_reference_id` = the same reference,
 *   the price, `subscription_data.metadata.ov_ref` and opaque acceptance reference,
 *   automatic tax, the
 *   return URLs and the interface language. Never a name, a workspace name or
 *   any health data.
 *
 * Prices are tax-inclusive (`tax_behavior: inclusive`, set on the Price in the
 * Stripe Dashboard) and Stripe Tax computes each EU country's VAT, so the
 * person pays exactly €7.99 or €69 wherever they live.
 */

/** Builds the customer-create parameters. Exported for the privacy tests. */
export function customerCreateParams(input: { email: string; ref: string }) {
  return {
    email: input.email,
    metadata: metadataFor(input.ref),
  } satisfies Stripe.CustomerCreateParams;
}

/** The business name shown on Checkout. */
export const CHECKOUT_DISPLAY_NAME = "OpenValens";

/** Builds the Checkout Session parameters. Exported for the privacy tests. */
export function checkoutSessionParams(input: CheckoutSessionInput) {
  // Checkout only accepts a trial end at least 48 hours away; closer than
  // that, the subscription simply starts now.
  const minimumTrialEnd = Date.now() + 48 * 60 * 60 * 1000 + 60_000;
  const trialEnd =
    input.trialEnd && input.trialEnd.getTime() > minimumTrialEnd
      ? Math.floor(input.trialEnd.getTime() / 1000)
      : null;
  return {
    mode: "subscription",
    customer: input.customerId,
    client_reference_id: input.ref,
    line_items: [{ price: input.priceId, quantity: 1 }],
    subscription_data: {
      metadata: metadataFor(input.ref, input.acceptanceReference),
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
    metadata: metadataFor(input.ref, input.acceptanceReference),
    // EU VAT through Stripe Tax; the address Checkout collects for tax is
    // saved on the customer.
    automatic_tax: { enabled: true },
    customer_update: { address: "auto" },
    tax_id_collection: { enabled: false },
    allow_promotion_codes: false,
    // The name Checkout shows, also when the Stripe account's own name differs.
    branding_settings: { display_name: CHECKOUT_DISPLAY_NAME },
    locale: input.locale,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  } satisfies Stripe.Checkout.SessionCreateParams;
}

/** The structural slice of the Stripe client this adapter uses (mockable). */
export type StripeClientLike = {
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options?: Stripe.RequestOptions,
    ): Promise<{ id: string }>;
    del(id: string): Promise<unknown>;
  };
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options?: Stripe.RequestOptions,
      ): Promise<{ id: string; url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }>;
    };
  };
  subscriptions: {
    list(params: Stripe.SubscriptionListParams): Promise<{ data: Stripe.Subscription[] }>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): Promise<unknown>;
  };
  prices: {
    retrieve(id: string): Promise<Stripe.Price>;
  };
  webhooks: {
    constructEventAsync(payload: Uint8Array, header: string, secret: string): Promise<Stripe.Event>;
  };
};

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function dateFromUnix(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null;
}

/** The value-free Stripe error code, never the message (which may echo input). */
function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, type } = error as { code?: unknown; type?: unknown };
    if (typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code)) return code;
    if (typeof type === "string" && /^[A-Za-z0-9_]{1,64}$/.test(type)) return type;
  }
  return "unknown";
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw new BillingProviderError(errorCode(error));
  }
}

/** Runs `fn`, treating "no such object" as done (idempotent deletes). */
async function ignoreMissing(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (errorCode(error) === "resource_missing") return;
    throw new BillingProviderError(errorCode(error));
  }
}

export function toProviderSubscription(subscription: Stripe.Subscription): ProviderSubscription {
  const item = subscription.items?.data?.[0];
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer) ?? "",
    status: subscription.status,
    priceId: item?.price?.id ?? null,
    // Since API 2025-03-31 the billing period lives on the subscription item.
    currentPeriodEnd: dateFromUnix(
      (item as { current_period_end?: unknown } | undefined)?.current_period_end ??
        (subscription as unknown as { current_period_end?: unknown }).current_period_end,
    ),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    trialEnd: dateFromUnix(subscription.trial_end),
    created: dateFromUnix(subscription.created) ?? new Date(0),
  };
}

/** Picks the event's customer and opaque reference; drops everything else. */
export function toProviderEvent(event: Stripe.Event): ProviderEvent {
  const object = (event.data?.object ?? {}) as unknown as Record<string, unknown>;
  const customerId = object.object === "customer" ? idOf(object.id) : idOf(object.customer);
  const metadata = object.metadata as Record<string, unknown> | null | undefined;
  const fromMetadata = metadata?.[METADATA_REF_KEY];
  const ref =
    typeof object.client_reference_id === "string"
      ? object.client_reference_id
      : typeof fromMetadata === "string"
        ? fromMetadata
        : null;
  return { id: event.id, type: event.type, customerId, ref };
}

export function createStripeProvider(options: {
  secretKey: string;
  webhookSecret: string;
  /** Customer Portal configuration (`bpc_`); `null` uses the account default. */
  portalConfiguration?: string | null;
  /**
   * Injected in tests (a mocked Stripe API); defaults to the real SDK client.
   * Webhook signatures are always verified by the real SDK.
   */
  client?: Omit<StripeClientLike, "webhooks">;
}): BillingProvider {
  // Constructing the client makes no network request.
  const sdk = new Stripe(options.secretKey, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "OpenValens" },
  });
  const client = options.client ?? (sdk as unknown as StripeClientLike);
  const webhooks: StripeClientLike["webhooks"] = sdk.webhooks;

  return {
    async verifyWebhook(rawBody, signature) {
      if (!signature) throw new WebhookSignatureError();
      let event: Stripe.Event;
      try {
        event = await webhooks.constructEventAsync(rawBody, signature, options.webhookSecret);
      } catch {
        throw new WebhookSignatureError();
      }
      return toProviderEvent(event);
    },

    createCustomer: ({ email, ref, idempotencyKey }) =>
      call(async () => {
        const customer = await client.customers.create(customerCreateParams({ email, ref }), {
          idempotencyKey,
        });
        return { id: customer.id };
      }),

    createCheckoutSession: (input) =>
      call(async () => {
        const session = await client.checkout.sessions.create(checkoutSessionParams(input), {
          idempotencyKey: input.idempotencyKey,
        });
        if (!session.url) throw new BillingProviderError("checkout_url_missing");
        return { id: session.id, url: session.url };
      }),

    createPortalSession: ({ customerId, returnUrl, locale }) =>
      call(async () => {
        const session = await client.billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
          locale,
          ...(options.portalConfiguration ? { configuration: options.portalConfiguration } : {}),
        });
        return { url: session.url };
      }),

    listSubscriptions: (customerId) =>
      call(async () => {
        const list = await client.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 20,
        });
        return list.data
          .map(toProviderSubscription)
          .sort((a, b) => b.created.getTime() - a.created.getTime());
      }),

    cancelSubscription: (subscriptionId) =>
      ignoreMissing(() =>
        client.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false }),
      ),

    deleteCustomer: (customerId) => ignoreMissing(() => client.customers.del(customerId)),

    retrievePrice: (priceId) =>
      call(async (): Promise<ProviderPrice> => {
        const price = await client.prices.retrieve(priceId);
        const interval: string | undefined = price.recurring?.interval;
        return {
          id: price.id,
          unitAmount: typeof price.unit_amount === "number" ? price.unit_amount : null,
          currency: price.currency,
          interval: interval === "month" || interval === "year" ? interval : null,
        };
      }),
  };
}

/**
 * Signs a payload the way Stripe does, with Stripe's own test helper
 * (`generateTestHeaderString`). For tests only: lets suites outside this
 * folder exercise real signature verification without importing the SDK.
 */
export function signStripeTestPayload(payload: string, secret: string): Promise<string> {
  return new Stripe("sk_test_signing_only").webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
  });
}
