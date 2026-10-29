/**
 * The narrow payment-provider port the billing service uses (Issue #297).
 * `providers/stripe.ts` is the only implementation and the only module that
 * imports the Stripe SDK; tests use the in-memory fake in `testing.ts`.
 *
 * Privacy contract: the only identifiers ever sent are the account email
 * (required for invoices and receipts) and `ref`, an opaque random reference.
 * Checkout metadata may additionally carry an opaque acknowledgement record
 * reference; it never contains legal wording, version, workspace or health data.
 */

/** Stable metadata key carrying the existing opaque owner reference. */
export const METADATA_REF_KEY = "ov_ref";

/** Stripe metadata for an opaque reference. Nothing else, ever. */
export function metadataFor(ref: string, acceptanceReference?: string): Record<string, string> {
  return {
    [METADATA_REF_KEY]: ref,
    ...(acceptanceReference ? { acceptance_reference: acceptanceReference } : {}),
  };
}

/** What a verified webhook carries that billing needs; never the raw payload. */
export type ProviderEvent = {
  id: string;
  type: string;
  /** Stripe customer the event is about, when it names one. */
  customerId: string | null;
  /** The opaque reference from `client_reference_id` or `metadata.ov_ref`. */
  ref: string | null;
};

/** The parts of a Stripe subscription billing keeps. */
export type ProviderSubscription = {
  id: string;
  customerId: string;
  /** Raw Stripe status (`active`, `past_due`, `canceled`, …). */
  status: string;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
  created: Date;
};

export type ProviderPrice = {
  id: string;
  /** Minor units (cents), tax included for the OpenValens prices. */
  unitAmount: number | null;
  currency: string;
  interval: "month" | "year" | null;
};

export type CheckoutSessionInput = {
  customerId: string;
  ref: string;
  acceptanceReference: string;
  priceId: string;
  /** Keep the rest of a running trial: first charge at this time. */
  trialEnd: Date | null;
  successUrl: string;
  cancelUrl: string;
  locale: "en" | "pt";
  idempotencyKey: string;
};

export type PortalSessionInput = {
  customerId: string;
  returnUrl: string;
  locale: "en" | "pt";
};

/** A webhook whose signature or timestamp did not verify. */
export class WebhookSignatureError extends Error {
  readonly code = "WEBHOOK_SIGNATURE_INVALID";
  constructor() {
    super("Webhook signature verification failed.");
    this.name = "WebhookSignatureError";
  }
}

/** A provider call failed. Carries a value-free code only, never a message. */
export class BillingProviderError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`Billing provider request failed (${code}).`);
    this.name = "BillingProviderError";
    this.code = code;
  }
}

export interface BillingProvider {
  /** Verifies the signature over the exact raw body and returns the event. */
  verifyWebhook(rawBody: Uint8Array, signature: string | null): Promise<ProviderEvent>;
  createCustomer(input: { email: string; ref: string; idempotencyKey: string }): Promise<{
    id: string;
  }>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ id?: string; url: string }>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
  /** Every subscription of a customer, any status (newest first). */
  listSubscriptions(customerId: string): Promise<ProviderSubscription[]>;
  /** Ends a subscription now, without proration or a final invoice. Missing is fine. */
  cancelSubscription(subscriptionId: string): Promise<void>;
  /** Deletes the customer (which also cancels anything left). Missing is fine. */
  deleteCustomer(customerId: string): Promise<void>;
  retrievePrice(priceId: string): Promise<ProviderPrice>;
}
