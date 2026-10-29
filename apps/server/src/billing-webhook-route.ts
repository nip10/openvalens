import type { BillingService } from "@openvalens/billing";
import type { StructuredLogger } from "@openvalens/observability";
import type { Hono } from "hono";

/** Stripe webhook endpoint (Issue #297). Caddy sends `/api/*` to the server. */
export const BILLING_WEBHOOK_PATH = "/api/billing/webhook";

/**
 * Issue #297 — `POST /api/billing/webhook`, mounted only in Cloud
 * (`DEPLOYMENT_MODE=cloud`); on self-host the path does not exist.
 *
 * Plain Hono, not oRPC: Stripe is the caller, so the `Stripe-Signature` header
 * is the authentication (no session, no CSRF). The signature covers the exact
 * bytes Stripe sent, so the body is read once as raw bytes and never parsed
 * or re-serialized before verification. The global body-size limit
 * (`body-limit.ts`, 1 MiB by default) runs first and re-emits the same bytes;
 * Stripe event payloads are far smaller.
 *
 * Responses: 400 for a bad signature (Stripe does not retry those usefully,
 * and it tells the operator the secret is wrong), 500 when applying failed
 * (nothing was recorded, so Stripe's retry applies it), otherwise 200 — also
 * for duplicates and event types billing does not use.
 */
export function registerBillingWebhookRoute(
  app: Hono,
  options: {
    enabled: boolean;
    getService: () => Promise<BillingService | null>;
    logger: StructuredLogger;
  },
): void {
  if (!options.enabled) return;
  app.post(BILLING_WEBHOOK_PATH, async (c) => {
    const correlationId = c.get("correlationId");
    const service = await options.getService();
    if (!service) return c.json({ error: "NOT_FOUND" }, 404);
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    try {
      const result = await service.handleWebhook({
        rawBody,
        signature: c.req.header("stripe-signature") ?? null,
      });
      if (result.status === 400) return c.json({ error: "INVALID_SIGNATURE" }, 400);
      return c.json({ received: true }, 200);
    } catch (error) {
      // Value-free: the logger serializes errors to `{ name, code? }`.
      options.logger.error("billing.webhook.failed", { correlationId, error });
      return c.json({ error: "INTERNAL" }, 500);
    }
  });
}
