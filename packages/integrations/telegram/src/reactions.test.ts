import { describe, expect, test } from "bun:test";

import { mapReactionToReminderStatus } from "./reactions";

describe("mapReactionToReminderStatus", () => {
  test.each([
    ["✅", "completed"],
    ["👍", "completed"],
    ["✔️", "completed"],
    ["⏸", "snoozed"],
    ["⏸️", "snoozed"],
    ["💤", "snoozed"],
    ["❌", "dismissed"],
    ["👎", "dismissed"],
  ] as const)("maps %s to %s", (emoji, expected) => {
    expect(mapReactionToReminderStatus(emoji)).toBe(expected);
  });

  test("maps unknown emojis to unknown", () => {
    expect(mapReactionToReminderStatus("🎉")).toBe("unknown");
    expect(mapReactionToReminderStatus("🔥")).toBe("unknown");
  });

  test("maps null and undefined to unknown", () => {
    expect(mapReactionToReminderStatus(null)).toBe("unknown");
    expect(mapReactionToReminderStatus(undefined)).toBe("unknown");
    expect(mapReactionToReminderStatus("")).toBe("unknown");
  });
});
