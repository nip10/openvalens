import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { createPublicSignUpService, createSocialSignUpService } from "@openvalens/auth/admission";
import { createDb, sql, type Database } from "@openvalens/db";
import type { SendEmailInput } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import { METADATA_REF_KEY } from "./provider";
import { createStripeProvider, signStripeTestPayload } from "./providers/stripe";
import { BillingError, createBillingService, type BillingService } from "./service";
import { createFakeStripe, stripeEventPayload, type FakeStripe } from "./testing";
import { onCloudAccountCreated, startTrial } from "./trial";

/**
 * Issue #297 — subscription state transitions over a disposable PostgreSQL,
 * with the real Stripe adapter talking to an in-memory Stripe API and real
 * Stripe webhook signatures (`generateTestHeaderString`).
 *
 * Guarded by `BILLING_TEST_DATABASE_URL`, an *empty* loopback database named
 * `billing_test`; the full migration set is applied first.
 */

const url = process.env.BILLING_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/billing_test"
  ) {
    throw new Error("Empty disposable loopback billing_test database required.");
  }
}

const WEBHOOK_SECRET = "whsec_test_billing_integration";
const ACK = {
  acceptedImmediateStart: true as const,
  acceptedWithdrawalAcknowledgement: true as const,
  acknowledgementVersion: "checkout-v1",
};
const PRICES = { monthly: "price_test_monthly", annual: "price_test_annual" };
const DAY = 86_400_000;

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** Every string anywhere in a value. */
function strings(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) strings(v, found);
  return found;
}

function metadataObjects(value: unknown, found: Record<string, unknown>[] = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === "metadata" && child && typeof child === "object")
      found.push(child as Record<string, unknown>);
    metadataObjects(child, found);
  }
  return found;
}

describe.skipIf(!url)("billing against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/billing_test" });
  const logged: string[] = [];
  const logger = createStructuredLogger({
    level: "debug",
    sink: (_level, line) => void logged.push(line),
  });
  let clock = new Date();
  let fake: FakeStripe;
  let billing: BillingService;
  let sent: SendEmailInput[] = [];
  let failEmail = false;
  let eventSeq = 0;
  const allCalls: unknown[] = [];

  function build() {
    fake = createFakeStripe({
      [PRICES.monthly]: { unitAmount: 799, interval: "month" },
      [PRICES.annual]: { unitAmount: 6900, interval: "year" },
    });
    const provider = createStripeProvider({
      secretKey: "sk_test_integration",
      webhookSecret: WEBHOOK_SECRET,
      client: fake.client,
    });
    billing = createBillingService({
      db,
      provider,
      config: {
        prices: PRICES,
        termsUrl: "https://legal.test/terms",
        checkoutAcknowledgementVersion: "checkout-v1",
      },
      webOrigin: "https://app.openvalens.test",
      email: {
        organizationName: "OpenValens",
        sendEmail: async (input) => {
          if (failEmail) throw new Error("email down");
          sent.push(input);
          return { id: `msg-${sent.length}`, dryRun: false };
        },
      },
      localeForUser: async (userId) => {
        const found = await db.execute(
          sql`select "locale" from "user_preference" where "user_id" = ${userId}`,
        );
        return (found.rows[0] as { locale?: string } | undefined)?.locale === "pt-PT"
          ? "pt-PT"
          : "en";
      },
      logger,
      now: () => clock,
    });
  }

  async function createUser(email: string, locale?: "pt-PT"): Promise<string> {
    const id = crypto.randomUUID();
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned", "name", "created_at", "updated_at") values (${id}, ${email}, true, 'user', false, 'Synthetic Person', now(), now())`,
    );
    if (locale)
      await db.execute(
        sql`insert into "user_preference" ("user_id", "locale") values (${id}, ${locale})`,
      );
    return id;
  }

  async function row(userId: string) {
    const result = await db.execute(sql`select * from "subscription" where "user_id" = ${userId}`);
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  async function deliver(type: string, object: Record<string, unknown>, id?: string) {
    const payload = stripeEventPayload({ id: id ?? `evt_test_${++eventSeq}`, type, object });
    const signature = await signStripeTestPayload(payload, WEBHOOK_SECRET);
    return billing.handleWebhook({ rawBody: new TextEncoder().encode(payload), signature });
  }

  /** A trialing owner who went through Checkout; Stripe then created the subscription. */
  async function subscribedOwner(email: string, plan: "monthly" | "annual" = "monthly") {
    const userId = await createUser(email);
    await startTrial(db, { userId });
    await billing.startCheckout({ userId, plan, ...ACK });
    const customer = String((await row(userId))!.stripe_customer_id);
    const ref = String((await row(userId))!.customer_ref);
    const subscription = fake.completeCheckout({ customer, priceId: PRICES[plan], ref });
    await deliver("checkout.session.completed", {
      object: "checkout.session",
      customer,
      client_reference_id: ref,
      subscription: subscription.id,
    });
    return { userId, customer, ref, subscription };
  }

  beforeAll(async () => {
    await migrate(db);
  });

  beforeEach(() => {
    clock = new Date();
    sent = [];
    failEmail = false;
    if (fake) allCalls.push(...fake.calls);
    build();
  });

  afterAll(() => {
    allCalls.push(...fake.calls);
  });

  test("Cloud sign-up starts the trial in the account-creation transaction", async () => {
    const links: string[] = [];
    const signUp = (fail: boolean) =>
      createPublicSignUpService({
        db,
        deployment: {
          mode: "cloud",
          legal: {
            terms: { url: "https://legal.test/terms", version: "t-1" },
            privacy: { url: "https://legal.test/privacy", version: "p-1" },
            healthDataConsent: { url: "https://legal.test/privacy", version: "h-1" },
          },
        },
        verifyUrl: (token) => `https://app.test/verify?token=${token}`,
        deliver: async (input) => {
          if (input.kind === "new") links.push(input.url);
        },
        onAccountCreated: async (input) => {
          await onCloudAccountCreated(input);
          if (fail) throw new Error("later step failed");
        },
      });
    const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

    await signUp(false).signUpPublic({
      email: "new.cloud@example.com",
      acceptedLegal: true,
      acceptedHealthDataConsent: true,
      healthDataConsentVersion: "h-1",
    });
    const created = await signUp(false).completePublicSignUp(tokenOf(links.at(-1)!));
    expect(created.status).toBe("created");
    const userId = created.status === "created" ? created.userId : "";
    expect(await row(userId)).toMatchObject({ status: "trialing", stripe_customer_id: null });
    expect(fake.calls).toHaveLength(0);

    // A failure later in the hook rolls the account and its trial back together.
    await signUp(true).signUpPublic({
      email: "rolled.back@example.com",
      acceptedLegal: true,
      acceptedHealthDataConsent: true,
      healthDataConsentVersion: "h-1",
    });
    await expect(signUp(true).completePublicSignUp(tokenOf(links.at(-1)!))).rejects.toBeDefined();
    const left = await db.execute(
      sql`select count(*)::int as n from "subscription" s join "user" u on u."id" = s."user_id" where u."email" = 'rolled.back@example.com'`,
    );
    expect(left.rows).toEqual([{ n: 0 }]);
  });

  test("Google / Apple Cloud sign-up starts the same 30-day trial (#296)", async () => {
    const social = createSocialSignUpService({
      db,
      deployment: {
        mode: "cloud",
        legal: {
          terms: { url: "https://legal.test/terms", version: "t-1" },
          privacy: { url: "https://legal.test/privacy", version: "p-1" },
          healthDataConsent: { url: "https://legal.test/privacy", version: "h-1" },
        },
      },
      onAccountCreated: onCloudAccountCreated,
    });
    const created = await social.createAccount({
      providerId: "apple",
      accountId: "synthetic-apple-sub-trial",
      email: "relay.trial@privaterelay.appleid.com",
      emailVerified: true,
      name: "Synthetic Person",
      legal: {
        termsVersion: "t-1",
        privacyVersion: "p-1",
        acceptedAt: new Date(),
        healthDataConsentVersion: "h-1",
        healthDataConsentAcceptedAt: new Date(),
      },
    });
    expect(created.status).toBe("created");
    const userId = created.status === "created" ? created.userId : "";
    const subscription = (await row(userId))!;
    expect(subscription).toMatchObject({ status: "trialing", stripe_customer_id: null });
    const length = new Date(subscription.trial_ends_at as Date).getTime() - Date.now();
    expect(Math.abs(length - 30 * DAY)).toBeLessThan(60_000);
    expect(fake.calls).toHaveLength(0);
  });

  test("the trial starts locally at sign-up: 30 days, trialing, no Stripe customer", async () => {
    const userId = await createUser("trial.start@example.com");
    await startTrial(db, { userId });
    await startTrial(db, { userId }); // idempotent
    const created = (await row(userId))!;
    expect(created.status).toBe("trialing");
    expect(created.stripe_customer_id).toBeNull();
    expect(String(created.customer_ref)).toMatch(/^ovc_[0-9a-f]{32}$/);
    expect(String(created.customer_ref)).not.toContain(userId);
    const length = new Date(created.trial_ends_at as Date).getTime() - Date.now();
    expect(Math.abs(length - 30 * DAY)).toBeLessThan(60_000);

    const status = await billing.getStatus(userId);
    expect(status).toMatchObject({
      status: "trialing",
      trialDaysLeft: 30,
      canSubscribe: true,
      canManage: false,
      prices: {
        monthly: { amount: 799, currency: "eur" },
        annual: { amount: 6900, currency: "eur" },
      },
      checkoutAcknowledgement: { version: "checkout-v1", termsUrl: "https://legal.test/terms" },
    });
    expect(fake.calls.filter((c) => c.method === "customers.create")).toHaveLength(0);
  });

  test("Checkout creates the customer once (email + opaque ref) and keeps the rest of the trial", async () => {
    const userId = await createUser("checkout.once@example.com");
    await startTrial(db, { userId });
    const first = await billing.startCheckout({ userId, plan: "annual", locale: "pt-PT", ...ACK });
    const second = await billing.startCheckout({ userId, plan: "monthly", ...ACK });
    expect(first.url).toStartWith("https://checkout.stripe.test/");
    expect(second.url).toStartWith("https://checkout.stripe.test/");

    const creates = fake.calls.filter((c) => c.method === "customers.create");
    expect(creates).toHaveLength(1);
    const ref = String((await row(userId))!.customer_ref);
    expect(creates[0]!.params).toEqual({
      email: "checkout.once@example.com",
      metadata: { ov_ref: ref },
    });

    const sessions = fake.calls.filter((c) => c.method === "checkout.sessions.create");
    const params = sessions[0]!.params as Record<string, any>;
    expect(params.line_items).toEqual([{ price: PRICES.annual, quantity: 1 }]);
    expect(params.locale).toBe("pt");
    expect(params.client_reference_id).toBe(ref);
    expect(params.success_url).toBe(
      "https://app.openvalens.test/settings/billing?checkout=success",
    );
    // ~30 days of trial left: the first charge waits for the trial's end.
    expect(params.subscription_data.trial_end).toBe(
      Math.floor(new Date((await row(userId))!.trial_ends_at as Date).getTime() / 1000),
    );
    expect((await row(userId))!.status).toBe("trialing");
    const acknowledgement = await db.execute(sql`select id, version, immediate_start_requested,
      withdrawal_acknowledged, stripe_checkout_session_id from billing_checkout_acknowledgement
      where user_id=${userId}`);
    expect(acknowledgement.rows[0]).toMatchObject({
      version: "checkout-v1",
      immediate_start_requested: true,
      withdrawal_acknowledged: true,
    });
    expect(params.metadata.acceptance_reference).toBe(
      (acknowledgement.rows[0] as { id: string }).id,
    );
    expect(
      (acknowledgement.rows[0] as { stripe_checkout_session_id: string })
        .stripe_checkout_session_id,
    ).toStartWith("cs_test_");
  });

  test("direct service callers cannot bypass missing or stale acknowledgements before Stripe", async () => {
    const userId = await createUser("checkout.ack.required@example.com");
    await startTrial(db, { userId });
    await expect(billing.startCheckout({ userId, plan: "monthly" })).rejects.toMatchObject({
      code: "ACKNOWLEDGEMENT_REQUIRED",
    });
    await expect(
      billing.startCheckout({
        userId,
        plan: "monthly",
        acceptedImmediateStart: true,
        acceptedWithdrawalAcknowledgement: false,
        acknowledgementVersion: "checkout-v1",
      }),
    ).rejects.toMatchObject({ code: "ACKNOWLEDGEMENT_REQUIRED" });
    await expect(
      billing.startCheckout({
        userId,
        plan: "monthly",
        acceptedImmediateStart: true,
        acceptedWithdrawalAcknowledgement: true,
        acknowledgementVersion: "old-version",
      }),
    ).rejects.toMatchObject({ code: "ACKNOWLEDGEMENT_STALE" });
    expect(
      fake.calls.filter((call) =>
        ["customers.create", "checkout.sessions.create"].includes(call.method),
      ),
    ).toHaveLength(0);
    const records = await db.execute(
      sql`select id from billing_checkout_acknowledgement where user_id=${userId}`,
    );
    expect(records.rows).toHaveLength(0);
  });

  test("checkout.session.completed makes the owner active with plan and period", async () => {
    const { userId, subscription } = await subscribedOwner("active.after@example.com", "annual");
    const after = (await row(userId))!;
    expect(after.status).toBe("active");
    expect(after.stripe_subscription_id).toBe(subscription.id);
    expect(after.price_id).toBe(PRICES.annual);
    expect(after.current_period_end).not.toBeNull();
    const status = await billing.getStatus(userId);
    expect(status).toMatchObject({
      status: "active",
      plan: "annual",
      canSubscribe: false,
      canManage: true,
    });
    await expect(billing.startCheckout({ userId, plan: "monthly", ...ACK })).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
    });
    const portal = await billing.openPortal({ userId });
    expect(portal.url).toStartWith("https://billing.stripe.test/");
  });

  test("a duplicate event id is a no-op", async () => {
    const { userId, customer, subscription } = await subscribedOwner("dup@example.com");
    fake.update(subscription.id, { status: "past_due" });
    const object = { object: "invoice", customer };
    expect((await deliver("invoice.payment_failed", object, "evt_dup_1")).outcome).toBe("applied");
    expect(sent).toHaveLength(1);
    // Stripe redelivers the same event (and it would be stale anyway).
    fake.update(subscription.id, { status: "active" });
    expect((await deliver("invoice.payment_failed", object, "evt_dup_1")).outcome).toBe(
      "duplicate",
    );
    expect(sent).toHaveLength(1);
    expect((await row(userId))!.status).toBe("past_due");
  });

  test("out-of-order and stale events converge on Stripe's current state", async () => {
    const { userId, customer, subscription } = await subscribedOwner("order@example.com");
    // Stripe: the person cancelled; the `deleted` event arrives first.
    fake.update(subscription.id, { status: "canceled" });
    await deliver("customer.subscription.deleted", { object: "subscription", customer });
    expect((await row(userId))!.status).toBe("canceled");
    // An older `updated` (still saying "active") arrives late: no resurrection.
    await deliver("customer.subscription.updated", {
      object: "subscription",
      customer,
      status: "active",
    });
    // And the original `created` even later.
    await deliver("customer.subscription.created", {
      object: "subscription",
      customer,
      status: "active",
    });
    expect((await row(userId))!.status).toBe("canceled");
    expect(sent.filter((m) => m.templateName === "billing-subscription_canceled")).toHaveLength(1);
  });

  test("payment failed → past_due with an email; invoice.paid → active again", async () => {
    const { userId, customer, subscription } = await subscribedOwner("pastdue@example.com");
    fake.update(subscription.id, { status: "past_due" });
    await deliver("invoice.payment_failed", { object: "invoice", customer });
    expect((await row(userId))!.status).toBe("past_due");
    expect(sent.map((m) => m.templateName)).toEqual(["billing-payment_failed"]);
    expect(sent[0]!.to).toBe("pastdue@example.com");
    // Stripe's automatic retry fails again: no second email.
    await deliver("invoice.payment_failed", { object: "invoice", customer });
    expect(sent).toHaveLength(1);

    fake.update(subscription.id, { status: "active" });
    await deliver("invoice.paid", { object: "invoice", customer });
    expect((await row(userId))!.status).toBe("active");
    expect(sent).toHaveLength(1);
  });

  test("cancel at period end stays active; the end then cancels, with one email", async () => {
    const { userId, customer, subscription } = await subscribedOwner("atperiod@example.com");
    fake.update(subscription.id, { cancelAtPeriodEnd: true });
    await deliver("customer.subscription.updated", { object: "subscription", customer });
    expect(await row(userId)).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(sent).toHaveLength(0);
    fake.update(subscription.id, { status: "canceled" });
    await deliver("customer.subscription.deleted", { object: "subscription", customer });
    await deliver("customer.subscription.updated", { object: "subscription", customer });
    expect((await row(userId))!.status).toBe("canceled");
    expect(sent.map((m) => m.templateName)).toEqual(["billing-subscription_canceled"]);
    // A cancelled owner may subscribe again.
    expect((await billing.getStatus(userId)).canSubscribe).toBe(true);
  });

  test("a bad signature is refused and nothing is recorded", async () => {
    const payload = stripeEventPayload({
      id: "evt_forged",
      type: "invoice.paid",
      object: { object: "invoice", customer: "cus_x" },
    });
    const signature = await signStripeTestPayload(payload, "whsec_attacker");
    const result = await billing.handleWebhook({
      rawBody: new TextEncoder().encode(payload),
      signature,
    });
    expect(result).toEqual({ status: 400, outcome: "invalid_signature" });
    const recorded = await db.execute(
      sql`select 1 from "billing_webhook_event" where "id" = 'evt_forged'`,
    );
    expect(recorded.rows).toHaveLength(0);
  });

  test("unknown customers and unhandled event types are acknowledged", async () => {
    expect(
      (await deliver("invoice.paid", { object: "invoice", customer: "cus_unknown" })).outcome,
    ).toBe("unknown_customer");
    expect((await deliver("customer.created", { object: "customer", id: "cus_y" })).outcome).toBe(
      "ignored",
    );
  });

  test("a Stripe outage rolls the event back so Stripe's retry applies it", async () => {
    const { userId, customer, subscription } = await subscribedOwner("retry@example.com");
    fake.update(subscription.id, { status: "past_due" });
    fake.failNext("subscriptions.list", "rate_limit");
    await expect(
      deliver("invoice.payment_failed", { object: "invoice", customer }, "evt_retry_1"),
    ).rejects.toBeDefined();
    expect((await row(userId))!.status).toBe("active");
    expect(
      (await deliver("invoice.payment_failed", { object: "invoice", customer }, "evt_retry_1"))
        .outcome,
    ).toBe("applied");
    expect((await row(userId))!.status).toBe("past_due");
  });

  test("scheduled job: 3-day reminder once, then the trial ends with one email", async () => {
    const userId = await createUser("reminder@example.com", "pt-PT");
    await startTrial(db, { userId });
    const ends = new Date((await row(userId))!.trial_ends_at as Date);

    clock = new Date(ends.getTime() - 5 * DAY);
    expect((await billing.runScheduled()).trialRemindersSent).toBe(0);

    clock = new Date(ends.getTime() - 2 * DAY);
    const first = await billing.runScheduled();
    expect(first.trialRemindersSent).toBeGreaterThanOrEqual(1);
    const reminder = sent.find((m) => m.to === "reminder@example.com");
    expect(reminder?.templateName).toBe("billing-trial_ending");
    // pt-PT account: the email is in Portuguese.
    expect(reminder?.subject).not.toBe("Your OpenValens Cloud trial ends in 3 days");
    sent = [];
    await billing.runScheduled();
    expect(sent.filter((m) => m.to === "reminder@example.com")).toHaveLength(0);

    clock = new Date(ends.getTime() + 60_000);
    expect((await billing.getStatus(userId)).status).toBe("ended");
    await billing.runScheduled();
    await billing.runScheduled();
    expect((await row(userId))!.status).toBe("ended");
    expect(sent.filter((m) => m.to === "reminder@example.com").map((m) => m.templateName)).toEqual([
      "billing-trial_ended",
    ]);
  });

  test("a failed reminder email is retried on the next run", async () => {
    const userId = await createUser("retry.email@example.com");
    await startTrial(db, { userId, trialDays: 2 });
    failEmail = true;
    const failed = await billing.runScheduled();
    expect(failed.emailsFailed).toBeGreaterThanOrEqual(1);
    expect((await row(userId))!.trial_reminder_sent_at).toBeNull();
    failEmail = false;
    await billing.runScheduled();
    expect(sent.filter((m) => m.to === "retry.email@example.com")).toHaveLength(1);
  });

  test("subscribed during the trial: no trial emails, Stripe's trial end applies", async () => {
    const userId = await createUser("early@example.com");
    await startTrial(db, { userId });
    await billing.startCheckout({ userId, plan: "monthly", ...ACK });
    const { stripe_customer_id: customer, trial_ends_at } = (await row(userId))!;
    const trialEnd = new Date(trial_ends_at as Date);
    fake.completeCheckout({
      customer: String(customer),
      priceId: PRICES.monthly,
      status: "trialing",
      trialEnd,
    });
    await deliver("customer.subscription.created", {
      object: "subscription",
      customer: String(customer),
    });
    expect((await row(userId))!.status).toBe("trialing");
    clock = new Date(trialEnd.getTime() - DAY);
    await billing.runScheduled();
    clock = new Date(trialEnd.getTime() + DAY);
    await billing.runScheduled();
    expect(sent.filter((m) => m.to === "early@example.com")).toHaveLength(0);
    expect((await billing.getStatus(userId)).canSubscribe).toBe(false);
  });

  test("an owner without a trial row can still subscribe, with no trial", async () => {
    const userId = await createUser("no.row@example.com");
    expect((await billing.getStatus(userId)).status).toBe("none");
    await billing.startCheckout({ userId, plan: "monthly", ...ACK });
    expect((await row(userId))!.status).toBe("ended");
    const session = fake.calls.find((c) => c.method === "checkout.sessions.create");
    const acknowledgement = await db.execute(
      sql`select id from billing_checkout_acknowledgement where user_id=${userId}`,
    );
    expect((session!.params as any).subscription_data).toEqual({
      metadata: {
        ov_ref: String((await row(userId))!.customer_ref),
        acceptance_reference: (acknowledgement.rows[0] as { id: string }).id,
      },
    });
    await expect(
      billing.openPortal({ userId: await createUser("x@example.com") }),
    ).rejects.toBeInstanceOf(BillingError);
  });

  test("account deletion cancels the Stripe subscription now and deletes the customer", async () => {
    const { userId, customer, subscription } = await subscribedOwner("erase@example.com");
    // Whatever path removes the account (here the cascade from `user`).
    await db.execute(sql`delete from "user" where "id" = ${userId}`);
    expect(await row(userId)).toBeUndefined();
    const queued = await db.execute(
      sql`select "stripe_subscription_id" from "billing_customer_erasure" where "stripe_customer_id" = ${customer}`,
    );
    expect(queued.rows).toEqual([{ stripe_subscription_id: subscription.id }]);

    fake.failNext("customers.del", "api_connection_error");
    expect(await billing.processErasures()).toMatchObject({ failed: 1 });
    const retried = await db.execute(
      sql`select "attempts" from "billing_customer_erasure" where "stripe_customer_id" = ${customer}`,
    );
    expect(retried.rows).toEqual([{ attempts: 1 }]);

    expect((await billing.processErasures()).completed).toBeGreaterThanOrEqual(1);
    const cancel = fake.calls.find((c) => c.method === "subscriptions.cancel");
    expect(cancel?.params).toEqual({ id: subscription.id, invoice_now: false, prorate: false });
    expect(fake.customers.has(customer)).toBe(false);
    expect(fake.subscriptions.get(subscription.id)?.status).toBe("canceled");
    const left = await db.execute(sql`select 1 from "billing_customer_erasure"`);
    expect(left.rows).toHaveLength(0);

    // Stripe then sends `customer.subscription.deleted`: no row, no email.
    const late = await deliver("customer.subscription.deleted", {
      object: "subscription",
      customer,
    });
    expect(late.outcome).toBe("unknown_customer");
    expect(sent).toHaveLength(0);
  });

  test("an erased trial that never reached Stripe queues nothing", async () => {
    const userId = await createUser("erase.trial@example.com");
    await startTrial(db, { userId });
    await db.execute(sql`delete from "user" where "id" = ${userId}`);
    const queued = await db.execute(sql`select 1 from "billing_customer_erasure"`);
    expect(queued.rows).toHaveLength(0);
  });

  test("old event ids are pruned by the scheduled job", async () => {
    await db.execute(
      sql`insert into "billing_webhook_event" ("id", "type", "processed_at") values ('evt_ancient', 'invoice.paid', now() - interval '120 days')`,
    );
    expect((await billing.runScheduled()).eventsPruned).toBeGreaterThanOrEqual(1);
  });

  test("Stripe metadata contains only opaque owner and acceptance references", async () => {
    const calls = [...allCalls, ...fake.calls];
    expect(calls.length).toBeGreaterThan(10);
    const users = await db.execute(sql`select "id" from "user"`);
    const userIds = new Set(users.rows.map((r) => String((r as { id: string }).id)));
    for (const call of calls) {
      for (const entry of metadataObjects(call)) {
        expect(Object.keys(entry).sort()).toEqual(
          (entry.acceptance_reference
            ? [METADATA_REF_KEY, "acceptance_reference"]
            : [METADATA_REF_KEY]
          ).sort(),
        );
        expect(String(entry[METADATA_REF_KEY])).toMatch(/^ovc_[0-9a-f]{32}$/);
        if (entry.acceptance_reference)
          expect(String(entry.acceptance_reference)).toMatch(/^[0-9a-f-]{36}$/i);
      }
      for (const value of strings(call)) {
        expect(userIds.has(value)).toBe(false);
        expect(value).not.toContain("Synthetic Person");
      }
    }
    // Billing logs never carry an email or a Stripe id.
    for (const line of logged) {
      expect(line).not.toMatch(/@example\.com|cus_test_|sub_test_|ovc_/);
    }
  });
});
