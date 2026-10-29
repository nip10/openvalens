import { sql, type Database, type DbTransaction } from "@openvalens/db";
import { renderBillingEmail, type BillingEmailKind, type EmailService } from "@openvalens/email";
import { isLocale, SOURCE_LOCALE, type Locale } from "@openvalens/i18n";
import type { StructuredLogger } from "@openvalens/observability";

import { planForPrice, type BillingConfig, type BillingPlan } from "./config";
import {
  BillingProviderError,
  WebhookSignatureError,
  type BillingProvider,
  type ProviderSubscription,
} from "./provider";
import {
  blocksNewCheckout,
  effectiveStatus,
  isSubscriptionStatus,
  localTrialStatus,
  statusFromStripe,
  trialDaysLeft,
  TRIAL_REMINDER_MS,
  type SubscriptionStatus,
} from "./status";
import { newCustomerRef } from "./trial";

/**
 * OpenValens Cloud billing (Issue #297). Built by the server only when
 * `DEPLOYMENT_MODE=cloud`; self-host never constructs it.
 *
 * - **Status** for Settings › Plan & billing on the web.
 * - **Checkout / portal**: a Stripe customer is created the first time the
 *   owner subscribes (the trial before that is local), then Stripe Checkout
 *   (monthly or annual) or the Customer Portal (card, invoices, cancel).
 * - **Webhooks**: verified over the raw body, recorded by event id in the same
 *   transaction that applies them (a duplicate is a no-op, a failure rolls
 *   back so Stripe retries). The state is never taken from the event payload:
 *   each event re-reads the customer's subscriptions from Stripe under a row
 *   lock, so events arriving out of order, late or twice all converge on
 *   Stripe's current state.
 * - **Scheduled job** (`/rpc/cron/billingRun`): "trial ends in 3 days" and
 *   "trial ended" emails (each claimed once), the Stripe side of account
 *   erasure, and pruning of old event ids.
 *
 * Logs carry event types, counts and value-free error codes only — never an
 * email, a Stripe id or anything about the person.
 */

export type BillingErrorCode =
  /** No subscription row and nothing to manage. */
  | "NO_CUSTOMER"
  /** Already on a plan: manage it in the portal instead of a second Checkout. */
  | "ALREADY_SUBSCRIBED"
  /** Stripe could not be reached or refused the request. */
  | "PROVIDER_UNAVAILABLE"
  | "NOT_FOUND";

export class BillingError extends Error {
  readonly code: BillingErrorCode;
  constructor(code: BillingErrorCode) {
    super(`Billing request failed (${code}).`);
    this.name = "BillingError";
    this.code = code;
  }
}

export type BillingPriceView = {
  /** Minor units, VAT included. */
  amount: number;
  currency: string;
};

export type BillingStatusView = {
  /** `none`: this person has no subscription row (they never owned a Cloud trial). */
  status: SubscriptionStatus | "none";
  plan: BillingPlan | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Checkout may start (no live Stripe subscription). */
  canSubscribe: boolean;
  /** The Customer Portal is available (a Stripe customer exists). */
  canManage: boolean;
  prices: Record<BillingPlan, BillingPriceView | null>;
};

export type WebhookResult =
  | { status: 400; outcome: "invalid_signature" }
  | { status: 200; outcome: "applied" | "duplicate" | "ignored" | "unknown_customer" };

export type ScheduledRunResult = {
  trialRemindersSent: number;
  trialsEnded: number;
  trialEndedSent: number;
  emailsFailed: number;
  erasuresCompleted: number;
  erasuresFailed: number;
  eventsPruned: number;
};

export type BillingService = {
  getStatus(userId: string): Promise<BillingStatusView>;
  startCheckout(input: {
    userId: string;
    plan: BillingPlan;
    locale?: Locale;
  }): Promise<{ url: string }>;
  openPortal(input: { userId: string; locale?: Locale }): Promise<{ url: string }>;
  handleWebhook(input: { rawBody: Uint8Array; signature: string | null }): Promise<WebhookResult>;
  /** Cancels and deletes the Stripe customers of erased accounts (outbox). */
  processErasures(options?: { limit?: number }): Promise<{ completed: number; failed: number }>;
  runScheduled(options?: { limit?: number }): Promise<ScheduledRunResult>;
};

export type BillingServiceDeps = {
  db: Database;
  provider: BillingProvider;
  config: Pick<BillingConfig, "prices">;
  /** Web app origin (`CORS_ORIGIN`): Checkout and portal return here. */
  webOrigin: string;
  email: Pick<EmailService, "sendEmail" | "organizationName"> | null;
  /** The account's saved language; English when unknown. */
  localeForUser: (userId: string) => Promise<Locale>;
  logger: StructuredLogger;
  now?: () => Date;
};

/** Stripe events this service acts on; anything else is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

/** Processed event ids are kept this long (Stripe retries for up to 3 days). */
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** A "trial ended" email is not sent for trials that ended longer ago than this. */
const TRIAL_ENDED_EMAIL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PRICE_CACHE_MS = 60 * 60 * 1000;

type Row = {
  id: string;
  user_id: string;
  customer_ref: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  price_id: string | null;
  trial_ends_at: Date;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
};

const ROW_COLUMNS = sql.raw(
  `"id", "user_id", "customer_ref", "stripe_customer_id", "stripe_subscription_id", "status", "price_id", "trial_ends_at", "current_period_end", "cancel_at_period_end"`,
);

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toRow(raw: Record<string, unknown>): Row {
  const status = raw.status;
  return {
    id: String(raw.id),
    user_id: String(raw.user_id),
    customer_ref: String(raw.customer_ref),
    stripe_customer_id: (raw.stripe_customer_id as string | null) ?? null,
    stripe_subscription_id: (raw.stripe_subscription_id as string | null) ?? null,
    status: isSubscriptionStatus(status) ? status : "ended",
    price_id: (raw.price_id as string | null) ?? null,
    trial_ends_at: toDate(raw.trial_ends_at) ?? new Date(0),
    current_period_end: toDate(raw.current_period_end),
    cancel_at_period_end: raw.cancel_at_period_end === true,
  };
}

const statusInput = (row: Row) => ({
  status: row.status,
  trialEndsAt: row.trial_ends_at,
  stripeSubscriptionId: row.stripe_subscription_id,
});

/** Live Stripe statuses, preferred over ended ones when picking "the" subscription. */
const LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);

/**
 * The subscription that represents the customer's plan: the newest live one,
 * else the newest that ended. `incomplete` attempts never count.
 */
export function pickSubscription(
  subscriptions: readonly ProviderSubscription[],
): ProviderSubscription | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.created.getTime() - a.created.getTime());
  return (
    newestFirst.find((sub) => LIVE.has(sub.status)) ??
    newestFirst.find((sub) => statusFromStripe(sub.status) !== null) ??
    null
  );
}

export type DerivedState = {
  status: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date;
};

/** The row's next state from Stripe's current subscriptions (pure). */
export function deriveState(
  row: Pick<Row, "trial_ends_at">,
  subscriptions: readonly ProviderSubscription[],
  now: Date,
): DerivedState {
  const chosen = pickSubscription(subscriptions);
  const mapped = chosen ? statusFromStripe(chosen.status) : null;
  if (!chosen || !mapped) {
    return {
      status: localTrialStatus(row.trial_ends_at, now),
      stripeSubscriptionId: null,
      priceId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: row.trial_ends_at,
    };
  }
  return {
    status: mapped,
    stripeSubscriptionId: chosen.id,
    priceId: chosen.priceId,
    currentPeriodEnd: chosen.currentPeriodEnd,
    cancelAtPeriodEnd: chosen.cancelAtPeriodEnd,
    // A Stripe-side trial (subscribed during the free trial) ends when Stripe says.
    trialEndsAt: mapped === "trialing" && chosen.trialEnd ? chosen.trialEnd : row.trial_ends_at,
  };
}

function webUrl(origin: string, path: string): string {
  return `${new URL(origin).origin}${path}`;
}

function stripeLocale(locale: Locale | undefined): "en" | "pt" {
  return locale === "pt-PT" ? "pt" : "en";
}

export function createBillingService(deps: BillingServiceDeps): BillingService {
  const { db, provider, config, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const billingPath = "/settings/billing";
  const billingUrl = webUrl(deps.webOrigin, billingPath);

  const priceCache = new Map<string, { at: number; value: BillingPriceView | null }>();
  async function priceView(priceId: string): Promise<BillingPriceView | null> {
    const cached = priceCache.get(priceId);
    if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.value;
    try {
      const price = await provider.retrievePrice(priceId);
      const value =
        price.unitAmount === null ? null : { amount: price.unitAmount, currency: price.currency };
      priceCache.set(priceId, { at: Date.now(), value });
      return value;
    } catch (error) {
      logger.warn("billing.price.unavailable", { code: providerCode(error) });
      return null;
    }
  }

  async function readRow(
    executor: Pick<Database, "execute">,
    userId: string,
    lock = false,
  ): Promise<Row | null> {
    const result = await executor.execute(
      lock
        ? sql`select ${ROW_COLUMNS} from "subscription" where "user_id" = ${userId} for update`
        : sql`select ${ROW_COLUMNS} from "subscription" where "user_id" = ${userId}`,
    );
    const raw = result.rows[0] as Record<string, unknown> | undefined;
    return raw ? toRow(raw) : null;
  }

  async function sendBillingEmail(
    userId: string,
    kind: BillingEmailKind,
    extra: { trialEndsAt?: Date } = {},
  ): Promise<boolean> {
    if (!deps.email) return true;
    try {
      const found = await db.execute(sql`select "email" from "user" where "id" = ${userId}`);
      const address = (found.rows[0] as { email?: unknown } | undefined)?.email;
      if (typeof address !== "string" || !address) return true;
      let locale: Locale = SOURCE_LOCALE;
      try {
        const saved = await deps.localeForUser(userId);
        if (isLocale(saved)) locale = saved;
      } catch {
        locale = SOURCE_LOCALE;
      }
      const rendered = renderBillingEmail(
        { kind, billingUrl, ...extra },
        { locale, organizationName: deps.email.organizationName },
      );
      await deps.email.sendEmail({
        to: address,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateName: rendered.templateName,
        tags: [rendered.templateName],
      });
      return true;
    } catch (error) {
      logger.warn("billing.email.failed", { kind, code: providerCode(error) });
      return false;
    }
  }

  async function getStatus(userId: string): Promise<BillingStatusView> {
    const [row, monthly, annual] = await Promise.all([
      readRow(db, userId),
      priceView(config.prices.monthly),
      priceView(config.prices.annual),
    ]);
    const prices = { monthly, annual };
    if (!row) {
      return {
        status: "none",
        plan: null,
        trialEndsAt: null,
        trialDaysLeft: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canSubscribe: true,
        canManage: false,
        prices,
      };
    }
    const at = now();
    const status = effectiveStatus(statusInput(row), at);
    const trialing = status === "trialing";
    return {
      status,
      plan: planForPrice(config.prices, row.price_id),
      trialEndsAt: trialing ? row.trial_ends_at.toISOString() : null,
      trialDaysLeft: trialing ? trialDaysLeft(row.trial_ends_at, at) : null,
      currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      canSubscribe: !blocksNewCheckout(status, row.stripe_subscription_id !== null),
      canManage: row.stripe_customer_id !== null,
      prices,
    };
  }

  async function startCheckout(input: {
    userId: string;
    plan: BillingPlan;
    locale?: Locale;
  }): Promise<{ url: string }> {
    const priceId = config.prices[input.plan];
    const prepared = await db.transaction(async (tx) => {
      let row = await readRow(tx, input.userId, true);
      if (!row) {
        // An owner without a trial row (an account from before billing, or
        // one not created through Cloud sign-up): no new trial, straight to
        // a paid plan. Marked as already notified so no trial email follows.
        await tx.execute(
          sql`insert into "subscription" ("id", "user_id", "customer_ref", "status", "trial_ends_at", "trial_reminder_sent_at", "trial_ended_sent_at", "created_at", "updated_at")
            values (${crypto.randomUUID()}, ${input.userId}, ${newCustomerRef()}, 'ended', clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp(), clock_timestamp())
            on conflict ("user_id") do nothing`,
        );
        row = await readRow(tx, input.userId, true);
        if (!row) throw new BillingError("NOT_FOUND");
      }
      const status = effectiveStatus(statusInput(row), now());
      if (blocksNewCheckout(status, row.stripe_subscription_id !== null)) {
        throw new BillingError("ALREADY_SUBSCRIBED");
      }
      let customerId = row.stripe_customer_id;
      if (!customerId) {
        const found = await tx.execute(
          sql`select "email" from "user" where "id" = ${input.userId}`,
        );
        const address = (found.rows[0] as { email?: unknown } | undefined)?.email;
        if (typeof address !== "string" || !address) throw new BillingError("NOT_FOUND");
        // Stripe gets the email (receipts, invoices) and the opaque reference.
        const customer = await provider.createCustomer({
          email: address,
          ref: row.customer_ref,
          idempotencyKey: `ov-customer-${row.customer_ref}`,
        });
        customerId = customer.id;
        await tx.execute(
          sql`update "subscription" set "stripe_customer_id" = ${customerId}, "updated_at" = clock_timestamp() where "id" = ${row.id}`,
        );
      }
      return {
        customerId,
        ref: row.customer_ref,
        // Subscribing during the free trial keeps the rest of it: the first
        // charge is when the trial would have ended.
        trialEnd: status === "trialing" ? row.trial_ends_at : null,
      };
    });

    const session = await provider.createCheckoutSession({
      customerId: prepared.customerId,
      ref: prepared.ref,
      priceId,
      trialEnd: prepared.trialEnd,
      successUrl: `${billingUrl}?checkout=success`,
      cancelUrl: `${billingUrl}?checkout=cancelled`,
      locale: stripeLocale(input.locale),
      idempotencyKey: `ov-checkout-${crypto.randomUUID()}`,
    });
    logger.info("billing.checkout.started", { plan: input.plan });
    return session;
  }

  async function openPortal(input: { userId: string; locale?: Locale }): Promise<{ url: string }> {
    const row = await readRow(db, input.userId);
    if (!row?.stripe_customer_id) throw new BillingError("NO_CUSTOMER");
    return provider.createPortalSession({
      customerId: row.stripe_customer_id,
      returnUrl: billingUrl,
      locale: stripeLocale(input.locale),
    });
  }

  async function findRowForEvent(
    tx: DbTransaction,
    customerId: string | null,
    ref: string | null,
  ): Promise<Row | null> {
    if (customerId) {
      const byCustomer = await tx.execute(
        sql`select ${ROW_COLUMNS} from "subscription" where "stripe_customer_id" = ${customerId} for update`,
      );
      const raw = byCustomer.rows[0] as Record<string, unknown> | undefined;
      if (raw) return toRow(raw);
    }
    if (ref) {
      const byRef = await tx.execute(
        sql`select ${ROW_COLUMNS} from "subscription" where "customer_ref" = ${ref} for update`,
      );
      const raw = byRef.rows[0] as Record<string, unknown> | undefined;
      // Only adopt the customer when the row has none yet; never re-point it.
      if (raw) {
        const row = toRow(raw);
        if (!customerId || row.stripe_customer_id === null || row.stripe_customer_id === customerId)
          return row;
      }
    }
    return null;
  }

  async function handleWebhook(input: {
    rawBody: Uint8Array;
    signature: string | null;
  }): Promise<WebhookResult> {
    let event;
    try {
      event = await provider.verifyWebhook(input.rawBody, input.signature);
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        logger.warn("billing.webhook.rejected", { reason: "INVALID_SIGNATURE" });
        return { status: 400, outcome: "invalid_signature" };
      }
      throw error;
    }
    if (!HANDLED_EVENT_TYPES.has(event.type)) {
      return { status: 200, outcome: "ignored" };
    }

    type Applied = {
      outcome: "applied" | "duplicate" | "unknown_customer";
      userId?: string;
      emails: BillingEmailKind[];
    };
    const applied: Applied = await db.transaction(async (tx): Promise<Applied> => {
      const inserted = await tx.execute(
        sql`insert into "billing_webhook_event" ("id", "type") values (${event.id}, ${event.type}) on conflict ("id") do nothing returning "id"`,
      );
      if (inserted.rows.length === 0) return { outcome: "duplicate", emails: [] };

      const row = await findRowForEvent(tx, event.customerId, event.ref);
      if (!row) return { outcome: "unknown_customer", emails: [] };

      const customerId = row.stripe_customer_id ?? event.customerId;
      // Stripe's current truth, read under the row lock: event order and
      // payload age do not matter.
      const subscriptions = customerId ? await provider.listSubscriptions(customerId) : [];
      const at = now();
      const before = effectiveStatus(statusInput(row), at);
      const next = deriveState(row, subscriptions, at);

      await tx.execute(
        sql`update "subscription" set
          "stripe_customer_id" = ${customerId},
          "stripe_subscription_id" = ${next.stripeSubscriptionId},
          "status" = ${next.status},
          "price_id" = ${next.priceId},
          "trial_ends_at" = ${next.trialEndsAt.toISOString()},
          "current_period_end" = ${next.currentPeriodEnd?.toISOString() ?? null},
          "cancel_at_period_end" = ${next.cancelAtPeriodEnd},
          "updated_at" = clock_timestamp()
          where "id" = ${row.id}`,
      );

      const emails: BillingEmailKind[] = [];
      // One email per run of failures: Smart Retries send a failure event on
      // every retry, and the person was already told.
      if (event.type === "invoice.payment_failed" && before !== "past_due") {
        emails.push("payment_failed");
      }
      if (next.status === "canceled" && before !== "canceled") emails.push("subscription_canceled");
      return { outcome: "applied", userId: row.user_id, emails };
    });

    logger.info("billing.webhook.processed", { eventType: event.type, outcome: applied.outcome });
    if (applied.userId) {
      for (const kind of applied.emails) await sendBillingEmail(applied.userId, kind);
    }
    return { status: 200, outcome: applied.outcome };
  }

  async function processErasures(options: { limit?: number } = {}) {
    const limit = options.limit ?? 25;
    const pending = await db.execute(
      sql`select "stripe_customer_id" from "billing_customer_erasure" order by "created_at" limit ${limit}`,
    );
    let completed = 0;
    let failed = 0;
    for (const raw of pending.rows as { stripe_customer_id: string }[]) {
      const customerId = raw.stripe_customer_id;
      try {
        const done = await db.transaction(async (tx) => {
          const locked = await tx.execute(
            sql`select "stripe_subscription_id" from "billing_customer_erasure" where "stripe_customer_id" = ${customerId} for update skip locked`,
          );
          const entry = locked.rows[0] as { stripe_subscription_id: string | null } | undefined;
          if (!entry) return false;
          // Cancel now (no proration, no final invoice), then delete the
          // customer, which also ends anything else left on it. Finalized
          // invoices stay in the Stripe account: they are the operator's tax
          // records (see docs/billing.md).
          if (entry.stripe_subscription_id) {
            await provider.cancelSubscription(entry.stripe_subscription_id);
          }
          await provider.deleteCustomer(customerId);
          await tx.execute(
            sql`delete from "billing_customer_erasure" where "stripe_customer_id" = ${customerId}`,
          );
          return true;
        });
        if (done) completed += 1;
      } catch (error) {
        failed += 1;
        logger.warn("billing.erasure.failed", { code: providerCode(error) });
        await db.execute(
          sql`update "billing_customer_erasure" set "attempts" = "attempts" + 1, "last_attempt_at" = clock_timestamp() where "stripe_customer_id" = ${customerId}`,
        );
      }
    }
    if (completed > 0 || failed > 0)
      logger.info("billing.erasure.processed", { completed, failed });
    return { completed, failed };
  }

  async function runScheduled(options: { limit?: number } = {}): Promise<ScheduledRunResult> {
    const limit = options.limit ?? 100;
    const at = now();
    const atIso = at.toISOString();
    let emailsFailed = 0;

    // 1. "Your trial ends in 3 days": claimed once per row before sending.
    const reminders = await db.execute(
      sql`update "subscription" set "trial_reminder_sent_at" = ${atIso}
        where "id" in (
          select "id" from "subscription"
          where "status" = 'trialing' and "stripe_subscription_id" is null
            and "trial_reminder_sent_at" is null
            and "trial_ends_at" > ${atIso}
            and "trial_ends_at" <= ${new Date(at.getTime() + TRIAL_REMINDER_MS).toISOString()}
          order by "trial_ends_at" limit ${limit} for update skip locked)
        returning "id", "user_id", "trial_ends_at"`,
    );
    let trialRemindersSent = 0;
    for (const raw of reminders.rows as Record<string, unknown>[]) {
      const ok = await sendBillingEmail(String(raw.user_id), "trial_ending", {
        trialEndsAt: toDate(raw.trial_ends_at) ?? at,
      });
      if (ok) trialRemindersSent += 1;
      else {
        emailsFailed += 1;
        await db.execute(
          sql`update "subscription" set "trial_reminder_sent_at" = null where "id" = ${String(raw.id)}`,
        );
      }
    }

    // 2. Local trials that ran out become `ended`.
    const ended = await db.execute(
      sql`update "subscription" set "status" = 'ended', "updated_at" = clock_timestamp()
        where "status" = 'trialing' and "stripe_subscription_id" is null and "trial_ends_at" <= ${atIso}
        returning "id"`,
    );

    // 3. "Your trial has ended": claimed once, only for recent ends.
    const endedEmails = await db.execute(
      sql`update "subscription" set "trial_ended_sent_at" = ${atIso}
        where "id" in (
          select "id" from "subscription"
          where "status" = 'ended' and "stripe_subscription_id" is null
            and "trial_ended_sent_at" is null
            and "trial_ends_at" <= ${atIso}
            and "trial_ends_at" > ${new Date(at.getTime() - TRIAL_ENDED_EMAIL_WINDOW_MS).toISOString()}
          order by "trial_ends_at" limit ${limit} for update skip locked)
        returning "id", "user_id"`,
    );
    let trialEndedSent = 0;
    for (const raw of endedEmails.rows as Record<string, unknown>[]) {
      const ok = await sendBillingEmail(String(raw.user_id), "trial_ended");
      if (ok) trialEndedSent += 1;
      else {
        emailsFailed += 1;
        await db.execute(
          sql`update "subscription" set "trial_ended_sent_at" = null where "id" = ${String(raw.id)}`,
        );
      }
    }

    // 4. The Stripe side of account erasure.
    const erasures = await processErasures();

    // 5. Event ids older than the retention window.
    const pruned = await db.execute(
      sql`delete from "billing_webhook_event" where "processed_at" < ${new Date(at.getTime() - EVENT_RETENTION_MS).toISOString()} returning "id"`,
    );

    const result: ScheduledRunResult = {
      trialRemindersSent,
      trialsEnded: ended.rows.length,
      trialEndedSent,
      emailsFailed,
      erasuresCompleted: erasures.completed,
      erasuresFailed: erasures.failed,
      eventsPruned: pruned.rows.length,
    };
    logger.info("billing.scheduled.completed", result);
    return result;
  }

  return {
    getStatus,
    startCheckout: (input) => wrapProvider(() => startCheckout(input)),
    openPortal: (input) => wrapProvider(() => openPortal(input)),
    handleWebhook,
    processErasures,
    runScheduled,
  };
}

function providerCode(error: unknown): string {
  if (error instanceof BillingProviderError) return error.code;
  if (error instanceof BillingError) return error.code;
  return error instanceof Error ? error.name : "unknown";
}

async function wrapProvider<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BillingProviderError) throw new BillingError("PROVIDER_UNAVAILABLE");
    throw error;
  }
}
