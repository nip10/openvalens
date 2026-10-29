import { describe, expect, test } from "bun:test";
import type { BillingService } from "@openvalens/billing";

import type { Context } from "../context";
import { appRouter } from "./index";

/** Issue #298 — `access.status`, the plan-neutral state the apps read. */

function context(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      user: { id: "user-1" },
      session: { id: "s-1", activeOrganizationId: "org-owner" },
    },
    db: {},
    correlationId: "corr-1",
    honoContext: { req: { raw: { headers: new Headers() } } },
    ...overrides,
  } as unknown as Context;
}

describe("access.status", () => {
  test("self-host: always full access, without resolving a plan", async () => {
    const billing = {
      resolveAccess: async () => {
        throw new Error("not on self-host");
      },
    } as unknown as BillingService;
    const result = await appRouter.access.status.callable({
      context: context({ billing, deployment: { mode: "self-hosted" } }),
    })({});
    expect(result).toEqual({
      mode: "self-hosted",
      level: "full",
      state: null,
      graceEndsAt: null,
      viewer: "owner",
      ownerName: null,
    });
  });

  test("cloud: the active workspace's state, with no price or plan", async () => {
    const calls: unknown[] = [];
    const billing = {
      resolveAccess: async (input: unknown) => {
        calls.push(input);
        return {
          level: "read_only",
          status: "ended",
          graceEndsAt: null,
          viewerIsOwner: false,
          ownerName: "Ana",
        };
      },
    } as unknown as BillingService;
    // Routed as the RPC handler does; `always`, so it answers while read-only.
    const result = await appRouter.access.status.callable({
      context: context({ billing, deployment: { mode: "cloud" } }),
      path: ["access", "status"],
    })({});
    expect(result).toEqual({
      mode: "cloud",
      level: "read_only",
      state: "ended",
      graceEndsAt: null,
      viewer: "member",
      ownerName: "Ana",
    });
    expect(calls).toEqual([{ userId: "user-1", organizationId: "org-owner" }]);
  });

  test("signed out is refused", async () => {
    await expect(
      appRouter.access.status.callable({ context: context({ session: null }) })({}),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
