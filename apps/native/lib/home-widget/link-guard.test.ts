import { describe, expect, test } from "bun:test";
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  createHomeWidgetWriteLog,
  guardHomeWidgetTap,
  HOME_WIDGET_REPEAT_WINDOW_MS,
  homeWidgetLinkVerified,
  isHomeWidgetNonce,
  isOwnRecord,
  newHomeWidgetNonce,
} from "./link-guard";
import {
  homeWidgetUrl,
  homeWidgetView,
  parseHomeWidgetAction,
  planHomeWidgetTap,
  type HomeWidgetTapPlan,
} from "./model";

const NONCE = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
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

describe("the per-install nonce", () => {
  test("16 random bytes as lowercase hex", () => {
    const nonce = newHomeWidgetNonce((count) => Uint8Array.from({ length: count }, (_, i) => i));
    expect(nonce).toBe("000102030405060708090a0b0c0d0e0f");
    expect(isHomeWidgetNonce(nonce)).toBe(true);
  });

  test("refuses a short random source rather than make a weak nonce", () => {
    expect(() => newHomeWidgetNonce(() => new Uint8Array(4))).toThrow();
  });

  test("only 32 lowercase hex characters count as one", () => {
    expect(isHomeWidgetNonce(NONCE)).toBe(true);
    for (const value of ["", "abc", NONCE.toUpperCase(), `${NONCE}0`, null, undefined, 42])
      expect(isHomeWidgetNonce(value)).toBe(false);
  });

  test("the Android widget's water and supplement links carry it; Log… does not", () => {
    const view = homeWidgetView(
      { version: 1, locale: "en", buttons: ["water", "supplement", "log"], values: null },
      englishI18n,
      "2026-11-14",
      NONCE,
    );
    if (view.type !== "buttons") throw new Error("expected buttons");
    const links = view.buttons.map((button) => new URL(button.url));
    expect(links.map((url) => url.searchParams.get("nonce"))).toEqual([NONCE, NONCE, null]);
    expect(links.map((url) => parseHomeWidgetAction(url.searchParams.get("widget")))).toEqual([
      "water",
      "supplement",
      "log",
    ]);
  });

  test("without a nonce (iOS, or none stored yet) the links are the plain ones", () => {
    expect(homeWidgetUrl("water", null)).toBe("openvalens://quick-log?widget=water");
    expect(homeWidgetUrl("water")).toBe("openvalens://quick-log?widget=water");
  });
});

describe("whether a link is the widget's", () => {
  test("waits while the stored nonce is read", () => {
    expect(homeWidgetLinkVerified(NONCE, undefined)).toBeNull();
  });

  test("the matching nonce verifies", () => {
    expect(homeWidgetLinkVerified(NONCE, NONCE)).toBe(true);
    expect(homeWidgetLinkVerified([NONCE, OTHER], NONCE)).toBe(true);
  });

  test("a missing, wrong or malformed nonce does not", () => {
    expect(homeWidgetLinkVerified(undefined, NONCE)).toBe(false);
    expect(homeWidgetLinkVerified(null, NONCE)).toBe(false);
    expect(homeWidgetLinkVerified("", NONCE)).toBe(false);
    expect(homeWidgetLinkVerified(OTHER, NONCE)).toBe(false);
    expect(homeWidgetLinkVerified(NONCE.toUpperCase(), NONCE)).toBe(false);
    expect(homeWidgetLinkVerified(`${NONCE}&widget=water`, NONCE)).toBe(false);
  });

  test("nothing verifies when this install has no nonce (iOS)", () => {
    expect(homeWidgetLinkVerified(NONCE, null)).toBe(false);
    expect(homeWidgetLinkVerified(undefined, null)).toBe(false);
    // A stored value that is not a nonce is treated as none.
    expect(homeWidgetLinkVerified("", "")).toBe(false);
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

  test("someone else's workspace: the picker, nothing written, whatever the nonce", () => {
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

  test("waits until the workspace and the nonce are known", () => {
    expect(guardHomeWidgetTap(water, { ...trusted, ownRecord: null })).toEqual({ type: "wait" });
    expect(guardHomeWidgetTap(water, { ...trusted, verified: null })).toEqual({ type: "wait" });
  });

  test("a link without the widget's nonce: ready to save with one tap, not saved", () => {
    expect(guardHomeWidgetTap(water, { ...trusted, verified: false })).toEqual({
      type: "confirm_water",
    });
    expect(guardHomeWidgetTap(take, { ...trusted, verified: false })).toEqual({
      type: "confirm_take",
      item,
    });
  });

  test("taps that write nothing need no nonce", () => {
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

  test("end to end: a forged water link (no nonce) never plans a write", () => {
    const forged = new URL("openvalens://quick-log?widget=water");
    const action = parseHomeWidgetAction(forged.searchParams.get("widget"));
    if (!action) throw new Error("expected an action");
    const plan = planHomeWidgetTap(action, {
      availability: { water: true, supplement: true },
      next: null,
    });
    const guarded = guardHomeWidgetTap(plan, {
      ...trusted,
      verified: homeWidgetLinkVerified(forged.searchParams.get("nonce"), NONCE),
    });
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
