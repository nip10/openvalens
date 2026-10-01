import { describe, expect, test } from "bun:test";

import {
  assertivenessLabel,
  COACH_DISCLAIMER_VALUES,
  COACH_RISK_VALUES,
  COACH_TEMPLATE_VALUES,
  COACH_TONE_VALUES,
  disclaimerLabel,
  riskDescription,
  riskLabel,
  templateDescription,
  templateLabel,
  toneDescription,
  toneLabel,
} from "./coach-settings";

describe("coach settings presenter", () => {
  test("tone: label + description, falls back gracefully", () => {
    expect(toneLabel("strict")).toBe("Strict");
    expect(toneLabel("balanced")).toBe("Balanced");
    expect(toneLabel("supportive")).toBe("Supportive");
    expect(toneLabel("custom")).toBe("custom");
    expect(toneDescription("balanced")).toMatch(/flexible/);
  });

  test("risk: label + description", () => {
    expect(riskLabel("conservative")).toBe("Conservative");
    expect(riskDescription("aggressive")).toMatch(/upside/);
    expect(riskLabel("custom")).toBe("custom");
  });

  test("disclaimer and assertiveness labels", () => {
    expect(disclaimerLabel("always")).toBe("Always");
    expect(disclaimerLabel("contextual")).toBe("Only when relevant");
    expect(assertivenessLabel(1)).toBe("Very gentle");
    expect(assertivenessLabel(3)).toBe("Direct");
    expect(assertivenessLabel(5)).toBe("Very forceful");
  });

  test("template: label + description, falls back gracefully", () => {
    expect(templateLabel("cut")).toBe("Cut");
    expect(templateLabel("recovery")).toBe("Recovery");
    expect(templateDescription("performance")).toMatch(/training/);
    expect(templateLabel("custom")).toBe("custom");
  });

  test("value lists mirror the closed enums", () => {
    expect([...COACH_TONE_VALUES]).toEqual(["strict", "balanced", "supportive"]);
    expect([...COACH_RISK_VALUES]).toEqual(["conservative", "moderate", "aggressive"]);
    expect([...COACH_DISCLAIMER_VALUES]).toEqual(["always", "contextual"]);
    expect([...COACH_TEMPLATE_VALUES]).toEqual(["cut", "recovery", "performance", "maintenance"]);
  });
});
