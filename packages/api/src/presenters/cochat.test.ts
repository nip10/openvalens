import { describe, expect, test } from "bun:test";

import { previewLine, relativeTime, truncate } from "./cochat";

const now = new Date("2026-10-01T12:00:00.000Z");

describe("cochat presenter", () => {
  test("previewLine: collapses whitespace", () => {
    expect(
      previewLine({
        conversationId: "x",
        lastMessageAt: "2026-10-01T12:00:00.000Z",
        lastMessagePreview: "line one\nline two\tline   three",
        messageCount: 1,
      }),
    ).toBe("line one line two line three");
  });

  test("relativeTime: minutes, hours, days, and older", () => {
    expect(relativeTime("2026-10-01T12:00:00.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-01T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-01T11:57:00.000Z", now)).toBe("3m ago");
    expect(relativeTime("2026-10-01T10:30:00.000Z", now)).toBe("2h ago");
    expect(relativeTime("2026-09-30T12:00:00.000Z", now)).toBe("1d ago");
    expect(relativeTime("2026-09-25T12:00:00.000Z", now)).toBe("6d ago");
    expect(relativeTime("2026-08-01T12:00:00.000Z", now)).toMatch(/^[A-Z][a-z]{2} \d+$/);
    expect(relativeTime(null)).toBe("—");
    expect(relativeTime("not-a-date")).toBe("—");
  });

  test("truncate: leaves short strings alone, ellipsises long ones", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a long message that needs trimming", 12)).toBe("a long mess…");
  });
});
