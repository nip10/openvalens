import { describe, expect, test } from "bun:test";

import { buildV2PolicyInstruction } from "./build-v2-policy-instruction";

describe("coach — buildV2PolicyInstruction", () => {
  test("emits hold / low / blood_data_stale when blood panel is missing", () => {
    const { instruction, state } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: null, markerOutOfRangeCount: 0 },
    });
    expect(state).toMatchObject({ readiness: "hold", confidence: "low" });
    expect(instruction).toMatch(/Readiness: hold/);
    expect(instruction).toMatch(/Confidence: low/);
    expect(instruction).toMatch(/blood_data_stale/);
  });

  test("emits partial readiness with blood data and out-of-range markers", () => {
    const { instruction, state } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: "2026-03-01", markerOutOfRangeCount: 2 },
    });
    expect(state).toMatchObject({ readiness: "partial", confidence: "medium" });
    expect(instruction).toMatch(/Readiness: partial/);
    expect(instruction).toMatch(/Confidence: medium/);
  });

  test("uses the requested template when given", () => {
    const { instruction } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: "2026-03-01", markerOutOfRangeCount: 0 },
      templateId: "performance",
    });
    expect(instruction).toMatch(/Template key: performance/);
  });

  test("falls back to the default template key when none is given", () => {
    const { instruction, templateKey } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: "2026-03-01", markerOutOfRangeCount: 0 },
    });
    expect(templateKey).toBe("default");
    expect(instruction).toMatch(/Template key: default/);
  });

  test("includes the NON-OVERRIDABLE CONSTRAINTS block", () => {
    const { instruction } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: "2026-03-01", markerOutOfRangeCount: 0 },
    });
    expect(instruction).toMatch(/NON-OVERRIDABLE CONSTRAINTS/);
    expect(instruction).toMatch(/Blockers are authoritative/);
  });

  test("adds the LOW-CONFIDENCE UNCERTAINTY DIRECTIVE when confidence is low", () => {
    const { instruction } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: null, markerOutOfRangeCount: 0 },
    });
    expect(instruction).toMatch(/LOW-CONFIDENCE UNCERTAINTY DIRECTIVE/);
    expect(instruction).toMatch(/explicit uncertainty/i);
  });

  test("omits the LOW-CONFIDENCE UNCERTAINTY DIRECTIVE when confidence is medium", () => {
    const { instruction } = buildV2PolicyInstruction({
      inputs: { latestBloodPanelDate: "2026-03-01", markerOutOfRangeCount: 0 },
    });
    expect(instruction).not.toMatch(/LOW-CONFIDENCE UNCERTAINTY DIRECTIVE/);
  });

  test("surfaces the deterministic state snapshot section with sorted blockers", () => {
    const { instruction } = buildV2PolicyInstruction({
      inputs: {
        latestBloodPanelDate: null,
        markerOutOfRangeCount: 1,
        highSleepDebt: true,
      },
    });
    expect(instruction).toMatch(/Deterministic State Snapshot/);
    expect(instruction).toMatch(/- blood_data_stale/);
    expect(instruction).toMatch(/- sleep_debt_high/);
  });
});
