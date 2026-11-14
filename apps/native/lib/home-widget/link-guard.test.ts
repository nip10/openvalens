import { describe, expect, test } from "bun:test";
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  createHomeWidgetLinkCheck,
  createHomeWidgetWriteLog,
  guardHomeWidgetTap,
  HOME_WIDGET_REPEAT_WINDOW_MS,
  HOME_WIDGET_TAP_WINDOW_MS,
  homeWidgetTapVerified,
  isOwnRecord,
} from "./link-guard";
import {
  homeWidgetUrl,
  homeWidgetView,
  parseHomeWidgetAction,
  planHomeWidgetTap,
  type HomeWidgetTapPlan,
} from "./model";

const NOW = 1_800_000_000_000;

const item: DueSupplement = {
  supplementId: 3,
  name: "Magnesium",
  dose: "200 mg",
  scheduleId: 9,
  timeOfDay: "morning",
  pending: 1,
};

const trusted = { ownRecord: true, verified: true, lastWriteAt: undefined, now: NOW } as const;

describe("the widget's links carry no secret", () => {
  test("every button opens the plain link, on Android as on iOS", () => {
    const view = homeWidgetView(
      { version: 1, locale: "en", buttons: ["water", "supplement", "log"], values: null },
      englishI18n,
      "2026-11-14",
    );
    if (view.type !== "buttons") throw new Error("expected buttons");
    expect(view.buttons.map((button) => button.url)).toEqual([
      "openvalens://quick-log?widget=water",
      "openvalens://quick-log?widget=supplement",
      "openvalens://quick-log?widget=log",
    ]);
    expect(homeWidgetUrl("water")).toBe("openvalens://quick-log?widget=water");
  });
});

describe("whether a link follows a tap on the widget", () => {
  test("a tap the receiver recorded a moment ago verifies", () => {
    expect(homeWidgetTapVerified(0)).toBe(true);
    expect(homeWidgetTapVerified(1_200)).toBe(true);
    expect(homeWidgetTapVerified(HOME_WIDGET_TAP_WINDOW_MS - 1)).toBe(true);
  });

  test("no tap (another app, a page, iOS), a stale one or nonsense does not", () => {
    for (const age of [
      null,
      undefined,
      HOME_WIDGET_TAP_WINDOW_MS,
      HOME_WIDGET_TAP_WINDOW_MS * 10,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      expect(homeWidgetTapVerified(age)).toBe(false);
  });

  test("asks the receiver's record once per link, as taking a tap forgets it", () => {
    const taken: string[] = [];
    const taps = new Map<string, number>([["water", 800]]);
    const check = createHomeWidgetLinkCheck((action) => {
      taken.push(action);
      const age = taps.get(action) ?? null;
      taps.delete(action);
      return age;
    });
    // The screen re-checks while it waits for its data: the answer holds.
    expect(check.verified("water")).toBe(true);
    expect(check.verified("water")).toBe(true);
    expect(taken).toEqual(["water"]);
    // The next link is asked afresh, and finds no tap behind it.
    check.reset();
    expect(check.verified("water")).toBe(false);
    expect(taken).toEqual(["water", "water"]);
  });

  test("a link for another button is asked about that button", () => {
    const check = createHomeWidgetLinkCheck((action) => (action === "supplement" ? 100 : null));
    expect(check.verified("water")).toBe(false);
    expect(check.verified("supplement")).toBe(true);
  });
});

describe("whose record a widget tap writes to", () => {
  test("only the owner of the active workspace writes to their own record", () => {
    expect(isOwnRecord({ isFetching: false, data: { role: "owner" } })).toBe(true);
    expect(isOwnRecord({ isFetching: false, data: { role: "member" } })).toBe(false);
    expect(isOwnRecord({ isFetching: false, data: { role: "admin" } })).toBe(false);
  });

  test("an unknown role fails closed; a refetch is waited for", () => {
    expect(isOwnRecord({ isFetching: false, data: undefined })).toBe(false);
    // Cached from before a workspace switch, perhaps.
    expect(isOwnRecord({ isFetching: true, data: { role: "owner" } })).toBeNull();
  });
});

describe("guarding a widget tap", () => {
  const water: HomeWidgetTapPlan = { type: "save_water" };
  const take: HomeWidgetTapPlan = { type: "take", item };

  test("a verified tap in the member's own workspace writes at once", () => {
    expect(guardHomeWidgetTap(water, trusted)).toEqual(water);
    expect(guardHomeWidgetTap(take, trusted)).toEqual(take);
  });

  test("Log… and waiting pass through", () => {
    expect(guardHomeWidgetTap({ type: "picker" }, { ...trusted, ownRecord: false })).toEqual({
      type: "picker",
    });
    expect(guardHomeWidgetTap({ type: "wait" }, trusted)).toEqual({ type: "wait" });
  });

  test("someone else's workspace: the picker, nothing written, even after a real tap", () => {
    for (const plan of [
      water,
      take,
      { type: "choose_supplement", supplementId: 3 },
      { type: "off", action: "water" },
    ] satisfies HomeWidgetTapPlan[])
      expect(guardHomeWidgetTap(plan, { ...trusted, ownRecord: false }).type).toBe(
        "not_own_record",
      );
    expect(guardHomeWidgetTap(take, { ...trusted, ownRecord: false })).toEqual({
      type: "not_own_record",
      action: "supplement",
    });
  });

  test("waits until the workspace and the tap are known", () => {
    expect(guardHomeWidgetTap(water, { ...trusted, ownRecord: null })).toEqual({ type: "wait" });
    expect(guardHomeWidgetTap(water, { ...trusted, verified: null })).toEqual({ type: "wait" });
  });

  test("a link no widget tap is behind: ready to save with one tap, not saved", () => {
    expect(guardHomeWidgetTap(water, { ...trusted, verified: false })).toEqual({
      type: "confirm_water",
    });
    expect(guardHomeWidgetTap(take, { ...trusted, verified: false })).toEqual({
      type: "confirm_take",
      item,
    });
  });

  test("taps that write nothing need no recorded tap", () => {
    const choose: HomeWidgetTapPlan = { type: "choose_supplement", supplementId: null };
    const off: HomeWidgetTapPlan = { type: "off", action: "supplement" };
    expect(guardHomeWidgetTap(choose, { ...trusted, verified: false })).toEqual(choose);
    expect(guardHomeWidgetTap(off, { ...trusted, verified: null })).toEqual(off);
  });

  test("the same kind again within the window is ignored", () => {
    const soon = { ...trusted, lastWriteAt: NOW - HOME_WIDGET_REPEAT_WINDOW_MS + 1 };
    expect(guardHomeWidgetTap(water, soon)).toEqual({ type: "repeat_ignored", action: "water" });
    expect(guardHomeWidgetTap(take, soon)).toEqual({
      type: "repeat_ignored",
      action: "supplement",
    });
  });

  test("after the window, or with a clock that went back, it writes again", () => {
    expect(
      guardHomeWidgetTap(water, { ...trusted, lastWriteAt: NOW - HOME_WIDGET_REPEAT_WINDOW_MS }),
    ).toEqual(water);
    expect(guardHomeWidgetTap(water, { ...trusted, lastWriteAt: NOW + 60_000 })).toEqual(water);
  });

  test("an unverified repeat still only opens the one-tap save", () => {
    expect(
      guardHomeWidgetTap(water, { ...trusted, verified: false, lastWriteAt: NOW - 1_000 }),
    ).toEqual({ type: "confirm_water" });
  });

  test("end to end: a forged water link, even with 1.2.0's nonce, never plans a write", () => {
    const forged = new URL(
      "openvalens://quick-log?widget=water&nonce=0123456789abcdef0123456789abcdef",
    );
    const action = parseHomeWidgetAction(forged.searchParams.get("widget"));
    if (action !== "water") throw new Error("expected water");
    const plan = planHomeWidgetTap(action, {
      availability: { water: true, supplement: true },
      next: null,
    });
    // Another app opened it: the widget's receiver recorded no tap.
    const check = createHomeWidgetLinkCheck(() => null);
    const guarded = guardHomeWidgetTap(plan, { ...trusted, verified: check.verified(action) });
    expect(guarded).toEqual({ type: "confirm_water" });
  });
});

describe("the widget write log", () => {
  test("remembers each kind apart", () => {
    const log = createHomeWidgetWriteLog();
    expect(log.lastWriteAt("water")).toBeUndefined();
    log.record("water", NOW);
    expect(log.lastWriteAt("water")).toBe(NOW);
    expect(log.lastWriteAt("supplement")).toBeUndefined();
    // So water then a supplement within the window both write.
    expect(
      guardHomeWidgetTap(
        { type: "take", item },
        { ...trusted, lastWriteAt: log.lastWriteAt("supplement") },
      ),
    ).toEqual({ type: "take", item });
  });
});
