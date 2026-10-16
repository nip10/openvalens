import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_LOAD_ALGORITHM_VERSION,
  computeWeeklyActivityLoad,
  WHO_GUIDELINE_CITATION as ACTIVITY_WHO_CITATION,
} from "@openvalens/activity/load";

import {
  ACTIVITY_LOAD_CONTRACT_VERSION,
  activityLoadResultSchema,
  WHO_GUIDELINE_CITATION,
} from "./activity-load-contract";

/** Issue #99 — the app-safe contract stays in step with `@openvalens/activity`. */
describe("activity load contract", () => {
  test("version and citation mirror the calculation package", () => {
    expect(ACTIVITY_LOAD_CONTRACT_VERSION).toBe(ACTIVITY_LOAD_ALGORITHM_VERSION);
    expect(WHO_GUIDELINE_CITATION).toBe(ACTIVITY_WHO_CITATION);
  });

  test("a computed result parses with the wire schema", () => {
    const load = computeWeeklyActivityLoad({
      asOf: "2026-10-16",
      sessions: [
        {
          ref: "workout:1",
          date: "2026-10-15",
          source: "manual",
          durationMinutes: 45,
          intensity: "vigorous",
          intensityMethod: "self_reported_talk_test",
          effortRating: 7,
          strengthVolumeKg: 1200,
        },
      ],
      steps: [{ date: "2026-10-15", steps: 8000 }],
    });
    const parsed = activityLoadResultSchema.parse({
      kind: "activity_load",
      status: "available",
      withheldReason: null,
      load,
    });
    expect(parsed.load?.activeMinutes.activeMinutes).toBe(90);
    expect(parsed.load?.effort.points).toBe(315);
  });
});
