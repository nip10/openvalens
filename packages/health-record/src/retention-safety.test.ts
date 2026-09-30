import { expect, test } from "bun:test";
import { buildRetentionWindow, policyForMetric, RetentionPolicyRequiredError } from "./recurrence";

// The anchovy source only expires raw ingest payloads. Canonical clinical
// history must never be pruned by an implicit default window.
test("clinical retention helpers never invent default days", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  for (const metricCode of ["weight", "height", "blood_marker_glucose", "sleep_session"]) {
    expect(() => buildRetentionWindow({ metricCode, now, timezone: "UTC" } as never)).toThrow(
      RetentionPolicyRequiredError,
    );
    expect(policyForMetric({ metricCode }).retentionDays).toBeNull();
  }
});
