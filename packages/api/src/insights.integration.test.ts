import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { metricDefinition, metricSample } from "@openvalens/db/schema/health-record";
import { EmailTransientError, type EmailService, type SendEmailInput } from "@openvalens/email";
import type { PushMessage, PushProvider } from "@openvalens/push";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import {
  EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
  type InsightPreferences,
  type InsightsResult,
} from "./insight-contract";
import { isoWeek } from "./insight-rules";
import { deriveInsightUnsubscribeKey } from "./insights";
import { appRouter } from "./routers/index";

/**
 * Issue #92 — insights over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL: real domain reads, permissions, workspace isolation, the 18+
 * scope, feedback, opt-in delivery preferences, the delivery cron (claim,
 * dedupe, one push a day, generic payload, weekly email with one-step
 * unsubscribe), and value-free logs and delivery records. Synthetic data only.
 *
 * Guarded by `INSIGHTS_TEST_DATABASE_URL`, which must point at an *empty*
 * loopback database named `insights_test`. Registered in
 * `scripts/test-integration.sh`.
 */

const url = process.env.INSIGHTS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/insights_test")
    throw new Error("Empty disposable loopback insights_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const tables = await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`);
  if (tables.rows.length) throw new Error("Integration database must be empty.");
  const root = new URL("../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/** A owns org-a (V views it, N has no record access); B owns org-b; U declared under 18. */
const MEMBERS: Record<string, { org: string; role: string; denied?: boolean }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-v": { org: "org-a", role: "viewer" },
  "user-n": { org: "org-a", role: "viewer", denied: true },
  "user-b": { org: "org-b", role: "owner" },
  "user-u": { org: "org-u", role: "owner" },
};

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const expiresAt = new Date(Date.now() + 3_600_000);

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: { id: `s-${id}`, userId: id, activeOrganizationId: MEMBERS[id]!.org, expiresAt },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]!.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const member = MEMBERS[actorOf(headers)]!;
      if (member.denied) return { success: false };
      const actions = Object.values(body.permissions).flat();
      return { success: member.role !== "viewer" || actions.every((action) => action === "read") };
    },
  },
} as unknown as Auth;

const DAY_MS = 86_400_000;
const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
const at = (daysAgo: number, hour: number) =>
  new Date(todayUtc.getTime() - daysAgo * DAY_MS + hour * 3_600_000);
const TODAY = todayUtc.toISOString().slice(0, 10);
const RHR_INSIGHT = `change.resting_heart_rate:${isoWeek(TODAY)}`;
const CRON_SECRET = "cron-secret-long-enough-value-for-tests";

describe.skipIf(!url)("insights over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/insights_test" });
  const rpc = new RPCHandler(appRouter);
  const logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);

  const pushes: PushMessage[] = [];
  let pushAvailable = true;
  const fakePush: PushProvider = {
    id: "expo",
    send: async (message) => {
      pushes.push(message);
      return message.to.map((token) => ({ token, status: "ok" as const }));
    },
  };
  const emails: SendEmailInput[] = [];
  let failEmail = false;
  const fakeEmail: EmailService = {
    organizationName: "Health",
    sendEmail: async (input) => {
      if (failEmail) throw new EmailTransientError(503, "provider_down");
      emails.push(input);
      return { id: "fake", dryRun: false };
    },
  };

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: {
        user: { id },
        session: { id: `s-${id}`, activeOrganizationId: MEMBERS[id]?.org, expiresAt },
      },
      db,
      correlationId: "corr-92",
      cronSecret: CRON_SECRET,
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: true, mobilePairing: true },
      integrations: { email: { provider: "resend", state: "configured" } },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      email: fakeEmail,
      push: pushAvailable ? fakePush : null,
      webOrigin: "https://app.example.test",
      insightUnsubscribeKey: deriveInsightUnsubscribeKey("x".repeat(40)),
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    path: string,
    input: unknown,
    user: string | null = "user-a",
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({ "content-type": "application/json", ...extraHeaders });
    if (user) headers.set("x-test-user", user);
    const request = new Request(`http://test.local/rpc/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: user
        ? contextFor(headers)
        : ({ ...contextFor(headers), session: null } as unknown as Context),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const runCron = () =>
    call<Record<string, number | string>>("cron/insightsRun", {}, null, {
      authorization: `Bearer ${CRON_SECRET}`,
    });

  beforeAll(async () => {
    await migrate(db);
    setRegisteredAuth(fakeAuth);
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (originalErrWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write;

    for (const [id, member] of Object.entries(MEMBERS)) {
      await db.execute(sql`insert into "user" (id, email) values (${id}, ${`${id}@example.test`})`);
      await db.execute(
        sql`insert into organization (id, name, slug) values (${member.org}, ${member.org}, ${member.org}) on conflict do nothing`,
      );
      await db.execute(
        sql`insert into member (id, organization_id, user_id, role) values (${`m-${id}`}, ${member.org}, ${id}, ${member.role})`,
      );
    }
    await db.execute(
      sql`insert into wellness_profile (user_id, revision, eligibility_state, eligibility) values ('user-u', 1, 'recorded', 'under_18')`,
    );

    // org-a and org-u: 32 usual days around 60 bpm, then 9 days around 68.
    for (const org of ["org-a", "org-u"]) {
      const [rhr] = await db
        .insert(metricDefinition)
        .values({
          organizationId: org,
          code: "resting_heart_rate",
          displayName: "Resting heart rate",
          category: "vitals",
          unit: "bpm",
          valueType: "number",
          aggregationDefault: "avg",
        })
        .returning({ id: metricDefinition.id });
      const samples: (typeof metricSample.$inferInsert)[] = [];
      for (let daysAgo = 0; daysAgo <= 40; daysAgo += 1) {
        samples.push({
          organizationId: org,
          metricDefinitionId: rhr!.id,
          sampledAt: at(daysAgo, 6),
          numericValue: (daysAgo <= 8 ? 68 : 60) + (daysAgo % 2 === 0 ? 1 : -1),
          dedupeHash: `rhr-${org}-${daysAgo}`,
        });
      }
      await db.insert(metricSample).values(samples);
    }
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    clearRegisteredAuth();
  });

  test("list: describes a sustained change from stored records, with readiness for the rest", async () => {
    const { status, body } = await call<InsightsResult>("insights/list", {});
    expect(status).toBe(200);
    expect(body.status).toBe("available");
    const insight = body.insights.find((entry) => entry.id === RHR_INSIGHT);
    expect(insight?.detail).toMatchObject({
      type: "change",
      metric: "resting_heart_rate",
      direction: "higher",
      unit: "bpm",
    });
    const readiness = Object.fromEntries(
      body.readiness.map((entry) => [entry.ruleId, entry.state]),
    );
    expect(readiness["change.resting_heart_rate"]).toBe("ready");
    expect(readiness["change.sleep_duration"]).toBe("building_baseline");
    expect(body.offerPush).toBe(true);
  });

  test("permissions, isolation and the 18+ scope", async () => {
    expect((await call("insights/list", {}, "user-n")).status).toBe(403);
    expect((await call("insights/list", {}, null)).status).toBe(401);
    const viewer = await call<InsightsResult>("insights/list", {}, "user-v");
    expect(viewer.status).toBe(200);
    expect(viewer.body.offerPush).toBe(false);
    const other = await call<InsightsResult>("insights/list", {}, "user-b");
    expect(other.body.insights).toEqual([]);
    const minor = await call<InsightsResult>("insights/list", {}, "user-u");
    expect(minor.body).toMatchObject({
      status: "withheld",
      withheldReason: "adults_only",
      insights: [],
    });
    const spoof = await call("insights/list", { organizationId: "org-b" });
    expect(spoof.status).toBe(400);
  });

  test("feedback: dismiss hides one insight for this person only; unknown rules are rejected", async () => {
    const bad = await call<{ code: string }>("insights/feedback", {
      insightId: "made.up:rule",
      action: "dismiss",
    });
    expect(bad.status).toBe(400);
    const dismissed = await call(
      "insights/feedback",
      { insightId: RHR_INSIGHT, action: "dismiss" },
      "user-v",
    );
    expect(dismissed.status).toBe(200);
    const viewer = await call<InsightsResult>("insights/list", {}, "user-v");
    expect(viewer.body.insights.some((entry) => entry.id === RHR_INSIGHT)).toBe(false);
    expect(viewer.body.hiddenCount).toBeGreaterThanOrEqual(1);
    const owner = await call<InsightsResult>("insights/list", {}, "user-a");
    expect(owner.body.insights.some((entry) => entry.id === RHR_INSIGHT)).toBe(true);
  });

  test("preferences: everything off by default; owner-only opt-in; email needs the acknowledgement", async () => {
    const initial = await call<InsightPreferences>("insights/preferences/get", {});
    expect(initial.body).toMatchObject({
      canConfigureDelivery: true,
      pushAvailable: true,
      emailAvailable: true,
      push: { enabled: false, showTopic: false, offerState: "not_offered", registeredDevices: 0 },
      email: { enabled: false, acknowledgedVersion: null },
    });
    const viewer = await call("insights/preferences/update", { push: { enabled: true } }, "user-v");
    expect(viewer.status).toBe(403);
    const noAck = await call<{ data?: { reason?: string } }>("insights/preferences/update", {
      email: { enabled: true },
    });
    expect(noAck.status).toBe(400);
    expect(noAck.body.data?.reason).toBe("acknowledgement_required");
    const badZone = await call("insights/preferences/update", { timeZone: "Mars/Olympus" });
    expect(badZone.status).toBe(400);
  });

  test("push devices: register and unregister this phone's token", async () => {
    const token = "ExponentPushToken[synthetic-token-a1]";
    const registered = await call<{ registeredDevices: number }>("insights/pushDevices/register", {
      token,
      platform: "ios",
    });
    expect(registered.body.registeredDevices).toBe(1);
    const invalid = await call("insights/pushDevices/register", {
      token: "not-a-token",
      platform: "ios",
    });
    expect(invalid.status).toBe(400);
    const second = "ExponentPushToken[synthetic-token-a2]";
    await call("insights/pushDevices/register", { token: second, platform: "android" });
    const removed = await call<{ registeredDevices: number }>("insights/pushDevices/unregister", {
      token: second,
    });
    expect(removed.body.registeredDevices).toBe(1);
  });

  test("cron: refuses without the secret; delivers nothing while nobody opted in", async () => {
    expect((await call("cron/insightsRun", {}, null)).status).toBe(401);
    const run = await runCron();
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ candidates: 0, pushSent: 0, emailSent: 0 });
    expect(pushes).toHaveLength(0);
  });

  test("cron: per-kind toggles apply on the next run; one generic push a day; no duplicates", async () => {
    // Opt in from the in-context offer, but switch change insights off for push.
    await call("insights/preferences/update", {
      pushOffer: "accepted",
      deliveryHour: 0,
      channels: { change: { push: false } },
    });
    const skipped = await runCron();
    expect(skipped.body).toMatchObject({ candidates: 1, pushSent: 0 });
    expect(pushes).toHaveLength(0);

    await call("insights/preferences/update", { channels: { change: { push: true } } });
    const sent = await runCron();
    expect(sent.body).toMatchObject({ pushSent: 1 });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual({
      to: ["ExponentPushToken[synthetic-token-a1]"],
      title: "OpenValens",
      body: "You have a new insight",
      path: "/",
    });
    expect(JSON.stringify(pushes[0])).not.toMatch(/\d{2}\s*bpm|resting|heart/i);

    const again = await runCron();
    expect(again.body).toMatchObject({ pushSent: 0 });
    expect(pushes).toHaveLength(1);

    const [row] = (
      await db.execute<{
        channel: string;
        insight_ids: string[];
        rule_versions: string[];
        status: string;
      }>(
        sql`select channel, insight_ids, rule_versions, status from insight_delivery where user_id = 'user-a'`,
      )
    ).rows;
    expect(row).toEqual({
      channel: "push",
      insight_ids: [RHR_INSIGHT],
      rule_versions: ["change.resting_heart_rate@1"],
      status: "sent",
    });
  });

  test("cron: the weekly email needs acknowledgement, sends values once, and unsubscribes in one step", async () => {
    const enabled = await call<InsightPreferences>("insights/preferences/update", {
      email: { enabled: true, acknowledgement: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION },
    });
    expect(enabled.body.email).toEqual({
      enabled: true,
      acknowledgedVersion: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
    });

    failEmail = true;
    const failed = await runCron();
    expect(failed.body).toMatchObject({ emailSent: 0, failed: 1 });
    expect(logged.join("")).toContain('"errorCategory":"provider_unavailable"');
    failEmail = false;

    const sent = await runCron();
    expect(sent.body).toMatchObject({ emailSent: 1 });
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.to).toBe("user-a@example.test");
    expect(email.subject).toBe("Your weekly insights summary");
    expect(email.text).toContain("Resting heart rate higher than your usual");
    expect(email.text).toContain("bpm");
    const match = /unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(email.text);
    expect(match).not.toBeNull();
    expect(email.headers?.["List-Unsubscribe"]).toContain(match![1]!);

    expect((await runCron()).body).toMatchObject({ emailSent: 0 });
    expect(emails).toHaveLength(1);

    const invalid = await call<{ status: string }>(
      "insights/unsubscribe",
      { token: "x".repeat(43) },
      null,
    );
    expect(invalid.body.status).toBe("invalid");
    const unsubscribed = await call<{ status: string }>(
      "insights/unsubscribe",
      { token: match![1] },
      null,
    );
    expect(unsubscribed.body.status).toBe("unsubscribed");
    const after = await call<InsightPreferences>("insights/preferences/get", {});
    expect(after.body.email.enabled).toBe(false);
  });

  test("removing the member removes their preferences and stops delivery", async () => {
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-b-in-a', 'org-a', 'user-b', 'viewer')`,
    );
    await db.execute(
      sql`insert into insight_preference (organization_id, user_id, push_enabled) values ('org-a', 'user-b', true)`,
    );
    await db.execute(sql`delete from member where id = 'm-b-in-a'`);
    const rows = await db.execute(
      sql`select 1 from insight_preference where organization_id = 'org-a' and user_id = 'user-b'`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  test("delivery records and logs carry no values, tokens or addresses", async () => {
    const records = await db.execute(sql`select * from insight_delivery`);
    expect(JSON.stringify(records.rows)).not.toMatch(/bpm|\b6[0-9]\.\d\b/);
    const all = logged.join("");
    expect(all).not.toContain("ExponentPushToken");
    expect(all).not.toContain("user-a@example.test");
    expect(all).not.toContain("unsubscribe?token=");
    expect(all).not.toMatch(/"recentValue"|"baselineValue"|bpm/);
  });

  test("push unavailable on the server: opt-in is refused", async () => {
    pushAvailable = false;
    const prefs = await call<InsightPreferences>("insights/preferences/get", {}, "user-b");
    expect(prefs.body.pushAvailable).toBe(false);
    const refused = await call<{ data?: { reason?: string } }>(
      "insights/preferences/update",
      { push: { enabled: true } },
      "user-b",
    );
    expect(refused.status).toBe(400);
    expect(refused.body.data?.reason).toBe("push_unavailable");
    pushAvailable = true;
  });
});
