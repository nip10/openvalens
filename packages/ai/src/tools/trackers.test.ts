import { describe, expect, test } from "bun:test";

import { executeTrackers, buildTrackersSummary } from "./trackers";
import {
  createConsentDb,
  createFakeSources,
  FIXED_NOW,
  FULL_CONSENT,
  ORG_A,
  USER_A,
} from "./test-fixtures";

const sauna = {
  id: "t-1",
  name: "Sauna",
  template: "sauna" as const,
  type: "duration" as const,
  unit: null,
  decimals: 0,
  aggregation: "sum" as const,
  target: { value: 1200, period: "day" as const },
  days: [
    { date: "2026-03-10", value: 1800, count: 2 },
    { date: "2026-03-08", value: 600, count: 1 },
  ],
};
const energy = {
  ...sauna,
  id: "t-2",
  name: "Energy",
  template: "energy" as const,
  type: "scale" as const,
  aggregation: "average" as const,
  target: null,
  days: [{ date: "2026-03-10", value: 3.5, count: 2 }],
};

describe("trackers tool", () => {
  test("reports durations in minutes and self-ratings as recorded", () => {
    const result = buildTrackersSummary(
      [sauna, energy],
      { days: 30, from: "2026-02-09", to: "2026-03-10" },
      FIXED_NOW,
    );
    expect(result).toMatchObject({
      status: "ok",
      trackers: [
        {
          name: "Sauna",
          kind: "duration in minutes",
          target: { value: 20, per: "day" },
          loggedDays: 2,
          total: 40,
          average: 20,
          days: [
            { date: "2026-03-10", value: 30 },
            { date: "2026-03-08", value: 10 },
          ],
        },
        { name: "Energy", kind: "self-rating from 1 (low) to 5 (high)", total: null, average: 3.5 },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/score|screen/i);
  });

  test("says when nothing is shared with the Coach", () => {
    expect(buildTrackersSummary([], { days: 30, from: "a", to: "b" }, FIXED_NOW)).toMatchObject({
      status: "no_data",
    });
  });

  test("asks the port only for the bound member and organization", async () => {
    const { sources, calls } = createFakeSources({ [ORG_A]: { trackers: [sauna] } });
    const result = await executeTrackers(
      {
        db: createConsentDb(FULL_CONSENT),
        organizationId: ORG_A,
        userId: USER_A,
        canReadRecords: async () => true,
        sources,
        now: () => FIXED_NOW,
      },
      { days: 7 },
    );
    expect(result.status).toBe("ok");
    expect(calls).toEqual([{ port: "listAiTrackers", organizationId: ORG_A }]);
  });

  test("is unavailable without records access", async () => {
    const { sources } = createFakeSources({});
    const result = await executeTrackers(
      {
        db: createConsentDb(FULL_CONSENT),
        organizationId: ORG_A,
        userId: USER_A,
        canReadRecords: async () => false,
        sources,
        now: () => FIXED_NOW,
      },
      {},
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "permission_denied" });
  });
});
