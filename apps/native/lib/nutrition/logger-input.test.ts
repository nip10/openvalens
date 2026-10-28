import { describe, expect, test } from "bun:test";

import { visibleLoggerInput } from "./logger-input";

describe("visibleLoggerInput", () => {
  test("masks numeric values for hide and unresolved preferences without changing the draft", () => {
    expect(visibleLoggerInput("120", true)).toBe("");
    expect(visibleLoggerInput("120", undefined)).toBe("");
  });

  test("shows draft values when numbers are allowed", () => {
    expect(visibleLoggerInput("120", false)).toBe("120");
  });
});
