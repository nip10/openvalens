import { describe, expect, mock, test } from "bun:test";

// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));

const { sessionWeeks } = await import("./workouts");

describe("sessionWeeks", () => {
  test("groups sessions by Monday-start week, newest week first", () => {
    const weeks = sessionWeeks([
      { id: 1, date: "2026-11-16" }, // Monday
      { id: 2, date: "2026-11-15" }, // Sunday, the week before
      { id: 3, date: "2026-11-10" }, // Tuesday
      { id: 4, date: "2026-11-19" }, // Thursday
    ]);
    expect(weeks.map((week) => [week.start, week.sessions.map((s) => s.id)])).toEqual([
      ["2026-11-16", [1, 4]],
      ["2026-11-09", [2, 3]],
    ]);
  });
});
