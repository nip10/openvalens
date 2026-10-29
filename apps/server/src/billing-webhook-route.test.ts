import { describe, expect, test } from "bun:test";

import type { BillingService } from "@openvalens/billing";
import { createStripeProvider, signStripeTestPayload } from "@openvalens/billing/providers/stripe";
import { createFakeStripe, stripeEventPayload } from "@openvalens/billing/testing";
import { correlationMiddleware, createStructuredLogger } from "@openvalens/observability";
import { Hono } from "hono";

import { BILLING_WEBHOOK_PATH, registerBillingWebhookRoute } from "./billing-webhook-route";
import { bodyLimitMiddleware, DEFAULT_MAX_BODY_BYTES } from "./body-limit";

/**
 * Issue #297 — the Stripe webhook route behind the real body-size limit: the
 * raw bytes Stripe signed reach signature verification unchanged, and the
 * route only exists in Cloud.
 */

const SECRET = "whsec_test_route";
const silent = createStructuredLogger({ level: "error", sink: () => {} });

function appWith(service: Partial<BillingService> | null, enabled = true) {
  const app = new Hono();
  app.use(correlationMiddleware());
  app.use(bodyLimitMiddleware({ maxBytes: DEFAULT_MAX_BODY_BYTES, logger: silent }));
  registerBillingWebhookRoute(app, {
    enabled,
    getService: async () => service as BillingService | null,
    logger: silent,
  });
  app.post("/*", (c) => c.json({ fallthrough: true }, 404));
  return app;
}

/** A billing service whose webhook handling is the real Stripe verification. */
function verifyingService(seen: { ids: string[] }): Partial<BillingService> {
  const provider = createStripeProvider({
    secretKey: "sk_test_route",
    webhookSecret: SECRET,
    client: createFakeStripe().client,
  });
  return {
    async handleWebhook({ rawBody, signature }) {
      try {
        const event = await provider.verifyWebhook(rawBody, signature);
        seen.ids.push(event.id);
        return { status: 200, outcome: "applied" };
      } catch {
        return { status: 400, outcome: "invalid_signature" };
      }
    },
  };
}

const payload = stripeEventPayload({
  id: "evt_route_1",
  type: "invoice.paid",
  // Non-ASCII and odd spacing: any decode/re-encode or JSON round trip breaks it.
  object: { object: "invoice", customer: "cus_route", description: "Mensalidade · €  7,99" },
});

describe("POST /api/billing/webhook", () => {
  test("verifies Stripe's signature over the raw body through the body limit", async () => {
    const seen = { ids: [] as string[] };
    const response = await appWith(verifyingService(seen)).request(BILLING_WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "stripe-signature": await signStripeTestPayload(payload, SECRET),
      },
      body: new TextEncoder().encode(payload),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(seen.ids).toEqual(["evt_route_1"]);
  });

  test("a chunked body (no Content-Length) still verifies", async () => {
    const seen = { ids: [] as string[] };
    const bytes = new TextEncoder().encode(payload);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 17));
        controller.enqueue(bytes.slice(17));
        controller.close();
      },
    });
    const response = await appWith(verifyingService(seen)).request(BILLING_WEBHOOK_PATH, {
      method: "POST",
      headers: { "stripe-signature": await signStripeTestPayload(payload, SECRET) },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(200);
    expect(seen.ids).toEqual(["evt_route_1"]);
  });

  test("a missing or wrong signature is a 400", async () => {
    const app = appWith(verifyingService({ ids: [] }));
    const unsigned = await app.request(BILLING_WEBHOOK_PATH, { method: "POST", body: payload });
    expect(unsigned.status).toBe(400);
    const wrong = await app.request(BILLING_WEBHOOK_PATH, {
      method: "POST",
      headers: { "stripe-signature": await signStripeTestPayload(payload, "whsec_other") },
      body: payload,
    });
    expect(wrong.status).toBe(400);
  });

  test("a failure while applying is a 500 so Stripe retries", async () => {
    const app = appWith({
      handleWebhook: async () => {
        throw new Error("database down");
      },
    });
    const response = await app.request(BILLING_WEBHOOK_PATH, { method: "POST", body: payload });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("database down");
  });

  test("an oversized body is refused before verification", async () => {
    let called = false;
    const app = appWith({
      handleWebhook: async () => {
        called = true;
        return { status: 200, outcome: "applied" };
      },
    });
    const response = await app.request(BILLING_WEBHOOK_PATH, {
      method: "POST",
      body: "x".repeat(DEFAULT_MAX_BODY_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(called).toBe(false);
  });

  test("self-host: the route does not exist", async () => {
    const response = await appWith(verifyingService({ ids: [] }), false).request(
      BILLING_WEBHOOK_PATH,
      { method: "POST", body: payload },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ fallthrough: true });
  });
});
