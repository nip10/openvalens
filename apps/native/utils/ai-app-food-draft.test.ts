import { describe, expect, test } from "bun:test";

import { aiFoodDraftHref } from "./ai-app-food-draft";

/** #439 (M2c) — a meal draft from a connected AI app opens Add food for when it was eaten. */
describe("aiFoodDraftHref", () => {
  test("logs on the day, at the time and in the meal the app sent", () => {
    const href = aiFoodDraftHref(
      { id: "d-1", payload: { eatenAt: "2026-11-13T23:30:00.000Z", meal: "dinner" } },
      "Europe/Lisbon",
    );
    expect(href).toEqual({
      pathname: "/log-food",
      params: {
        mode: "app",
        aiDraft: "d-1",
        timeZone: "Europe/Lisbon",
        meal: "dinner",
        localDate: "2026-11-13",
        at: "2026-11-13T23:30:00.000Z",
      },
    });
  });

  test("uses the member's time zone for the diary day", () => {
    const href = aiFoodDraftHref(
      { id: "d-2", payload: { eatenAt: "2026-11-13T23:30:00.000Z", meal: "snack" } },
      "Asia/Tokyo",
    );
    expect(href.params.localDate).toBe("2026-11-14");
  });

  test("an unknown meal falls back to the meal the time falls in", () => {
    const href = aiFoodDraftHref(
      { id: "d-3", payload: { eatenAt: "2026-11-13T12:00:00.000Z", meal: null } },
      "UTC",
    );
    expect(["breakfast", "lunch", "snack", "dinner"]).toContain(href.params.meal);
  });
});
