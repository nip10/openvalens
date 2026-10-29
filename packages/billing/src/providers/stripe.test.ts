import { describe, expect, test } from "bun:test";
import Stripe from "stripe";

import { BillingProviderError, METADATA_REF_KEY, WebhookSignatureError } from "../provider";
import { createFakeStripe, stripeEventPayload } from "../testing";
import {
  checkoutSessionParams,
  createStripeProvider,
  customerCreateParams,
  signStripeTestPayload,
  toProviderEvent,
} from "./stripe";

const SECRET = "whsec_test_synthetic_secret";
const REF = "ovc_0123456789abcdef0123456789abcdef";
const encode = (text: string) => new TextEncoder().encode(text);

/**
 * Every metadata object in a request, at any depth. The privacy rule is that
 * Stripe metadata holds exactly `{ ov_ref }` and nothing else.
 */
function metadataObjects(value: unknown, found: Record<string, unknown>[] = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === "metadata" && child && typeof child === "object") {
      found.push(child as Record<string, unknown>);
    }
    metadataObjects(child, found);
  }
  return found;
}

/** Every string value in a request, at any depth. */
function strings(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, found);
  return found;
}

describe("what Stripe receives (no PHI, metadata references are opaque)", () => {
  const checkout = checkoutSessionParams({
    customerId: "cus_test_1",
    ref: REF,
    acceptanceReference: "11111111-1111-4111-8111-111111111111",
    priceId: "price_monthly",
    trialEnd: new Date(Date.now() + 10 * 86_400_000),
    successUrl: "https://app.test/settings/billing?checkout=success",
    cancelUrl: "https://app.test/settings/billing?checkout=cancelled",
    locale: "pt",
    idempotencyKey: "k",
  });
  const customer = customerCreateParams({ email: "alex.morgan@example.com", ref: REF });

  test("customer has only ov_ref; checkout adds only the opaque acceptance reference", () => {
    const metadata = [...metadataObjects(checkout), ...metadataObjects(customer)];
    expect(metadata.length).toBe(3);
    for (const entry of metadata) {
      expect(Object.keys(entry).sort()).toEqual(
        (entry.acceptance_reference
          ? [METADATA_REF_KEY, "acceptance_reference"]
          : [METADATA_REF_KEY]
        ).sort(),
      );
      expect(entry[METADATA_REF_KEY]).toBe(REF);
      if (entry.acceptance_reference)
        expect(entry.acceptance_reference).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  test("the customer carries only the email and the reference", () => {
    expect(Object.keys(customer).sort()).toEqual(["email", "metadata"]);
    expect(customer).not.toHaveProperty("name");
    expect(customer).not.toHaveProperty("description");
    expect(customer).not.toHaveProperty("phone");
  });

  test("Checkout carries no name, description or free text", () => {
    expect(Object.keys(checkout).sort()).toEqual(
      [
        "allow_promotion_codes",
        "automatic_tax",
        "cancel_url",
        "client_reference_id",
        "customer",
        "customer_update",
        "line_items",
        "locale",
        "metadata",
        "mode",
        "subscription_data",
        "success_url",
        "tax_id_collection",
      ].sort(),
    );
    expect(Object.keys(checkout.subscription_data).sort()).toEqual(["metadata", "trial_end"]);
    // Only ids, the reference, the fixed URLs and enum-like settings.
    const allowed = new Set([
      "subscription",
      "cus_test_1",
      REF,
      "11111111-1111-4111-8111-111111111111",
      "price_monthly",
      "auto",
      "pt",
      "https://app.test/settings/billing?checkout=success",
      "https://app.test/settings/billing?checkout=cancelled",
    ]);
    for (const value of strings(checkout)) expect(allowed.has(value)).toBe(true);
  });

  test("tax is automatic (Stripe Tax applies each EU country's VAT)", () => {
    expect(checkout.automatic_tax).toEqual({ enabled: true });
    expect(checkout.customer_update).toEqual({ address: "auto" });
  });

  test("a running trial carries over; under 48 hours left it does not", () => {
    expect(typeof checkout.subscription_data.trial_end).toBe("number");
    const late = checkoutSessionParams({
      customerId: "cus_test_1",
      ref: REF,
      acceptanceReference: "11111111-1111-4111-8111-111111111111",
      priceId: "price_monthly",
      trialEnd: new Date(Date.now() + 24 * 3600_000),
      successUrl: "https://app.test/s",
      cancelUrl: "https://app.test/c",
      locale: "en",
      idempotencyKey: "k",
    });
    expect(late.subscription_data.metadata).toEqual({
      ov_ref: REF,
      acceptance_reference: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("requests made through the adapter respect the same rule", async () => {
    const fake = createFakeStripe();
    const provider = createStripeProvider({
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      client: fake.client,
    });
    const { id } = await provider.createCustomer({
      email: "alex.morgan@example.com",
      ref: REF,
      idempotencyKey: "ov-customer-x",
    });
    await provider.createCheckoutSession({
      customerId: id,
      ref: REF,
      acceptanceReference: "11111111-1111-4111-8111-111111111111",
      priceId: "price_annual",
      trialEnd: null,
      successUrl: "https://app.test/s",
      cancelUrl: "https://app.test/c",
      locale: "en",
      idempotencyKey: "k2",
    });
    for (const call of fake.calls) {
      for (const entry of metadataObjects(call.params)) {
        expect(Object.keys(entry).sort()).toEqual(
          (entry.acceptance_reference
            ? [METADATA_REF_KEY, "acceptance_reference"]
            : [METADATA_REF_KEY]
          ).sort(),
        );
        if (entry.acceptance_reference)
          expect(entry.acceptance_reference).toBe("11111111-1111-4111-8111-111111111111");
      }
    }
    const created = fake.calls.find((call) => call.method === "customers.create");
    expect(created?.options).toEqual({ idempotencyKey: "ov-customer-x" });
  });
});

describe("webhook signature verification (Stripe's own test signatures)", () => {
  const provider = createStripeProvider({
    secretKey: "sk_test_x",
    webhookSecret: SECRET,
    client: createFakeStripe().client,
  });
  const payload = stripeEventPayload({
    id: "evt_test_1",
    type: "customer.subscription.updated",
    object: { id: "sub_1", object: "subscription", customer: "cus_1", metadata: { ov_ref: REF } },
  });

  test("a correctly signed raw body verifies and yields only ids", async () => {
    const signature = await signStripeTestPayload(payload, SECRET);
    const event = await provider.verifyWebhook(encode(payload), signature);
    expect(event).toEqual({
      id: "evt_test_1",
      type: "customer.subscription.updated",
      customerId: "cus_1",
      ref: REF,
    });
  });

  test("a body changed after signing is refused", async () => {
    const signature = await signStripeTestPayload(payload, SECRET);
    const tampered = payload.replace("cus_1", "cus_2");
    await expect(provider.verifyWebhook(encode(tampered), signature)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  test("re-serialized JSON (not the raw bytes) is refused", async () => {
    const signature = await signStripeTestPayload(payload, SECRET);
    const reformatted = JSON.stringify(JSON.parse(payload), null, 2);
    await expect(provider.verifyWebhook(encode(reformatted), signature)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  test("another secret, a missing header or garbage is refused", async () => {
    const other = await signStripeTestPayload(payload, "whsec_other");
    await expect(provider.verifyWebhook(encode(payload), other)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(provider.verifyWebhook(encode(payload), null)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(provider.verifyWebhook(encode(payload), "t=1,v1=00")).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  test("an old signature (replay) is refused", async () => {
    const old = await new Stripe("sk_test_x").webhooks.generateTestHeaderStringAsync({
      payload,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    await expect(provider.verifyWebhook(encode(payload), old)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });
});

describe("event and error mapping", () => {
  test("Checkout events carry the reference in client_reference_id", () => {
    const event = toProviderEvent({
      id: "evt_2",
      type: "checkout.session.completed",
      data: { object: { object: "checkout.session", customer: "cus_9", client_reference_id: REF } },
    } as never);
    expect(event).toEqual({
      id: "evt_2",
      type: "checkout.session.completed",
      customerId: "cus_9",
      ref: REF,
    });
  });

  test("Stripe errors surface as a value-free code; missing objects are fine to delete", async () => {
    const fake = createFakeStripe();
    const provider = createStripeProvider({
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      client: fake.client,
    });
    await provider.deleteCustomer("cus_never_existed");
    await provider.cancelSubscription("sub_never_existed");
    fake.failNext("customers.create", "api_key_expired");
    const error = await provider
      .createCustomer({ email: "a@example.com", ref: REF, idempotencyKey: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BillingProviderError);
    expect((error as BillingProviderError).code).toBe("api_key_expired");
    expect((error as Error).message).not.toContain("a@example.com");
  });

  test("subscriptions map the billing period from the subscription item", async () => {
    const fake = createFakeStripe();
    const provider = createStripeProvider({
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      client: fake.client,
    });
    const periodEnd = new Date("2027-01-01T00:00:00Z");
    const sub = fake.completeCheckout({ customer: "cus_1", priceId: "price_m", periodEnd });
    const [listed] = await provider.listSubscriptions("cus_1");
    expect(listed).toMatchObject({
      id: sub.id,
      customerId: "cus_1",
      status: "active",
      priceId: "price_m",
      cancelAtPeriodEnd: false,
    });
    expect(listed!.currentPeriodEnd?.toISOString()).toBe(periodEnd.toISOString());
  });
});
