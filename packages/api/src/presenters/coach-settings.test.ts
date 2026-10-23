import { describe, expect, test } from "bun:test";

import { inEnglish } from "@openvalens/i18n/testing";

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
    expect(inEnglish(toneLabel("strict"))).toBe("Strict");
    expect(inEnglish(toneLabel("balanced"))).toBe("Balanced");
    expect(inEnglish(toneLabel("supportive"))).toBe("Supportive");
    expect(inEnglish(toneLabel("custom"))).toBe("custom");
    expect(inEnglish(toneDescription("balanced")!)).toMatch(/flexible/);
  });

  test("risk: label + description", () => {
    expect(inEnglish(riskLabel("conservative"))).toBe("Conservative");
    expect(inEnglish(riskDescription("aggressive")!)).toMatch(/upside/);
    expect(inEnglish(riskLabel("custom"))).toBe("custom");
  });

  test("disclaimer and assertiveness labels", () => {
    expect(inEnglish(disclaimerLabel("always"))).toBe("Always");
    expect(inEnglish(disclaimerLabel("contextual"))).toBe("Only when relevant");
    expect(inEnglish(assertivenessLabel(1))).toBe("Very gentle");
    expect(inEnglish(assertivenessLabel(3))).toBe("Direct");
    expect(inEnglish(assertivenessLabel(5))).toBe("Very forceful");
  });

  test("template: label + description, falls back gracefully", () => {
    expect(inEnglish(templateLabel("cut"))).toBe("Cut");
    expect(inEnglish(templateLabel("recovery"))).toBe("Recovery");
    expect(inEnglish(templateDescription("performance")!)).toMatch(/training/);
    expect(inEnglish(templateLabel("custom"))).toBe("custom");
  });

  test("unknown descriptions are null", () => {
    expect(toneDescription("custom")).toBeNull();
    expect(riskDescription("custom")).toBeNull();
    expect(templateDescription("custom")).toBeNull();
  });

  test("value lists mirror the closed enums", () => {
    expect([...COACH_TONE_VALUES]).toEqual(["strict", "balanced", "supportive"]);
    expect([...COACH_RISK_VALUES]).toEqual(["conservative", "moderate", "aggressive"]);
    expect([...COACH_DISCLAIMER_VALUES]).toEqual(["always", "contextual"]);
    expect([...COACH_TEMPLATE_VALUES]).toEqual(["cut", "recovery", "performance", "maintenance"]);
  });
});
