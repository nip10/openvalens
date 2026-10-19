import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openvalens/observability";

import { energyEstimateLogMetadata, energyProposalLogMetadata } from "./nutrition-energy";

describe("nutrition energy logging", () => {
  test("estimate and proposal logs do not distinguish eligibility or refusal reasons", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({ sink: (_level, line) => lines.push(line) });

    for (const result of [
      { status: "off", declarations: ["eating_disorder"], heightCm: 175 },
      { status: "estimated", declarations: [], heightCm: 175 },
    ])
      logger.info(
        "nutrition.energy_estimate.computed",
        energyEstimateLogMetadata(result, "corr-test"),
      );

    for (const result of [
      { outcome: "declined", reason: "suggestions_off", declarations: ["eating_disorder"] },
      { outcome: "proposal", targetKcal: 2400, declarations: [] },
      {
        outcome: "declined",
        reason: "not_suggested_for_profile",
        declarations: ["pregnant_or_breastfeeding"],
      },
    ])
      logger.info(
        "nutrition.energy_proposal.requested",
        energyProposalLogMetadata(result, "corr-test"),
      );

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0]).toEqual(parsed[1]);
    expect(parsed[2]).toEqual(parsed[3]);
    expect(parsed[3]).toEqual(parsed[4]);
    expect(lines.join("\n")).not.toContain("eating_disorder");
    expect(lines.join("\n")).not.toContain("suggestions_off");
    expect(lines.join("\n")).not.toContain("175");
    expect(lines.join("\n")).not.toContain("2400");
    expect(
      parsed.every(
        (line) => Object.keys(line).sort().join(",") === "correlationId,event,level,outcome",
      ),
    ).toBe(true);
  });
});
