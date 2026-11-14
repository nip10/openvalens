import { describe, expect, test } from "bun:test";
import type { DueSupplement } from "@openvalens/api/contracts/quick-log";
import { availableLogKinds, LOG_KINDS, type LogKind } from "@openvalens/api/presenters/log-kinds";
import { createAppI18n } from "@openvalens/i18n";
import { englishI18n } from "@openvalens/i18n/testing";

import {
  buildHomeWidgetSnapshot,
  glassOfWaterWrite,
  homeWidgetAvailability,
  homeWidgetButtons,
  homeWidgetUrl,
  homeWidgetView,
  nextDueSupplement,
  parseHomeWidgetAction,
  parseHomeWidgetSnapshot,
  planHomeWidgetTap,
  supplementDosesDue,
  type HomeWidgetSnapshot,
} from "./model";

const ZONE = "Europe/Lisbon";
const NOW = new Date("2026-11-14T12:00:00Z");
const TODAY = "2026-11-14";

const due = (overrides: Partial<DueSupplement> = {}): DueSupplement => ({
  supplementId: 3,
  name: "Magnesium",
  dose: "200 mg",
  scheduleId: 9,
  timeOfDay: "morning",
  pending: 1,
  ...overrides,
});
const vitaminD = due({ supplementId: 4, name: "Vitamin D", dose: "1000 IU", scheduleId: 10 });

const kinds = (
  enabledModules: Parameters<typeof availableLogKinds>[0]["enabledModules"],
  water = true,
): LogKind[] =>
  availableLogKinds<LogKind>({ enabledModules, preferences: { plain_water: water } }, [
    ...LOG_KINDS,
  ]);

describe("deep links", () => {
  test("each button opens the log picker with its action", () => {
    expect(homeWidgetUrl("water")).toBe("openvalens://quick-log?widget=water");
    expect(homeWidgetUrl("supplement")).toBe("openvalens://quick-log?widget=supplement");
    expect(homeWidgetUrl("log")).toBe("openvalens://quick-log?widget=log");
  });

  test("parses the action from the route parameter, and nothing else", () => {
    for (const action of ["water", "supplement", "log"] as const) {
      const param = new URL(homeWidgetUrl(action)).searchParams.get("widget");
      expect(parseHomeWidgetAction(param)).toBe(action);
    }
    expect(parseHomeWidgetAction(["water", "log"])).toBe("water");
    expect(parseHomeWidgetAction(undefined)).toBeNull();
    expect(parseHomeWidgetAction(null)).toBeNull();
    expect(parseHomeWidgetAction("")).toBeNull();
    expect(parseHomeWidgetAction("Water")).toBeNull();
    expect(parseHomeWidgetAction("sleep")).toBeNull();
    expect(parseHomeWidgetAction("water;drop")).toBeNull();
  });
});

describe("which buttons show", () => {
  test("all three when water and supplements are on", () => {
    const availability = homeWidgetAvailability(kinds(null));
    expect(availability).toEqual({ water: true, supplement: true });
    expect(homeWidgetButtons(availability)).toEqual(["water", "supplement", "log"]);
  });

  test("a turned-off module takes its button away; Log… stays", () => {
    expect(homeWidgetButtons(homeWidgetAvailability(kinds(["food", "heart"])))).toEqual([
      "water",
      "log",
    ]);
    expect(homeWidgetButtons(homeWidgetAvailability(kinds(["supplements"])))).toEqual([
      "supplement",
      "log",
    ]);
    expect(homeWidgetButtons(homeWidgetAvailability(kinds([])))).toEqual(["log"]);
  });

  test("water needs the plain-water preference as well as the food module", () => {
    expect(homeWidgetButtons(homeWidgetAvailability(kinds(null, false)))).toEqual([
      "supplement",
      "log",
    ]);
  });
});

describe("which supplement is next due", () => {
  const answer = { localDate: TODAY, items: [due(), vitaminD] };

  test("the first one due now, in the server's order", () => {
    expect(nextDueSupplement(answer, [], ZONE, NOW)?.name).toBe("Magnesium");
  });

  test("skips one already taken on this phone and waiting to sync", () => {
    const queued = [{ supplementId: 3, occurredAt: "2026-11-14T09:00:00Z" }];
    expect(nextDueSupplement(answer, queued, ZONE, NOW)?.name).toBe("Vitamin D");
  });

  test("an intake queued yesterday does not count for today", () => {
    const queued = [{ supplementId: 3, occurredAt: "2026-11-13T09:00:00Z" }];
    expect(nextDueSupplement(answer, queued, ZONE, NOW)?.name).toBe("Magnesium");
  });

  test("nothing when nothing is due, or the answer is from another day", () => {
    expect(nextDueSupplement({ localDate: TODAY, items: [] }, [], ZONE, NOW)).toBeNull();
    expect(nextDueSupplement({ ...answer, localDate: "2026-11-13" }, [], ZONE, NOW)).toBeNull();
    expect(nextDueSupplement(undefined, [], ZONE, NOW)).toBeNull();
  });

  test("doses due add up across supplements, less the queued ones", () => {
    const twice = { localDate: TODAY, items: [due({ pending: 2 }), vitaminD] };
    expect(supplementDosesDue(twice, [], ZONE, NOW)).toBe(3);
    const queued = [{ supplementId: 3, occurredAt: "2026-11-14T09:00:00Z" }];
    expect(supplementDosesDue(twice, queued, ZONE, NOW)).toBe(2);
  });
});

describe("what a tap does", () => {
  const on = { water: true, supplement: true };

  test("Log… opens the picker at once, whatever is still loading", () => {
    expect(planHomeWidgetTap("log", { availability: null, next: undefined })).toEqual({
      type: "picker",
    });
  });

  test("waits until it knows what the member can log", () => {
    expect(planHomeWidgetTap("water", { availability: null, next: null })).toEqual({
      type: "wait",
    });
    expect(planHomeWidgetTap("supplement", { availability: on, next: undefined })).toEqual({
      type: "wait",
    });
  });

  test("water saves a glass", () => {
    expect(planHomeWidgetTap("water", { availability: on, next: undefined })).toEqual({
      type: "save_water",
    });
    expect(glassOfWaterWrite({ timeZone: ZONE, newId: () => "id-1", now: NOW })).toEqual({
      type: "water",
      input: {
        quantity: 250,
        unit: "ml",
        observedAt: NOW.toISOString(),
        timeZone: ZONE,
        clientMutationId: "id-1",
      },
    });
  });

  test("Taken logs the next supplement due with its dose", () => {
    expect(planHomeWidgetTap("supplement", { availability: on, next: due() })).toEqual({
      type: "take",
      item: due(),
    });
  });

  test("with nothing due, or no known dose, the supplement form opens instead", () => {
    expect(planHomeWidgetTap("supplement", { availability: on, next: null })).toEqual({
      type: "choose_supplement",
      supplementId: null,
    });
    expect(
      planHomeWidgetTap("supplement", { availability: on, next: due({ dose: null }) }),
    ).toEqual({ type: "choose_supplement", supplementId: 3 });
  });

  test("a kind turned off since the widget was drawn is not saved", () => {
    const off = { water: false, supplement: false };
    expect(planHomeWidgetTap("water", { availability: off, next: null })).toEqual({
      type: "off",
      action: "water",
    });
    expect(planHomeWidgetTap("supplement", { availability: off, next: due() })).toEqual({
      type: "off",
      action: "supplement",
    });
  });
});

describe("values on the widget are opt-in", () => {
  const values = { localDate: TODAY, water: "1,250 ml", supplementsDue: 2 };
  const on = { water: true, supplement: true };

  test("off (the default): no health data in the snapshot at all", () => {
    const snapshot = buildHomeWidgetSnapshot({
      locale: "en",
      availability: on,
      valuesEnabled: false,
      values,
    });
    expect(snapshot).toEqual({
      version: 1,
      locale: "en",
      buttons: ["water", "supplement", "log"],
      values: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("1,250");
  });

  test("on: today's water and the doses due", () => {
    const snapshot = buildHomeWidgetSnapshot({
      locale: "en",
      availability: on,
      valuesEnabled: true,
      values,
    });
    expect(snapshot.values).toEqual(values);
  });

  test("on, a turned-off kind's value is left out", () => {
    const snapshot = buildHomeWidgetSnapshot({
      locale: "en",
      availability: { water: false, supplement: true },
      valuesEnabled: true,
      values,
    });
    expect(snapshot.values).toEqual({ localDate: TODAY, water: null, supplementsDue: 2 });
    const none = buildHomeWidgetSnapshot({
      locale: "en",
      availability: { water: false, supplement: false },
      valuesEnabled: true,
      values,
    });
    expect(none.values).toBeNull();
  });

  test("the stored snapshot survives a round trip; anything else reads as none", () => {
    const snapshot: HomeWidgetSnapshot = {
      version: 1,
      locale: "pt-PT",
      buttons: ["supplement", "log"],
      values,
    };
    expect(parseHomeWidgetSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(parseHomeWidgetSnapshot(null)).toBeNull();
    expect(parseHomeWidgetSnapshot("{")).toBeNull();
    expect(parseHomeWidgetSnapshot(JSON.stringify({ ...snapshot, version: 2 }))).toBeNull();
    expect(parseHomeWidgetSnapshot(JSON.stringify({ ...snapshot, locale: "fr" }))).toBeNull();
    expect(
      parseHomeWidgetSnapshot(
        JSON.stringify({ ...snapshot, values: { ...values, supplementsDue: -1 } }),
      )?.values,
    ).toBeNull();
    expect(
      parseHomeWidgetSnapshot(JSON.stringify({ ...snapshot, buttons: ["log", "sleep", "water"] }))
        ?.buttons,
    ).toEqual(["water", "log"]);
  });
});

describe("what the widget shows", () => {
  const snapshot = (values: HomeWidgetSnapshot["values"]): HomeWidgetSnapshot => ({
    version: 1,
    locale: "en",
    buttons: ["water", "supplement", "log"],
    values,
  });

  test("without values: what each tap does", () => {
    const view = homeWidgetView(snapshot(null), englishI18n, TODAY);
    expect(view).toEqual({
      type: "buttons",
      buttons: [
        {
          action: "water",
          label: "Water",
          detail: "+1 glass",
          url: "openvalens://quick-log?widget=water",
        },
        {
          action: "supplement",
          label: "Supplement",
          detail: "Taken",
          url: "openvalens://quick-log?widget=supplement",
        },
        {
          action: "log",
          label: "Log…",
          detail: "Everything else",
          url: "openvalens://quick-log?widget=log",
        },
      ],
    });
  });

  test("with today's values", () => {
    const view = homeWidgetView(
      snapshot({ localDate: TODAY, water: "1,250 ml", supplementsDue: 2 }),
      englishI18n,
      TODAY,
    );
    expect(view.type === "buttons" && view.buttons.map((button) => button.detail)).toEqual([
      "1,250 ml today",
      "2 due",
      "Everything else",
    ]);
    const done = homeWidgetView(
      snapshot({ localDate: TODAY, water: null, supplementsDue: 0 }),
      englishI18n,
      TODAY,
    );
    expect(done.type === "buttons" && done.buttons.map((button) => button.detail)).toEqual([
      "+1 glass",
      "All taken",
      "Everything else",
    ]);
  });

  test("values from another day are not shown", () => {
    const view = homeWidgetView(
      snapshot({ localDate: "2026-11-13", water: "1,250 ml", supplementsDue: 2 }),
      englishI18n,
      TODAY,
    );
    expect(view.type === "buttons" && view.buttons.map((button) => button.detail)).toEqual([
      "+1 glass",
      "Taken",
      "Everything else",
    ]);
  });

  test("signed out: one line that opens the app", () => {
    expect(homeWidgetView(null, englishI18n, TODAY)).toEqual({
      type: "signed_out",
      text: "Sign in to OpenValens to log from here.",
      url: "openvalens://",
    });
  });

  test("in European Portuguese", () => {
    const view = homeWidgetView(snapshot(null), createAppI18n("pt-PT"), TODAY);
    expect(view.type === "buttons" && view.buttons.map((button) => button.label)).toEqual([
      "Água",
      "Suplemento",
      "Registar…",
    ]);
  });
});
