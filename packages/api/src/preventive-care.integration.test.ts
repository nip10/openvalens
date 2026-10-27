import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import type { EmailService, SendEmailInput } from "@openvalens/email";
import type { PushMessage, PushProvider } from "@openvalens/push";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "./context";
import { EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION } from "./insight-contract";
import { deriveInsightUnsubscribeKey } from "./insights";
import type { EvidenceLibraryResult, PreventiveCareResult } from "./preventive-care-contract";
import { appRouter } from "./routers/index";

/**
 * Issue #97 — preventive care over HTTP (oRPC `RPCHandler`) against a
 * disposable PostgreSQL: owner-only access, the 18+ and region gates,
 * profile-driven filtering (nothing inferred), self-declarations that are
 * never pre-selected, item states and band rules, region change keeping
 * history, the opt-in evidence-check library, and opt-in reminders through
 * the #92 channels (generic push/email, shared one-push-a-day claim, no
 * duplicates), with value-free logs and delivery records. Synthetic data only.
 *
 * Guarded by `PREVENTIVE_CARE_TEST_DATABASE_URL`, which must point at an
 * *empty* loopback database named `preventive_care_test`. Registered in
 * `scripts/test-integration.sh`.
 */

const url = process.env.PREVENTIVE_CARE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/preventive_care_test"
  )
    throw new Error("Empty disposable loopback preventive_care_test database required.");
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

/** A owns org-a (V views it); B owns org-b (UK, no age); N never answered; R adult, no region. */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-v": { org: "org-a", role: "viewer" },
  "user-b": { org: "org-b", role: "owner" },
  "user-n": { org: "org-n", role: "owner" },
  "user-r": { org: "org-r", role: "owner" },
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
      const actions = Object.values(body.permissions).flat();
      return { success: member.role !== "viewer" || actions.every((action) => action === "read") };
    },
  },
} as unknown as Auth;

const DAY_MS = 86_400_000;
const TODAY = new Date().toISOString().slice(0, 10);
const daysFromToday = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const BIRTH_YEAR_53 = new Date().getUTCFullYear() - 53;
const CRON_SECRET = "cron-secret-long-enough-value-for-tests";

describe.skipIf(!url)("preventive care over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/preventive_care_test" });
  const rpc = new RPCHandler(appRouter);
  const logged: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);

  const pushes: PushMessage[] = [];
  const fakePush: PushProvider = {
    id: "expo",
    send: async (message) => {
      pushes.push(message);
      return message.to.map((token) => ({ token, status: "ok" as const }));
    },
  };
  const emails: SendEmailInput[] = [];
  const fakeEmail: EmailService = {
    organizationName: "Health",
    sendEmail: async (input) => {
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
      correlationId: "corr-97",
      cronSecret: CRON_SECRET,
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: true, mobilePairing: true },
      integrations: { email: { provider: "resend", state: "configured" } },
      telegram: { connectTokenTtlSeconds: 600 },
      telegramClient: null,
      email: fakeEmail,
      push: fakePush,
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

  const get = (user = "user-a") => call<PreventiveCareResult>("preventiveCare/get", {}, user);
  const runCron = () =>
    call<Record<string, number | string>>("cron/insightsRun", {}, null, {
      authorization: `Bearer ${CRON_SECRET}`,
    });

  async function setRegion(userId: string, region: string | null) {
    await db.execute(
      sql`update wellness_profile set region_state = ${region ? "recorded" : null}, region = ${region} where user_id = ${userId}`,
    );
  }

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
    // A: adult, US, birth year (age 52–53) and sex with consent.
    await db.execute(sql`
      insert into wellness_profile (user_id, revision, eligibility_state, eligibility, region_state, region,
                                    birth_year_state, birth_year, sex_state, sex)
      values ('user-a', 1, 'recorded', 'adult', 'recorded', 'us', 'recorded', ${BIRTH_YEAR_53}, 'recorded', 'female')`);
    await db.execute(sql`
      insert into wellness_profile_consent (user_id, purpose, version) values
        ('user-a', 'age_band', '2026-10-15'), ('user-a', 'sex', '2026-10-15')`);
    // B: adult, UK, no birth year, sex declined.
    await db.execute(sql`
      insert into wellness_profile (user_id, revision, eligibility_state, eligibility, region_state, region, sex_state)
      values ('user-b', 1, 'recorded', 'adult', 'recorded', 'uk', 'declined')`);
    // R: adult, region declined.
    await db.execute(sql`
      insert into wellness_profile (user_id, revision, eligibility_state, eligibility, region_state)
      values ('user-r', 1, 'recorded', 'adult', 'declined')`);
  });

  afterAll(() => {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    clearRegisteredAuth();
  });

  test("owner sees cited, region-filtered items for their age and sex", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.status).toBe("available");
    expect(body.region).toBe("us");
    const breast = body.items.find((item) => item.id === "us.breast_screening");
    expect(breast).toMatchObject({
      applicability: "applies",
      band: "recommended",
      grade: { scale: "uspstf", value: "B" },
      statementDate: "2024-04-30",
    });
    expect(breast?.sourceUrl).toStartWith("https://www.uspreventiveservicestaskforce.org/");
    expect(breast?.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.items.every((item) => item.id.startsWith("us."))).toBe(true);
    expect(body.notShown.map((entry) => entry.id)).toContain("us.prostate_psa_55_69");
    expect(body.libraryEnabled).toBe(false);
    expect(body.canEdit).toBe(true);
  });

  test("gates: other members, unauthenticated, under-confirmed adults and no region", async () => {
    expect((await call("preventiveCare/get", {}, null)).status).toBe(401);
    const viewer = await get("user-v");
    expect(viewer.body).toMatchObject({ status: "owner_only", items: [], criteria: [] });
    const viewerWrite = await call(
      "preventiveCare/declare",
      { criterion: "ever_smoked", answer: "yes" },
      "user-v",
    );
    expect(viewerWrite.status).toBe(403);
    expect((await get("user-n")).body).toMatchObject({
      status: "adult_confirmation_required",
      items: [],
    });
    expect((await get("user-r")).body).toMatchObject({ status: "no_region", items: [] });
    const spoof = await call("preventiveCare/get", { organizationId: "org-b" });
    expect(spoof.status).toBe(400);
  });

  test("missing age and sex are explained, never inferred", async () => {
    const { body } = await get("user-b");
    expect(body.status).toBe("available");
    expect(body.ageUnavailable).toBe("not_provided");
    expect(body.sexUnavailable).toBe("declined");
    const breast = body.items.find((item) => item.id === "uk.breast_screening");
    expect(breast?.applicability).toBe("needs_sex");
    const bowel = body.items.find((item) => item.id === "uk.bowel_screening");
    expect(bowel?.applicability).toBe("needs_age");
  });

  test("declarations: never pre-selected, prefer-not-to-say allowed, clearing deletes", async () => {
    const before = await get();
    const question = before.body.criteria.find((entry) => entry.id === "ever_smoked");
    expect(question?.answer).toBeNull();
    const declared = await call("preventiveCare/declare", {
      criterion: "ever_smoked",
      answer: "prefer_not_to_say",
    });
    expect(declared.status).toBe(200);
    expect((await get()).body.criteria.find((entry) => entry.id === "ever_smoked")?.answer).toBe(
      "prefer_not_to_say",
    );
    await call("preventiveCare/declare", { criterion: "ever_smoked", answer: null });
    const rows = await db.execute(
      sql`select 1 from preventive_care_declaration where user_id = 'user-a'`,
    );
    expect(rows.rows).toHaveLength(0);
    const bad = await call("preventiveCare/declare", { criterion: "lab_value", answer: "yes" });
    expect(bad.status).toBe(400);
  });

  test("item states follow the band rules", async () => {
    const decision = await call<{ data?: { reason?: string } }>("preventiveCare/updateItem", {
      itemId: "us.breast_screening",
      plan: "decided_no",
    });
    expect(decision.status).toBe(400);
    expect(decision.body.data?.reason).toBe("plan_not_allowed");
    const unknown = await call<{ data?: { reason?: string } }>("preventiveCare/updateItem", {
      itemId: "us.made_up",
      plan: "none",
    });
    expect(unknown.body.data?.reason).toBe("unknown_item");
    const noDate = await call<{ data?: { reason?: string } }>("preventiveCare/updateItem", {
      itemId: "us.breast_screening",
      remind: true,
    });
    expect(noDate.body.data?.reason).toBe("remind_needs_date");
    const done = await call("preventiveCare/updateItem", {
      itemId: "us.breast_screening",
      lastDoneOn: "2025-02-28",
    });
    expect(done.status).toBe(200);
    const view = (await get()).body.items.find((item) => item.id === "us.breast_screening");
    expect(view?.state.lastDoneOn).toBe("2025-02-28");
    expect(view?.suggestedNextOn).toBe("2027-02-28");
    expect(view?.state.nextOn).toBeNull();
  });

  test("changing region swaps the rule set and keeps the history", async () => {
    await setRegion("user-a", "uk");
    const uk = await get();
    expect(uk.body.region).toBe("uk");
    expect(uk.body.items.every((item) => item.id.startsWith("uk."))).toBe(true);
    await setRegion("user-a", "us");
    const us = await get();
    expect(us.body.items.find((item) => item.id === "us.breast_screening")?.state.lastDoneOn).toBe(
      "2025-02-28",
    );
  });

  test("evidence-check library is off by default and opt-in", async () => {
    const off = await call<EvidenceLibraryResult>("preventiveCare/library", {});
    expect(off.body).toMatchObject({ enabled: false, entries: [] });
    await call("preventiveCare/settings/update", { libraryEnabled: true });
    const on = await call<EvidenceLibraryResult>("preventiveCare/library", {});
    expect(on.body.enabled).toBe(true);
    expect(on.body.entries.length).toBeGreaterThan(5);
    const viewer = await call<EvidenceLibraryResult>("preventiveCare/library", {}, "user-v");
    expect(viewer.body.entries).toEqual([]);
  });

  test("reminders: nothing without the per-item opt-in and a channel opt-in", async () => {
    await call("insights/pushDevices/register", {
      token: "ExponentPushToken[synthetic-token-97]",
      platform: "ios",
    });
    await call("preventiveCare/updateItem", {
      itemId: "us.breast_screening",
      nextOn: daysFromToday(-1),
    });
    await call("insights/preferences/update", { push: { enabled: true }, deliveryHour: 0 });
    const run = await runCron();
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ remindersPushSent: 0 });
    expect(pushes).toHaveLength(0);
  });

  test("reminders: nothing while the preventive care module is hidden (onboarding stage 1)", async () => {
    await call("preventiveCare/updateItem", { itemId: "us.breast_screening", remind: true });
    await db.execute(
      sql`update wellness_profile set enabled_modules = array['sleep']::text[] where user_id = 'user-a'`,
    );
    try {
      expect((await runCron()).body).toMatchObject({ remindersPushSent: 0 });
      expect(pushes).toHaveLength(0);
    } finally {
      await db.execute(
        sql`update wellness_profile set enabled_modules = null where user_id = 'user-a'`,
      );
    }
  });

  test("reminders: one generic push via the #92 channel, never twice, sharing the daily limit", async () => {
    await call("preventiveCare/updateItem", { itemId: "us.breast_screening", remind: true });
    await call("insights/preferences/update", { channels: { reminder: { push: false } } });
    expect((await runCron()).body).toMatchObject({ remindersPushSent: 0 });
    await call("insights/preferences/update", { channels: { reminder: { push: true } } });

    const sent = await runCron();
    expect(sent.body).toMatchObject({ remindersPushSent: 1 });
    expect(pushes).toEqual([
      {
        to: ["ExponentPushToken[synthetic-token-97]"],
        title: "OpenValens",
        body: "You have a reminder",
        path: "/preventive-care",
      },
    ]);
    expect(JSON.stringify(pushes[0])).not.toMatch(/breast|screen|cancer|\d{4}-\d{2}-\d{2}/i);

    expect((await runCron()).body).toMatchObject({ remindersPushSent: 0 });
    expect(pushes).toHaveLength(1);

    // A second date reached the same day waits: one push a day in total.
    await call("preventiveCare/updateItem", {
      itemId: "us.blood_pressure_screening",
      nextOn: TODAY,
      remind: true,
    });
    expect((await runCron()).body).toMatchObject({ remindersPushSent: 0 });
    expect(pushes).toHaveLength(1);

    const rows = (
      await db.execute<{ insight_ids: string[]; rule_versions: string[] }>(
        sql`select insight_ids, rule_versions from insight_delivery where user_id = 'user-a' and channel = 'push'`,
      )
    ).rows;
    expect(rows).toEqual([
      {
        insight_ids: [`reminder:us.breast_screening:${daysFromToday(-1)}`],
        rule_versions: ["preventive.us.breast_screening@1"],
      },
    ]);
  });

  test("reminders: 'decided: no' and individual-decision items never remind", async () => {
    const psa = await call<{ data?: { reason?: string } }>("preventiveCare/updateItem", {
      itemId: "us.prostate_psa_55_69",
      nextOn: TODAY,
    });
    expect(psa.status).toBe(400);
    expect(psa.body.data?.reason).toBe("dates_not_allowed");
  });

  test("reminders by email are generic and need the email opt-in", async () => {
    await call("insights/preferences/update", {
      email: { enabled: true, acknowledgement: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION },
    });
    const run = await runCron();
    expect(run.body).toMatchObject({ remindersEmailSent: 1 });
    const email = emails.find((entry) => entry.templateName === "preventive-reminder");
    expect(email?.subject).toBe("You have a reminder in OpenValens");
    expect(`${email?.text}${email?.html}`).not.toMatch(/breast|blood pressure|screening|cancer/i);
    expect(email?.headers?.["List-Unsubscribe"]).toContain("unsubscribe?token=");
  });

  test("reminders go out in the member's saved language (#231)", async () => {
    await db.execute(
      sql`insert into user_preference (user_id, locale) values ('user-a', 'pt-PT') on conflict (user_id) do update set locale = 'pt-PT'`,
    );
    await db.execute(sql`delete from insight_delivery where user_id = 'user-a'`);
    pushes.length = 0;
    emails.length = 0;

    const run = await runCron();
    expect(run.body).toMatchObject({ remindersPushSent: 1, remindersEmailSent: 1 });
    expect(pushes[0]).toMatchObject({ title: "OpenValens", body: "Tem um lembrete" });
    const email = emails.find((entry) => entry.templateName === "preventive-reminder");
    expect(email?.subject).toBe("Tem um lembrete no OpenValens");
    expect(email?.text).toContain("Chegou uma data que definiu no OpenValens.");
    expect(email?.html).toContain('<html lang="pt-PT">');
    expect(`${email?.text}${email?.html}`).not.toMatch(
      /breast|blood pressure|screening|mama|tensão|rastreio|cancro/i,
    );

    await db.execute(sql`delete from user_preference where user_id = 'user-a'`);
  });

  test("logs and delivery records carry no answers, dates or addresses", async () => {
    const all = logged
      .join("")
      // The pack version is itself a date label (not a person's date), so drop it first.
      .replace(/"packVersion":"[^"]*"/g, "");
    expect(all).not.toContain("prefer_not_to_say");
    expect(all).not.toContain("2025-02-28");
    expect(all).not.toContain(daysFromToday(-1));
    expect(all).not.toContain("user-a@example.test");
    expect(all).not.toContain("ExponentPushToken");
    const records = await db.execute(sql`select * from insight_delivery`);
    expect(JSON.stringify(records.rows)).not.toContain("2025-02-28");
  });

  test("removing the member removes their preventive-care rows", async () => {
    await db.execute(
      sql`insert into member (id, organization_id, user_id, role) values ('m-b-in-a', 'org-a', 'user-b', 'viewer')`,
    );
    await db.execute(
      sql`insert into preventive_care_setting (organization_id, user_id, library_enabled) values ('org-a', 'user-b', true)`,
    );
    await db.execute(sql`delete from member where id = 'm-b-in-a'`);
    const rows = await db.execute(
      sql`select 1 from preventive_care_setting where organization_id = 'org-a' and user_id = 'user-b'`,
    );
    expect(rows.rows).toHaveLength(0);
  });
});
