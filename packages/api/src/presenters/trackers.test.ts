import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { TRACKER_TEMPLATE_IDS } from "@openvalens/trackers/model";

import { availableLogKinds, LOG_KINDS, type LogKind } from "./log-kinds";
import {
  formatTrackerTarget,
  formatTrackerValue,
  matchTrackerOneLiner,
  parseTrackerInput,
  TRACKER_TEMPLATE_COPY,
  trackerIdFromLogKind,
  trackerLogKind,
  trackerLogKinds,
  type TrackerForLogKind,
} from "./trackers";

const sauna: TrackerForLogKind = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Sauna",
  icon: "flame",
  type: "duration",
  unit: null,
  decimals: 0,
  canLog: true,
  archivedAt: null,
};
const pages: TrackerForLogKind = {
  ...sauna,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Pages read",
  icon: "book",
  type: "number",
  unit: "pages",
};
const mood: TrackerForLogKind = {
  ...sauna,
  id: "00000000-0000-4000-8000-000000000003",
  name: "Mood",
  icon: "smile",
  type: "scale",
};
const flossed: TrackerForLogKind = {
  ...sauna,
  id: "00000000-0000-4000-8000-000000000004",
  name: "Flossed",
  icon: "sparkles",
  type: "yes_no",
};

describe("tracker copy", () => {
  test("mood and stress are self-ratings: no score or screening words", () => {
    const banned = /score|screen|depress|anxiety|disorder|clinical|phq|gad|diagnos|symptom/i;
    for (const id of TRACKER_TEMPLATE_IDS) {
      const copy = TRACKER_TEMPLATE_COPY[id];
      for (const message of [copy.name, copy.description, copy.scaleLow, copy.scaleHigh]) {
        if (message) expect(inEnglish(message)).not.toMatch(banned);
      }
    }
    expect(inEnglish(TRACKER_TEMPLATE_COPY.mood.description)).toMatch(/yourself/);
    expect(inEnglish(TRACKER_TEMPLATE_COPY.stress.description)).toMatch(/yourself/);
    expect(formatTrackerValue(englishI18n, mood, 4)).not.toMatch(/score/i);
  });
});

describe("formatting", () => {
  test("each type reads naturally", () => {
    expect(formatTrackerValue(englishI18n, sauna, 1200)).toBe("20 min");
    expect(formatTrackerValue(englishI18n, sauna, 90)).toBe("1 min 30 s");
    expect(formatTrackerValue(englishI18n, pages, 12.345)).toBe("12 pages");
    expect(formatTrackerValue(englishI18n, { ...pages, decimals: 2 }, 12.345)).toBe("12.35 pages");
    expect(formatTrackerValue(englishI18n, mood, 3.5)).toBe("3.5 of 5");
    expect(formatTrackerValue(englishI18n, flossed, 1)).toBe("Yes");
    expect(formatTrackerTarget(englishI18n, flossed, { value: 5, period: "week" })).toBe(
      "5 days per week",
    );
    expect(formatTrackerTarget(englishI18n, sauna, { value: 1200, period: "day" })).toBe(
      "20 min per day",
    );
  });
});

describe("parsing", () => {
  test("reads values for each type", () => {
    expect(parseTrackerInput(sauna, "20 min")).toBe(1200);
    expect(parseTrackerInput(pages, "12 pages")).toBe(12);
    expect(parseTrackerInput(pages, "12,5", "pt-PT")).toBe(12.5);
    expect(parseTrackerInput(mood, "4")).toBe(4);
    expect(parseTrackerInput(mood, "4/5")).toBe(4);
    expect(parseTrackerInput(mood, "6")).toBeNull();
    expect(parseTrackerInput(flossed, "yes")).toBe(1);
    expect(parseTrackerInput(flossed, "não")).toBe(0);
    expect(parseTrackerInput(flossed, "maybe")).toBeNull();
  });

  test("one-liners match by tracker name", () => {
    const trackers = [sauna, pages, mood, flossed];
    expect(matchTrackerOneLiner("sauna 20 min", trackers)).toEqual({ tracker: sauna, value: 1200 });
    expect(matchTrackerOneLiner("Pages read 30", trackers)).toEqual({ tracker: pages, value: 30 });
    expect(matchTrackerOneLiner("mood 4", trackers)).toEqual({ tracker: mood, value: 4 });
    expect(matchTrackerOneLiner("flossed yes", trackers)).toEqual({ tracker: flossed, value: 1 });
    expect(matchTrackerOneLiner("saunas 20", trackers)).toBeNull();
    expect(matchTrackerOneLiner("sauna", trackers)).toBeNull();
    expect(matchTrackerOneLiner("sauna 20", [{ ...sauna, archivedAt: "2026-11-01" }])).toBeNull();
  });
});

describe("log kinds", () => {
  test("each tracker the member can log becomes a kind with its own name", () => {
    const kind = trackerLogKind(sauna);
    expect(kind.id).toBe(`tracker:${sauna.id}`);
    expect(trackerIdFromLogKind(kind.id)).toBe(sauna.id);
    expect(trackerIdFromLogKind("weight")).toBeNull();
    expect(englishI18n._(kind.label)).toBe("Sauna");
    expect(kind.save).toBe("at_once");
    expect(kind.fields.map((field) => [field.id, field.type])).toEqual([
      ["value", "duration"],
      ["observedAt", "datetime"],
      ["note", "text"],
    ]);
    expect(trackerLogKind(pages).fields[0]?.unit?.code).toBe("pages");
    expect(trackerLogKind(mood).fields[0]).toMatchObject({ type: "rating", min: 1, max: 5 });
    expect(
      trackerLogKinds([sauna, { ...pages, canLog: false }, { ...mood, archivedAt: "x" }]).map(
        (k) => k.id,
      ),
    ).toEqual([`tracker:${sauna.id}`]);
  });

  test("pass through the shared filter with the built-ins", () => {
    const kinds: LogKind[] = [...LOG_KINDS, ...trackerLogKinds([sauna])];
    const everything = { enabledModules: [], preferences: {} };
    expect(availableLogKinds(everything, kinds).map((kind) => kind.id)).toContain(
      `tracker:${sauna.id}`,
    );
    expect(
      availableLogKinds({ ...everything, can: () => false }, kinds).map((kind) => kind.id),
    ).not.toContain(`tracker:${sauna.id}`);
  });
});
