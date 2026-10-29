import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

import { deleteAccountForRetention } from "@openvalens/data-rights";
import { createDb, sql, type Database } from "@openvalens/db";
import type { SendEmailInput } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import type { RetentionConfig } from "./entitlement";
import { createStripeProvider, signStripeTestPayload } from "./providers/stripe";
import { createBillingService, type BillingService, type RetentionEraser } from "./service";
import { createFakeStripe, stripeEventPayload, type FakeStripe } from "./testing";
import { startTrial } from "./trial";

/**
 * Issue #298 — subscription states over a disposable PostgreSQL: access
 * follows the workspace owner, the past-due grace period, the member view of
 * Plan & billing, and the retention job (warning, then deletion through the
 * account-erasure path) with an injected clock.
 *
 * Guarded by `BILLING_ACCESS_TEST_DATABASE_URL`, an *empty* loopback database
 * named `billing_access_test`; the full migration set is applied first.
 */

const url = process.env.BILLING_ACCESS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/billing_access_test"
  ) {
    throw new Error("Empty disposable loopback billing_access_test database required.");
  }
}

const WEBHOOK_SECRET = "whsec_test_billing_access";
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

describe.skipIf(!url)("subscription states against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/billing_access_test" });
  const logged: string[] = [];
  const logger = createStructuredLogger({
    level: "debug",
    sink: (_level, line) => void logged.push(line),
  });
  let clock = new Date();
  let fake: FakeStripe;
  let billing: BillingService;
  let sent: SendEmailInput[] = [];
  let eventSeq = 0;

  function build(retention?: RetentionConfig) {
    fake = createFakeStripe({
      [PRICES.monthly]: { unitAmount: 799, interval: "month" },
      [PRICES.annual]: { unitAmount: 6900, interval: "year" },
    });
    billing = createBillingService({
      db,
      provider: createStripeProvider({
        secretKey: "sk_test_access",
        webhookSecret: WEBHOOK_SECRET,
        client: fake.client,
      }),
      config: { prices: PRICES, termsUrl: "https://legal.test/terms", checkoutAcknowledgementVersion: "checkout-v1" },
      webOrigin: "https://app.openvalens.test",
      email: {
        organizationName: "OpenValens",
        sendEmail: async (input) => {
          sent.push(input);
          return { id: `msg-${sent.length}`, dryRun: false };
        },
      },
      localeForUser: async () => "en",
      logger,
      now: () => clock,
      pastDueGraceDays: 7,
      ...(retention ? { retention } : {}),
    });
  }

  /** A person with their own workspace (owner), as Cloud sign-up creates it. */
  async function createOwner(name: string): Promise<{ userId: string; orgId: string }> {
    const userId = crypto.randomUUID();
    const orgId = `org-${userId}`;
    await db.execute(
      sql`insert into "user" ("id", "email", "email_verified", "role", "banned", "name", "created_at", "updated_at") values (${userId}, ${`${userId}@example.test`}, true, 'user', false, ${name}, now(), now())`,
    );
    await db.execute(
      sql`insert into "organization" ("id", "name", "slug", "created_at") values (${orgId}, 'Synthetic workspace', ${orgId}, now())`,
    );
    await db.execute(
      sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at") values (${`m-${userId}`}, ${orgId}, ${userId}, 'owner', now())`,
    );
    return { userId, orgId };
  }

  async function addMember(orgId: string, userId: string) {
    await db.execute(
      sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at") values (${`m-${orgId}-${userId}`}, ${orgId}, ${userId}, 'collaborator', now())`,
    );
  }

  async function row(userId: string) {
    const result = await db.execute(sql`select * from "subscription" where "user_id" = ${userId}`);
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  async function deliver(type: string, object: Record<string, unknown>) {
    const payload = stripeEventPayload({ id: `evt_access_${++eventSeq}`, type, object });
    const signature = await signStripeTestPayload(payload, WEBHOOK_SECRET);
    return billing.handleWebhook({ rawBody: new TextEncoder().encode(payload), signature });
  }

  async function subscribedOwner(name: string) {
    const owner = await createOwner(name);
    await startTrial(db, { userId: owner.userId });
    await billing.startCheckout({ userId: owner.userId, plan: "monthly", acceptedImmediateStart: true, acceptedWithdrawalAcknowledgement: true, acknowledgementVersion: "checkout-v1" });
    const customer = String((await row(owner.userId))!.stripe_customer_id);
    const ref = String((await row(owner.userId))!.customer_ref);
    const subscription = fake.completeCheckout({ customer, priceId: PRICES.monthly, ref });
    await deliver("checkout.session.completed", {
      object: "checkout.session",
      customer,
      client_reference_id: ref,
      subscription: subscription.id,
    });
    return { ...owner, customer, subscription };
  }

  /** Ends an owner's plan at `endedAt` (as the webhook would record it). */
  async function endedAt(userId: string, at: Date) {
    await db.execute(
      sql`update "subscription" set "status" = 'canceled', "ended_at" = ${at.toISOString()} where "user_id" = ${userId}`,
    );
  }

  const eraser: RetentionEraser = async ({ userId, stillDue }) => {
    const result = await deleteAccountForRetention(db, { userId, stillDue }, null);
    return result.outcome;
  };

  beforeAll(async () => {
    await migrate(db);
  });

  beforeEach(async () => {
    clock = new Date();
    sent = [];
    // Retention looks at every row: start each test from an empty table.
    await db.execute(sql`delete from "user"`);
    await db.execute(sql`delete from "organization"`);
    await db.execute(sql`delete from "billing_customer_erasure"`);
    build();
  });

  afterAll(() => {
    // Logs are value-free: no email address or Stripe id ever.
    const text = logged.join("\n");
    expect(text).not.toContain("@example.test");
    expect(text).not.toMatch(/cus_|sub_/);
  });

  test("an invited member follows the workspace owner's plan, not their own", async () => {
    const owner = await createOwner("Ana Owner");
    await startTrial(db, { userId: owner.userId });
    const member = await createOwner("Rui Member");
    await startTrial(db, { userId: member.userId });
    await addMember(owner.orgId, member.userId);

    expect(
      await billing.resolveAccess({ userId: member.userId, organizationId: owner.orgId }),
    ).toMatchObject({
      level: "full",
      status: "trialing",
      viewerIsOwner: false,
      ownerName: "Ana Owner",
    });

    // The owner's trial runs out: the member's own (still running) trial does not help.
    await endedAt(owner.userId, new Date(clock.getTime() - DAY));
    expect(
      await billing.resolveAccess({ userId: member.userId, organizationId: owner.orgId }),
    ).toMatchObject({ level: "read_only", status: "canceled", viewerIsOwner: false });
    // In their own workspace the member still has their own trial.
    expect(
      await billing.resolveAccess({ userId: member.userId, organizationId: member.orgId }),
    ).toMatchObject({ level: "full", viewerIsOwner: true, ownerName: null });
  });

  test("Plan & billing: a member gets the neutral view, no prices, no Checkout", async () => {
    const owner = await subscribedOwner("Ana Owner");
    const member = await createOwner("Rui Member");
    await addMember(owner.orgId, member.userId);
    // Before #298 a member with no trial of their own saw `none` + Subscribe.
    await db.execute(sql`delete from "subscription" where "user_id" = ${member.userId}`);

    const view = await billing.getStatus(member.userId, owner.orgId);
    expect(view).toMatchObject({
      viewer: "member",
      ownerName: "Ana Owner",
      status: "active",
      access: "full",
      canSubscribe: false,
      canManage: false,
      prices: { monthly: null, annual: null },
      checkoutAcknowledgement: null,
    });
    const own = await billing.getStatus(owner.userId, owner.orgId);
    expect(own).toMatchObject({
      viewer: "owner", ownerName: null, canManage: true,
      checkoutAcknowledgement: { version: "checkout-v1", termsUrl: "https://legal.test/terms" },
    });
    expect(own.prices.monthly).toEqual({ amount: 799, currency: "eur" });
  });

  test("past_due: full access for the grace period, then read-only; paying restores it", async () => {
    const owner = await subscribedOwner("Grace Owner");
    fake.update(owner.subscription.id, { status: "past_due" });
    await deliver("invoice.payment_failed", { object: "invoice", customer: owner.customer });
    const since = new Date((await row(owner.userId))!.past_due_since as Date);
    expect(Math.abs(since.getTime() - Date.now())).toBeLessThan(60_000);

    // A retry fails again later: the grace period still counts from the first failure.
    clock = new Date(since.getTime() + 3 * DAY);
    await deliver("invoice.payment_failed", { object: "invoice", customer: owner.customer });
    expect(new Date((await row(owner.userId))!.past_due_since as Date)).toEqual(since);
    const during = await billing.resolveAccess({
      userId: owner.userId,
      organizationId: owner.orgId,
    });
    expect(during).toMatchObject({ level: "full", status: "past_due" });
    expect(during.graceEndsAt).toEqual(new Date(since.getTime() + 7 * DAY));

    clock = new Date(since.getTime() + 7 * DAY + 1000);
    expect(
      (await billing.resolveAccess({ userId: owner.userId, organizationId: owner.orgId })).level,
    ).toBe("read_only");
    expect((await billing.getStatus(owner.userId, owner.orgId)).access).toBe("read_only");

    fake.update(owner.subscription.id, { status: "active" });
    await deliver("invoice.paid", { object: "invoice", customer: owner.customer });
    expect((await row(owner.userId))!.past_due_since).toBeNull();
    expect(
      (await billing.resolveAccess({ userId: owner.userId, organizationId: owner.orgId })).level,
    ).toBe("full");
  });

  test("cancelling records when access ended; subscribing again clears it", async () => {
    const owner = await subscribedOwner("Cancel Owner");
    fake.update(owner.subscription.id, { status: "canceled" });
    await deliver("customer.subscription.deleted", {
      object: "subscription",
      customer: owner.customer,
    });
    const ended = (await row(owner.userId))!;
    expect(ended.status).toBe("canceled");
    expect(ended.ended_at).not.toBeNull();
    await db.execute(
      sql`update "subscription" set "retention_warning_sent_at" = now() where "user_id" = ${owner.userId}`,
    );

    const again = fake.completeCheckout({ customer: owner.customer, priceId: PRICES.annual });
    await deliver("customer.subscription.created", {
      object: "subscription",
      customer: owner.customer,
    });
    expect(await row(owner.userId)).toMatchObject({
      status: "active",
      stripe_subscription_id: again.id,
      ended_at: null,
      retention_warning_sent_at: null,
    });
  });

  test("a lapsed local trial is recorded as ended at the trial's end", async () => {
    const owner = await createOwner("Trial Owner");
    await startTrial(db, { userId: owner.userId, trialDays: 1 });
    const ends = new Date((await row(owner.userId))!.trial_ends_at as Date);
    clock = new Date(ends.getTime() + DAY);
    expect(
      (await billing.resolveAccess({ userId: owner.userId, organizationId: owner.orgId })).level,
    ).toBe("read_only");
    await billing.runScheduled();
    expect(new Date((await row(owner.userId))!.ended_at as Date)).toEqual(ends);
  });

  test("retention is off unless configured: nothing is warned or deleted", async () => {
    const owner = await createOwner("Old Owner");
    await startTrial(db, { userId: owner.userId });
    await endedAt(owner.userId, new Date(clock.getTime() - 5 * 365 * DAY));
    const result = await billing.runScheduled({ eraseAccount: eraser });
    expect(result).toMatchObject({
      retentionWarned: 0,
      retentionDeleted: 0,
      retentionDryRun: false,
    });
    expect(await row(owner.userId)).toBeDefined();
    expect(sent.filter((m) => m.templateName === "billing-retention_warning")).toHaveLength(0);
  });

  test("retention: a warning email first, deletion 30+ days later through account erasure", async () => {
    build({ months: 12, dryRun: false });
    const start = new Date("2027-01-15T12:00:00.000Z");
    const owner = await createOwner("Lapsed Owner");
    await startTrial(db, { userId: owner.userId });
    await endedAt(owner.userId, start);
    const member = await createOwner("Kept Member");
    await startTrial(db, { userId: member.userId });
    await db.execute(
      sql`update "subscription" set "status" = 'active', "stripe_subscription_id" = 'sub_kept' where "user_id" = ${member.userId}`,
    );
    await addMember(owner.orgId, member.userId);

    // 10 months in: too early for anything.
    clock = new Date("2027-11-15T12:00:00.000Z");
    expect(await billing.runScheduled({ eraseAccount: eraser })).toMatchObject({
      retentionWarned: 0,
      retentionDeleted: 0,
    });

    // 11 months and a bit: the warning goes out, once.
    clock = new Date("2027-12-20T12:00:00.000Z");
    expect((await billing.runScheduled({ eraseAccount: eraser })).retentionWarned).toBe(1);
    const warning = sent.find((m) => m.templateName === "billing-retention_warning");
    expect(warning?.to).toBe(`${owner.userId}@example.test`);
    // 12 months after the end, but never less than 30 days after the warning.
    expect(warning?.text).toContain("January 19, 2028");
    expect(warning?.text).toContain("/settings/billing");
    expect((await billing.runScheduled({ eraseAccount: eraser })).retentionWarned).toBe(0);

    // 12 months reached, but the warning is not 30 days old yet.
    clock = new Date("2028-01-16T12:00:00.000Z");
    expect((await billing.runScheduled({ eraseAccount: eraser })).retentionDeleted).toBe(0);
    expect(await row(owner.userId)).toBeDefined();

    // 30 days after the warning: deleted, with the workspace; the member stays.
    clock = new Date("2028-01-20T12:00:00.000Z");
    expect((await billing.runScheduled({ eraseAccount: eraser })).retentionDeleted).toBe(1);
    expect(await row(owner.userId)).toBeUndefined();
    const users = await db.execute(
      sql`select "id" from "user" where "id" in (${owner.userId}, ${member.userId})`,
    );
    expect(users.rows).toEqual([{ id: member.userId }]);
    const orgs = await db.execute(sql`select 1 from "organization" where "id" = ${owner.orgId}`);
    expect(orgs.rows).toHaveLength(0);
    const ledger = await db.execute(
      sql`select 1 from "erasure_ledger" where "subject_user_id" = ${owner.userId}`,
    );
    expect(ledger.rows).toHaveLength(1);
  });

  test("retention: an owner who subscribes again after the warning is kept", async () => {
    build({ months: 6, dryRun: false });
    const owner = await createOwner("Returning Owner");
    await startTrial(db, { userId: owner.userId });
    await endedAt(owner.userId, new Date("2027-01-01T00:00:00.000Z"));
    clock = new Date("2027-06-15T00:00:00.000Z");
    expect((await billing.runScheduled({ eraseAccount: eraser })).retentionWarned).toBe(1);

    // They come back (as the webhook records it) before the deletion run.
    await db.execute(
      sql`update "subscription" set "status" = 'active', "ended_at" = null, "retention_warning_sent_at" = null where "user_id" = ${owner.userId}`,
    );
    clock = new Date("2027-09-01T00:00:00.000Z");
    expect((await billing.runScheduled({ eraseAccount: eraser })).retentionDeleted).toBe(0);
    expect(await row(owner.userId)).toBeDefined();
  });

  test("retention: the deletion re-checks inside its transaction (stillDue)", async () => {
    const owner = await createOwner("Raced Owner");
    await startTrial(db, { userId: owner.userId });
    const skipped = await deleteAccountForRetention(
      db,
      { userId: owner.userId, stillDue: async () => false },
      null,
    );
    expect(skipped).toEqual({ outcome: "skipped" });
    expect(await row(owner.userId)).toBeDefined();
  });

  test("retention dry run counts what is due and changes nothing", async () => {
    build({ months: 12, dryRun: true });
    const warnOnly = await createOwner("Warn Owner");
    await startTrial(db, { userId: warnOnly.userId });
    await endedAt(warnOnly.userId, new Date("2027-01-01T00:00:00.000Z"));
    const due = await createOwner("Due Owner");
    await startTrial(db, { userId: due.userId });
    await endedAt(due.userId, new Date("2026-01-01T00:00:00.000Z"));
    await db.execute(
      sql`update "subscription" set "retention_warning_sent_at" = '2026-12-01T00:00:00Z' where "user_id" = ${due.userId}`,
    );
    clock = new Date("2027-12-15T00:00:00.000Z");
    const result = await billing.runScheduled({ eraseAccount: eraser });
    expect(result).toMatchObject({
      retentionDryRun: true,
      retentionWarned: 1,
      retentionDeleted: 1,
    });
    expect(sent.filter((m) => m.templateName === "billing-retention_warning")).toHaveLength(0);
    expect((await row(warnOnly.userId))!.retention_warning_sent_at).toBeNull();
    expect(await row(due.userId)).toBeDefined();
  });
});
