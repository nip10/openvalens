import { describe, expect, test } from "bun:test";
import type { BillingService, WorkspaceAccess } from "@openvalens/billing";
import { accessState, DAY_MS, type AccessInput } from "@openvalens/billing/entitlement";
import { call, isProcedure } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import {
  allowedWhenReadOnly,
  PROCEDURE_ACCESS,
  procedureAccessClass,
  type ProcedureAccessClass,
} from "./access-policy";
import type { Context } from "./context";
import { protectedProcedure, requireActiveAccess } from "./index";
import { appRouter } from "./routers/index";

/**
 * Issue #298 — the entitlement check and the read/write classification of
 * every procedure. The router walk below is what keeps the classification
 * complete: a new procedure fails this test until it is given a class.
 */

function procedurePaths(node: unknown, path: string[] = [], out: string[] = []): string[] {
  if (isProcedure(node)) {
    out.push(path.join("."));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) procedurePaths(child, [...path, key], out);
  }
  return out;
}

describe("procedure classification", () => {
  const paths = procedurePaths(appRouter);

  test("the walk finds the whole router", () => {
    expect(paths.length).toBeGreaterThan(200);
    expect(paths).toContain("plans.workouts.upsertWorkout");
  });

  test("every procedure has an explicit class (add new ones to access-policy.ts)", () => {
    const unclassified = paths.filter((path) => !(path in PROCEDURE_ACCESS));
    expect(unclassified).toEqual([]);
  });

  test("the policy lists no procedure that no longer exists", () => {
    const known = new Set(paths);
    expect(Object.keys(PROCEDURE_ACCESS).filter((path) => !known.has(path))).toEqual([]);
  });

  test("an unlisted procedure is a write (default deny)", () => {
    expect(procedureAccessClass(["somethingNew", "doIt"])).toBe("write");
    expect(allowedWhenReadOnly(procedureAccessClass(["somethingNew", "doIt"]))).toBe(false);
  });

  test("data rights, exports, billing and the access state are always available", () => {
    for (const path of [
      "dataRights.deletionPreview",
      "dataRights.deleteEverything",
      "exports.clinicalBundle",
      "exports.legacyDownload",
      "exports.legacyPdfDownload",
      "billing.status",
      "billing.checkout",
      "billing.portal",
      "access.status",
      "ai.consent.revoke",
      "sharing.removeMember",
    ]) {
      expect(PROCEDURE_ACCESS[path]).toBe("always");
    }
  });

  test("the AI coach and phone sync are not available read-only", () => {
    for (const path of ["ai.chat", "ai.extract", "ai.generateInsight"]) {
      expect(PROCEDURE_ACCESS[path]).toBe("ai");
    }
    for (const path of [
      "mobile.ingestBatch",
      "mobile.registerDevice",
      "sleep.recordFromHealthConnect",
    ]) {
      expect(PROCEDURE_ACCESS[path]).toBe("write");
    }
  });

  test("procedures named like writes are never classified as reads", () => {
    const writeVerb =
      /^\.(create|update|upsert|delete|set|log|write|ingest|record|register|add|change|copy|archive|restore|propose|accept|dismiss|declare|grant|enable|import|undo|upload|connect|resolve|run|request|issue|rate|start)([A-Z].*)?$/;
    const suspicious = Object.entries(PROCEDURE_ACCESS)
      .filter(([path, cls]) => cls === "read" && writeVerb.test(`.${path.split(".").at(-1)}`))
      .map(([path]) => path);
    // Reviewed exceptions: these only read despite their name.
    expect(suspicious.sort()).toEqual(
      ["healthRecord.resolveCanonicalMetric", "plans.routines.startPreview"].sort(),
    );
  });
});

const NOW = new Date("2026-11-10T12:00:00.000Z");
const GRACE_MS = 7 * DAY_MS;

type Row = AccessInput | null;

function row(overrides: Partial<AccessInput>): AccessInput {
  return {
    status: "active",
    trialEndsAt: new Date("2026-10-01T00:00:00.000Z"),
    stripeSubscriptionId: "sub_1",
    pastDueSince: null,
    ...overrides,
  };
}

/** A billing service whose access comes from the real entitlement rules. */
function billingFor(owner: Row, options: { viewerIsOwner?: boolean } = {}) {
  const calls: unknown[] = [];
  const service = {
    resolveAccess: async (input: { userId: string; organizationId: string | null }) => {
      calls.push(input);
      const state = accessState(owner, NOW, GRACE_MS);
      return {
        level: state.level,
        status: state.status,
        graceEndsAt: state.graceEndsAt,
        viewerIsOwner: options.viewerIsOwner ?? true,
        ownerName: options.viewerIsOwner === false ? "Ana" : null,
      } satisfies WorkspaceAccess;
    },
  } as unknown as BillingService;
  return { service, calls };
}

function context(overrides: Partial<Context> & Record<string, unknown> = {}): Context {
  return {
    session: {
      user: { id: "user-1" },
      session: { id: "s-1", activeOrganizationId: "org-1" },
    },
    db: {},
    correlationId: "corr-1",
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  } as unknown as Context;
}

const cloud = { mode: "cloud" } as Context["deployment"];
const probe = protectedProcedure.handler(() => "ran");

async function run(ctx: Context, path: string): Promise<string> {
  return call(probe, undefined, { context: ctx, path: path.split(".") });
}

const SAMPLES: Record<ProcedureAccessClass, string> = {
  read: "nutritionDiary.getDay",
  write: "nutritionDiary.logEntry",
  ai: "ai.chat",
  always: "exports.legacyDownload",
};

describe("requireActiveAccess", () => {
  test("self-host never resolves a plan: every class runs", async () => {
    const throwing = {
      resolveAccess: async () => {
        throw new Error("self-host must not call the entitlement check");
      },
    } as unknown as BillingService;
    for (const deployment of [undefined, { mode: "self-hosted" } as Context["deployment"]]) {
      for (const path of Object.values(SAMPLES)) {
        expect(await run(context({ deployment, billing: throwing }), path)).toBe("ran");
      }
    }
  });

  const states: { name: string; owner: Row; writes: boolean }[] = [
    {
      name: "trialing",
      owner: row({
        status: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: new Date("2026-11-20T00:00:00.000Z"),
      }),
      writes: true,
    },
    { name: "active", owner: row({ status: "active" }), writes: true },
    { name: "active, cancelling at period end", owner: row({ status: "active" }), writes: true },
    {
      name: "past_due within grace",
      owner: row({ status: "past_due", pastDueSince: new Date(NOW.getTime() - 3 * DAY_MS) }),
      writes: true,
    },
    {
      name: "past_due after grace",
      owner: row({ status: "past_due", pastDueSince: new Date(NOW.getTime() - 8 * DAY_MS) }),
      writes: false,
    },
    { name: "canceled", owner: row({ status: "canceled" }), writes: false },
    {
      name: "ended (trial ran out, job recorded it)",
      owner: row({ status: "ended", stripeSubscriptionId: null }),
      writes: false,
    },
    {
      name: "trial ran out before the job ran",
      owner: row({
        status: "trialing",
        stripeSubscriptionId: null,
        trialEndsAt: new Date(NOW.getTime() - 1000),
      }),
      writes: false,
    },
    { name: "no plan at all", owner: null, writes: false },
  ];

  for (const state of states) {
    test(`cloud, ${state.name}: reads and data rights always; writes and AI ${state.writes ? "allowed" : "refused"}`, async () => {
      const { service } = billingFor(state.owner);
      const ctx = context({ deployment: cloud, billing: service });
      expect(await run(ctx, SAMPLES.read)).toBe("ran");
      expect(await run(ctx, SAMPLES.always)).toBe("ran");
      expect(await run(ctx, "dataRights.deleteEverything")).toBe("ran");
      for (const path of [SAMPLES.write, SAMPLES.ai, "mobile.ingestBatch", "unlisted.mutation"]) {
        if (state.writes) expect(await run(ctx, path)).toBe("ran");
        else
          await expect(run(ctx, path)).rejects.toMatchObject({
            code: "ACCESS_READ_ONLY",
            status: 403,
          });
      }
    });
  }

  test("reads never resolve the plan (no query on the read path)", async () => {
    const { service, calls } = billingFor(row({ status: "canceled" }));
    const ctx = context({ deployment: cloud, billing: service });
    await run(ctx, SAMPLES.read);
    await run(ctx, SAMPLES.always);
    expect(calls).toEqual([]);
  });

  test("access is resolved for the active workspace, so members follow its owner", async () => {
    const { service, calls } = billingFor(row({ status: "ended", stripeSubscriptionId: null }), {
      viewerIsOwner: false,
    });
    const ctx = context({ deployment: cloud, billing: service });
    await expect(run(ctx, SAMPLES.write)).rejects.toMatchObject({
      code: "ACCESS_READ_ONLY",
      data: { viewer: "member" },
    });
    expect(calls).toEqual([{ userId: "user-1", organizationId: "org-1" }]);
  });

  test("cloud without a billing service fails closed for writes", async () => {
    const ctx = context({ deployment: cloud, billing: null });
    await expect(run(ctx, SAMPLES.write)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await run(ctx, SAMPLES.read)).toBe("ran");
  });

  test("the function form is the same check", async () => {
    const { service } = billingFor(row({ status: "canceled" }));
    await expect(
      requireActiveAccess({
        context: context({ deployment: cloud, billing: service }),
        path: ["profile", "update"],
      }),
    ).rejects.toMatchObject({ code: "ACCESS_READ_ONLY" });
    await requireActiveAccess({
      context: context({ deployment: cloud, billing: service }),
      path: ["profile", "get"],
    });
  });
});

describe("through the RPC handler (the path comes from the route)", () => {
  const handler = new RPCHandler(appRouter);

  async function post(path: string, ctx: Context) {
    const result = await handler.handle(
      new Request(`http://server.test/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }),
      { prefix: "/rpc", context: ctx },
    );
    if (!result.matched) throw new Error("route not matched");
    return {
      status: result.response.status,
      body: (await result.response.json()) as { json: Record<string, unknown> },
    };
  }

  test("an ended workspace: a write is refused with ACCESS_READ_ONLY, the access state answers", async () => {
    const { service } = billingFor(row({ status: "canceled" }));
    const ctx = context({ deployment: cloud, billing: service });
    const refused = await post("nutritionDiary/logEntry", ctx);
    expect(refused.status).toBe(403);
    expect(refused.body.json).toMatchObject({
      code: "ACCESS_READ_ONLY",
      data: { viewer: "owner" },
    });
    const state = await post("access/status", ctx);
    expect(state.status).toBe(200);
    expect(state.body.json).toMatchObject({ mode: "cloud", level: "read_only", state: "canceled" });
  });
});
