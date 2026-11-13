import { describe, expect, test } from "bun:test";

import { buildPainSummary, executePain } from "./pain";
import {
  createConsentDb,
  createFakeSources,
  FIXED_NOW,
  FULL_CONSENT,
  ORG_A,
  USER_A,
} from "./test-fixtures";

const knee = {
  region: "joint.knee_left",
  rating: 4,
  type: "ache" as const,
  loggedAt: "2026-03-10T08:00:00.000Z",
  localDate: "2026-03-10",
};

function context(overrides: Record<string, unknown> = {}) {
  const { sources, calls } = createFakeSources({ [ORG_A]: { pain: [knee] } });
  return {
    calls,
    context: {
      db: createConsentDb(FULL_CONSENT),
      organizationId: ORG_A,
      userId: USER_A,
      canReadRecords: async () => true,
      sources,
      now: () => FIXED_NOW,
      trustedSelf: true,
      ...overrides,
    },
  };
}

describe("pain tool", () => {
  test("reports the region by name and the rating as recorded", () => {
    const result = buildPainSummary(
      [knee],
      { days: 30, from: "2026-02-09", to: "2026-03-11" },
      FIXED_NOW,
    );
    expect(result).toMatchObject({
      status: "ok",
      entries: [{ region: "Left knee", rating: 4, outOf: 10, type: "ache", date: "2026-03-10" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/likely|caused by|because of|injur|condition:/i);
  });

  test("says when nothing is shared with the Coach", () => {
    expect(buildPainSummary([], { days: 30, from: "a", to: "b" }, FIXED_NOW)).toMatchObject({
      status: "no_data",
    });
  });

  test("asks the port only for the bound member and organization", async () => {
    const { context: ctx, calls } = context();
    const result = await executePain(ctx, { days: 7 });
    expect(result.status).toBe("ok");
    expect(calls).toEqual([{ port: "listAiPain", organizationId: ORG_A }]);
  });

  test("is unavailable outside the member's own session (impersonation)", async () => {
    for (const trustedSelf of [false, undefined]) {
      const { context: ctx, calls } = context({ trustedSelf });
      expect(await executePain(ctx, {})).toMatchObject({
        status: "unavailable",
        reason: "permission_denied",
      });
      expect(calls).toEqual([]);
    }
  });

  test("is unavailable without records access", async () => {
    const { context: ctx } = context({ canReadRecords: async () => false });
    expect(await executePain(ctx, {})).toMatchObject({
      status: "unavailable",
      reason: "permission_denied",
    });
  });
});
