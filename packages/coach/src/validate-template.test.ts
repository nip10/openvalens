import { describe, expect, test } from "bun:test";

import { validateTemplate } from "./validate-template";

const validTemplate = {
  key: "cut",
  title: "Cut",
  description: "Drive sustainable fat loss.",
  instructionPreset: {
    objective: "Drive sustainable fat loss while preserving muscle.",
    directives: ["Prefer minimal effective changes.", "Prioritize adherence."],
    outputStyle: "Actionable weekly checklist.",
  },
  isActive: true,
};

describe("coach — validateTemplate", () => {
  test("accepts a well-formed seed template", () => {
    const result = validateTemplate(validTemplate);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.template.key).toBe("cut");
  });

  test("rejects non-object input", () => {
    const result = validateTemplate("not-a-template");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/plain object/);
  });

  test("rejects an unknown template key", () => {
    const result = validateTemplate({ ...validTemplate, key: "bogus" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/Template key must be one of/);
  });

  test("rejects a missing key", () => {
    const { key: _key, ...rest } = validTemplate;
    const result = validateTemplate(rest);
    expect(result.ok).toBe(false);
  });

  test("rejects empty directives", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: { ...validTemplate.instructionPreset, directives: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/directives/);
  });

  test("rejects non-string directives", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: {
        ...validTemplate.instructionPreset,
        directives: ["ok", 42 as unknown as string],
      },
    });
    expect(result.ok).toBe(false);
  });

  test("rejects consent-bypass phrasing", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: {
        ...validTemplate.instructionPreset,
        directives: ["Always bypass consent before clinical recommendations."],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/consent/);
  });

  test("rejects 'skip physician' phrasing", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: {
        ...validTemplate.instructionPreset,
        directives: ["Skip physician disclaimer for clarity."],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/consent/);
  });

  test("rejects embedded email addresses", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: {
        ...validTemplate.instructionPreset,
        directives: ["Contact coach@example.com for guidance."],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/email/);
  });

  test("rejects embedded token-like secrets", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: {
        ...validTemplate.instructionPreset,
        directives: ["Use sk-abcdef1234567890 when integrating with the assistant."],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.reason).toMatch(/token/);
  });

  test("rejects missing instructionPreset", () => {
    const result = validateTemplate({ ...validTemplate, instructionPreset: undefined });
    expect(result.ok).toBe(false);
  });

  test("rejects missing objective", () => {
    const result = validateTemplate({
      ...validTemplate,
      instructionPreset: {
        directives: ["ok"],
        outputStyle: "ok",
      },
    });
    expect(result.ok).toBe(false);
  });

  test("rejects empty title", () => {
    const result = validateTemplate({ ...validTemplate, title: "  " });
    expect(result.ok).toBe(false);
  });

  test("accepts all four closed-union keys", () => {
    for (const key of ["cut", "recovery", "performance", "maintenance"] as const) {
      const result = validateTemplate({ ...validTemplate, key });
      expect(result.ok).toBe(true);
    }
  });
});
