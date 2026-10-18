import { readdir } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { clearRegisteredAuth, setRegisteredAuth, type Auth } from "@openvalens/auth";
import { createDb, sql, type Database } from "@openvalens/db";
import { RPCHandler } from "@orpc/server/fetch";

import type { Context } from "../context";
import type {
  AcceptProposalOutput,
  DismissProposalOutput,
  EnergyEstimateOutput,
  EnergyProposalWire,
  ProposeOutput,
} from "../contracts/energy-estimate";
import { appRouter } from "./index";

/**
 * `nutritionEnergy.*` over HTTP (oRPC `RPCHandler`) against a disposable
 * PostgreSQL (Issue #76). Intake and weights are synthetic rows in the
 * existing diary (#77/#79) and canonical daily weight (#87) tables. Covers:
 * the transparent estimate, missing days never counted as zero, no estimate
 * on insufficient data, adults only, proposals that change the energy goal
 * only on explicit accept, dismiss, re-checks, isolation and permissions.
 */

const url = process.env.NUTRITION_ENERGY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/nutrition_energy_test"
  )
    throw new Error("Empty disposable loopback nutrition_energy_test database required.");
}

async function migrate(db: Database): Promise<void> {
  const root = new URL("../../../db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

/**
 * A and A2 share org-a; B owns org-b; U (declared under 18) owns org-u;
 * R is in org-a without weight access; N (no profile answer) owns org-n.
 */
const MEMBERS: Record<string, { org: string; role: string }> = {
  "user-a": { org: "org-a", role: "owner" },
  "user-a2": { org: "org-a", role: "collaborator" },
  "user-b": { org: "org-b", role: "owner" },
  "user-u": { org: "org-u", role: "owner" },
  "user-r": { org: "org-a", role: "collaborator" },
  "user-n": { org: "org-n", role: "owner" },
};
const NO_WEIGHT_READ = new Set(["user-r"]);

function actorOf(headers: Headers): string {
  return headers.get("x-test-user") ?? "user-a";
}

const fakeAuth = {
  api: {
    getSession: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      if (!MEMBERS[id]) return null;
      return {
        user: { id, email: `${id}@example.test`, name: null },
        session: {
          id: `s-${id}`,
          userId: id,
          activeOrganizationId: MEMBERS[id]!.org,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      };
    },
    getActiveMember: async ({ headers }: { headers: Headers }) => {
      const id = actorOf(headers);
      if (!MEMBERS[id]) return null;
      return {
        id: `m-${id}`,
        userId: id,
        organizationId: MEMBERS[id]!.org,
        role: MEMBERS[id]!.role,
      };
    },
    getActiveMemberRole: async ({ headers }: { headers: Headers }) => ({
      role: MEMBERS[actorOf(headers)]?.role,
    }),
    hasPermission: async ({
      headers,
      body,
    }: {
      headers: Headers;
      body: { permissions: Record<string, string[]> };
    }) => {
      const denied = NO_WEIGHT_READ.has(actorOf(headers)) && "weight" in body.permissions;
      return { success: !denied };
    },
  },
} as unknown as Auth;

/** Synthetic intake and weights for one member over 2026-03-01 … 2026-03-28. */
function seedMember(org: string, userId: string): string {
  return `
    insert into nutrition_food_snapshot (organization_id, source, name, nutrient_basis_amount, nutrient_basis_unit, energy_kcal, content_hash)
      values ('${org}', 'manual', 'Synthetic plate', 100, 'g', 2400, 'plate-${org}'),
             ('${org}', 'manual', 'Synthetic drink', 100, 'ml', null, 'drink-${org}');
    insert into nutrition_meal (organization_id, user_id, local_date, time_zone, slot)
      select '${org}', '${userId}', to_char(d, 'YYYY-MM-DD'), 'UTC', 'lunch'
      from generate_series('2026-03-01'::date, '2026-03-28'::date, interval '1 day') d;
    -- 2400 kcal every day; 2026-03-10 holds a partial 900 kcal and is not marked complete.
    insert into nutrition_meal_entry (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method)
      select '${org}', '${userId}', m.id, s.id, 100, 'g',
             case when m.local_date = '2026-03-10' then 0.375 else 1 end, 'manual'
      from nutrition_meal m join nutrition_food_snapshot s
        on s.organization_id = m.organization_id and s.content_hash = 'plate-${org}'
      where m.organization_id = '${org}' and m.user_id = '${userId}';
    -- 2026-03-12 also has a drink whose energy is not known: the day is left out.
    insert into nutrition_meal_entry (organization_id, user_id, meal_id, snapshot_id, amount, unit, nutrient_factor, method)
      select '${org}', '${userId}', m.id, s.id, 250, 'ml', 2.5, 'manual'
      from nutrition_meal m join nutrition_food_snapshot s
        on s.organization_id = m.organization_id and s.content_hash = 'drink-${org}'
      where m.organization_id = '${org}' and m.user_id = '${userId}' and m.local_date = '2026-03-12';
    insert into nutrition_diary_day (organization_id, user_id, local_date, completed_at)
      select '${org}', '${userId}', to_char(d, 'YYYY-MM-DD'), now()
      from generate_series('2026-03-01'::date, '2026-03-28'::date, interval '1 day') d
      where d <> '2026-03-10'::date;
    -- Weight falls linearly from 80 kg by 1 kg over 27 days.
    insert into daily_weight (organization_id, user_id, date, weight_kg, source, created_at, updated_at)
      select '${org}', '${userId}', to_char('2026-03-01'::date + i, 'YYYY-MM-DD'), 80 - i / 27.0, 'auto',
             '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'
      from generate_series(0, 27) i;
  `;
}

describe.skipIf(!url)("nutritionEnergy over HTTP against disposable PostgreSQL", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://127.0.0.1/nutrition_energy_test" });
  const rpc = new RPCHandler(appRouter);

  function contextFor(headers: Headers): Context {
    const id = actorOf(headers);
    return {
      session: MEMBERS[id]
        ? {
            user: { id },
            session: {
              id: `s-${id}`,
              activeOrganizationId: MEMBERS[id]!.org,
              expiresAt: new Date(Date.now() + 3_600_000),
              impersonatedBy: headers.get("x-test-impersonated") ?? undefined,
            },
          }
        : null,
      db,
      correlationId: "corr-76",
      cronSecret: "cron-secret-long-enough-value",
      betterAuthSecretConfigured: true,
      capabilities: { telegram: false, anthropic: false, resend: false, mobilePairing: true },
      telegram: { webhookSecret: "webhook-secret-value", connectTokenTtlSeconds: 600 },
      telegramClient: null,
      aiConfig: {} as never,
      aiRateLimiter: { check: () => ({ allowed: true }) } as never,
      honoContext: { req: { raw: { headers } } },
    } as unknown as Context;
  }

  async function call<T = Record<string, unknown>>(
    procedure: string,
    input: unknown,
    user = "user-a",
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const headers = new Headers({
      "content-type": "application/json",
      "x-test-user": user,
      ...extraHeaders,
    });
    const request = new Request(`http://test.local/rpc/nutritionEnergy/${procedure}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ json: input }),
    });
    const { matched, response } = await rpc.handle(request, {
      prefix: "/rpc",
      context: contextFor(headers),
    });
    if (!matched || !response) throw new Error("unmatched RPC path");
    const parsed = (await response.json()) as { json: T };
    return { status: response.status, body: parsed.json };
  }

  const estimate = (to: string, user = "user-a") =>
    call<EnergyEstimateOutput>("estimate", { to }, user);
  const propose = (to: string, user = "user-a") => call<ProposeOutput>("propose", { to }, user);
  const accept = (proposalId: number, user = "user-a", headers: Record<string, string> = {}) =>
    call<AcceptProposalOutput>("acceptProposal", { proposalId }, user, headers);
  const dismiss = (proposalId: number, user = "user-a") =>
    call<DismissProposalOutput>("dismissProposal", { proposalId }, user);
  const list = (user = "user-a") =>
    call<{ proposals: EnergyProposalWire[] }>("listProposals", {}, user);

  const energyGoals = async (userId: string) =>
    (
      await db.execute(
        sql`select min_amount, max_amount, archived_at is null as active from nutrition_goal
            where user_id = ${userId} and nutrient = 'energy_kcal' order by id`,
      )
    ).rows as { min_amount: number; max_amount: number; active: boolean }[];

  beforeAll(async () => {
    const tables = await db.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    if (tables.rows.length) throw new Error("Integration database must be empty.");
    await migrate(db);
    const users = Object.keys(MEMBERS);
    await db.execute(
      sql.raw(`
      insert into "user" (id, email) values ${users.map((id) => `('${id}', '${id}@example.test')`).join(", ")};
      insert into organization (id, name, slug) values
        ('org-a', 'Record A', 'record-a'), ('org-b', 'Record B', 'record-b'),
        ('org-u', 'Record U', 'record-u'), ('org-n', 'Record N', 'record-n');
      insert into member (id, organization_id, user_id, role) values
        ${users.map((id) => `('m-${id}', '${MEMBERS[id]!.org}', '${id}', '${MEMBERS[id]!.role}')`).join(", ")};
      insert into wellness_profile (user_id, revision, eligibility_state, eligibility) values
        ('user-a', 1, 'recorded', 'adult'), ('user-a2', 1, 'recorded', 'adult'),
        ('user-b', 1, 'recorded', 'adult'), ('user-r', 1, 'recorded', 'adult'),
        ('user-u', 1, 'recorded', 'under_18');
      ${seedMember("org-a", "user-a")}
      ${seedMember("org-b", "user-b")}
      ${seedMember("org-u", "user-u")}
      ${seedMember("org-n", "user-n")}
    `),
    );
    setRegisteredAuth(fakeAuth);
  });

  afterAll(() => clearRegisteredAuth());

  test("transparent estimate: inputs, window, formula, constant and range", async () => {
    const result = await estimate("2026-03-28");
    expect(result.status).toBe(200);
    const body = result.body;
    if (body.status !== "estimated") throw new Error(`expected an estimate, got ${body.status}`);
    expect(body.experimental).toBe(true);
    expect(body.window).toEqual({ from: "2026-03-01", to: "2026-03-28", days: 28 });
    expect(body.method).toMatchObject({ id: "energy_balance", version: 1 });
    expect(body.formula).toContain("7,700 kcal/kg");
    expect(body.energyDensity.valueKcalPerKg).toBe(7700);
    expect(body.inputs.activity).toBe("not_used");
    // Missing and partly known days are left out, never counted as zero.
    expect(body.inputs.intake).toMatchObject({
      usedDays: 26,
      notMarkedCompleteDays: 1,
      energyNotKnownDays: 1,
      meanKcal: 2400,
    });
    expect(body.inputs.intake.days.find((d) => d.localDate === "2026-03-10")).toEqual({
      localDate: "2026-03-10",
      use: "not_marked_complete",
      energyKcal: null,
    });
    expect(body.inputs.weight.change).toEqual({
      from: "2026-03-03",
      to: "2026-03-28",
      days: 25,
      kg: -0.9,
    });
    // 2400 + 0.9 × 7700 / 25 = 2677.2
    expect(body.estimate!.kcalPerDay).toBe(2680);
    expect(body.estimate!.range.lowKcal).toBeLessThan(2680);
    expect(body.estimate!.range.highKcal).toBeGreaterThan(2680);
    expect(body.reasons).toEqual([]);
  });

  test("insufficient data returns no estimate with every reason", async () => {
    const result = await estimate("2026-03-14");
    expect(result.status).toBe(200);
    if (result.body.status !== "no_estimate") throw new Error("expected no estimate");
    expect(result.body.estimate).toBeNull();
    // 2026-02-15 … 2026-03-14: only 14 days logged (12 usable) and 14 days without weights.
    expect(result.body.reasons).toEqual([
      "not_enough_complete_days",
      "weight_change_too_short",
      "weight_gap_too_long",
    ]);
    expect(result.body.reasonNotes).toHaveLength(3);

    const empty = await estimate("2026-05-28");
    if (empty.body.status !== "no_estimate") throw new Error("expected no estimate");
    expect(empty.body.inputs.intake.meanKcal).toBeNull();
  });

  test("reading the estimate writes nothing", async () => {
    const before = await db.execute(
      sql`select (select count(*) from nutrition_energy_proposal)::int as p, (select count(*) from nutrition_goal)::int as g`,
    );
    await estimate("2026-03-28");
    await estimate("2026-03-14");
    const after = await db.execute(
      sql`select (select count(*) from nutrition_energy_proposal)::int as p, (select count(*) from nutrition_goal)::int as g`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  test("adults only: declared under 18 or not answered gets nothing", async () => {
    for (const user of ["user-u", "user-n"]) {
      const result = await estimate("2026-03-28", user);
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ status: "adults_only", experimental: true });
      expect(JSON.stringify(result.body)).not.toContain("2400");
      expect((await propose("2026-03-28", user)).body).toMatchObject({
        outcome: "declined",
        reason: "adults_only",
      });
    }
    const rows = await db.execute(
      sql`select count(*)::int as n from nutrition_energy_proposal where user_id in ('user-u', 'user-n')`,
    );
    expect(rows.rows[0]).toEqual({ n: 0 });
  });

  test("a proposal never changes the goal; only an explicit accept does", async () => {
    const first = await propose("2026-03-28");
    expect(first.status).toBe(200);
    if (first.body.outcome !== "proposed") throw new Error("expected a proposal");
    expect(first.body.proposal).toMatchObject({
      kind: "maintenance",
      status: "pending",
      estimateKcal: 2680,
      targetKcal: 2700,
      currentTargetKcal: null,
      policyVersion: "nutrition-safety/v1",
      expired: false,
      window: { from: "2026-03-01", to: "2026-03-28" },
    });
    expect(first.body.proposal.estimate.inputs.intake.usedDays).toBe(26);
    expect(await energyGoals("user-a")).toEqual([]);

    // Asking again replaces the pending one; the old one can no longer be accepted.
    const second = await propose("2026-03-28");
    if (second.body.outcome !== "proposed") throw new Error("expected a proposal");
    const listed = await list();
    expect(listed.body.proposals.map((p) => [p.id, p.status])).toEqual([
      [second.body.proposal.id, "pending"],
      [first.body.proposal.id, "superseded"],
    ]);
    const stale = await accept(first.body.proposal.id);
    expect(stale.body).toMatchObject({ outcome: "declined", reason: "not_pending" });
    expect(await energyGoals("user-a")).toEqual([]);

    // Other members, other workspaces and impersonated sessions cannot decide it.
    expect((await accept(second.body.proposal.id, "user-a2")).status).toBe(404);
    expect((await accept(second.body.proposal.id, "user-b")).status).toBe(404);
    expect((await dismiss(second.body.proposal.id, "user-b")).status).toBe(404);
    expect(
      (await accept(second.body.proposal.id, "user-a", { "x-test-impersonated": "admin-1" }))
        .status,
    ).toBe(403);
    expect((await list("user-a2")).body.proposals).toEqual([]);
    expect(await energyGoals("user-a")).toEqual([]);

    const accepted = await accept(second.body.proposal.id);
    expect(accepted.status).toBe(200);
    if (accepted.body.outcome !== "accepted") throw new Error("expected accepted");
    expect(accepted.body.goal).toMatchObject({
      nutrient: "energy_kcal",
      minAmount: 2700,
      maxAmount: 2700,
    });
    expect(accepted.body.proposal).toMatchObject({
      status: "accepted",
      acceptedGoalId: accepted.body.goal.id,
    });
    expect(await energyGoals("user-a")).toEqual([
      { min_amount: 2700, max_amount: 2700, active: true },
    ]);

    // Accepting twice does nothing; a new proposal waits for the weekly step.
    expect((await accept(second.body.proposal.id)).body).toMatchObject({
      outcome: "declined",
      reason: "not_pending",
    });
    expect((await propose("2026-03-28")).body).toMatchObject({
      outcome: "declined",
      reason: "recently_changed",
    });

    const audit = await db.execute(
      sql`select event_type, target_type, target_id from access_audit_log
          where target_type = 'nutrition_energy_proposal' and actor_user_id = 'user-a'
          order by created_at, id`,
    );
    expect(audit.rows).toContainEqual({
      event_type: "RECORD_UPDATED",
      target_type: "nutrition_energy_proposal",
      target_id: String(second.body.proposal.id),
    });
  });

  test("dismiss leaves the goal unchanged; a changed target blocks a stale accept", async () => {
    const proposed = await propose("2026-03-28", "user-b");
    if (proposed.body.outcome !== "proposed") throw new Error("expected a proposal");
    const dismissed = await dismiss(proposed.body.proposal.id, "user-b");
    expect(dismissed.body).toMatchObject({
      outcome: "dismissed",
      proposal: { status: "dismissed" },
    });
    expect((await dismiss(proposed.body.proposal.id, "user-b")).body).toMatchObject({
      outcome: "declined",
      reason: "not_pending",
    });
    expect(await energyGoals("user-b")).toEqual([]);

    const again = await propose("2026-03-28", "user-b");
    if (again.body.outcome !== "proposed") throw new Error("expected a proposal");
    // The member sets their own target meanwhile.
    await db.execute(
      sql`insert into nutrition_goal (organization_id, user_id, nutrient, min_amount, max_amount)
          values ('org-b', 'user-b', 'energy_kcal', 2000, 2000)`,
    );
    expect((await accept(again.body.proposal.id, "user-b")).body).toMatchObject({
      outcome: "declined",
      reason: "target_changed",
    });
    expect(await energyGoals("user-b")).toEqual([
      { min_amount: 2000, max_amount: 2000, active: true },
    ]);

    // The member has not chosen "lose"; a target still below the estimate
    // cannot be proposed as a maintenance step, even while moving upward.
    const stepped = await propose("2026-03-28", "user-b");
    expect(stepped.body).toMatchObject({
      outcome: "declined",
      reason: "not_suggested_for_profile",
    });
  });

  test("permissions, strict inputs and invalid windows", async () => {
    expect((await estimate("2026-03-28", "user-r")).status).toBe(403);
    expect((await propose("2026-03-28", "user-r")).status).toBe(403);
    expect((await estimate("2026-03-28", "anonymous")).status).toBe(401);
    for (const input of [
      { to: "2026-03-28", organizationId: "org-b" },
      { to: "2026-03-28", userId: "user-b" },
      { to: "2026-03-28", intakeKcal: 1500 },
    ])
      expect((await call("estimate", input)).status).toBe(400);
    expect((await call("acceptProposal", { proposalId: 1, targetKcal: 900 })).status).toBe(400);
    for (const to of ["2026-02-30", "2999-01-01"]) {
      const result = await estimate(to);
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: "INVALID_INPUT" });
    }
    expect((await accept(999_999)).status).toBe(404);
  });
});
