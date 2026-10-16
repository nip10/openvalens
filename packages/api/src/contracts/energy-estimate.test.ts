import { describe, expect, test } from "bun:test";
import {
  computeEnergyEstimate,
  energyEstimateWindow,
  NO_ESTIMATE_REASONS as DOMAIN_NO_ESTIMATE_REASONS,
  PROPOSAL_DECLINE_REASONS as DOMAIN_DECLINE_REASONS,
} from "@openvalens/nutrition";

import { presentEstimate } from "../energy-estimate";
import {
  decideProposalInput,
  energyEstimateInput,
  energyEstimateOutput,
  NO_ESTIMATE_REASONS,
  PROPOSAL_DECLINE_REASONS,
} from "./energy-estimate";

describe("nutritionEnergy contract (Issue #76)", () => {
  test("reason lists match the domain", () => {
    expect([...NO_ESTIMATE_REASONS]).toEqual([...DOMAIN_NO_ESTIMATE_REASONS]);
    expect([...PROPOSAL_DECLINE_REASONS]).toEqual([...DOMAIN_DECLINE_REASONS]);
  });

  test("inputs are strict: no ids, no client-computed numbers", () => {
    expect(energyEstimateInput.safeParse({ to: "2026-03-28" }).success).toBe(true);
    expect(
      energyEstimateInput.safeParse({ to: "2026-03-28", organizationId: "org-x" }).success,
    ).toBe(false);
    expect(energyEstimateInput.safeParse({ to: "2026-03-28", intakeKcal: 2000 }).success).toBe(
      false,
    );
    expect(decideProposalInput.safeParse({ proposalId: 1, targetKcal: 1500 }).success).toBe(false);
  });

  test("a computed no-estimate result fits the wire schema with reason copy", () => {
    const window = energyEstimateWindow("2026-03-28");
    const result = presentEstimate(
      computeEnergyEstimate({
        window: { from: window.from, to: window.to },
        intakeDays: [],
        weightTrend: {
          method: { id: "trailing_mean", version: 1 },
          points: [],
          completeness: { observedDays: 0, trendDays: 0, longestGapDays: 28 },
          change: null,
        },
      }),
    );
    const parsed = energyEstimateOutput.parse(result);
    expect(parsed.status).toBe("no_estimate");
    if (parsed.status === "no_estimate")
      expect(parsed.reasonNotes).toHaveLength(parsed.reasons.length);
  });
});
