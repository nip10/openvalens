import { describe, expect, test } from "bun:test";

import {
  domainLabel,
  groupTimelineByDay,
  severityTone,
  sourceLabel,
  type TimelineItemLike,
} from "./timeline";

const item = (id: string, at: string, extra: Partial<TimelineItemLike> = {}): TimelineItemLike => ({
  id,
  at,
  domain: "body",
  title: "Weight",
  summary: "72.4 kg",
  severity: "none",
  sourceRefs: [],
  ...extra,
});

describe("timeline presenter", () => {
  test("groups by local day, newest day first, keeping item order, with local times", () => {
    const groups = groupTimelineByDay(
      [
        item("a", "2026-10-01T22:30:00.000Z"), // 23:30 in Lisbon (UTC+1)
        item("b", "2026-10-01T07:00:00.000Z"),
        item("c", "2026-09-30T23:30:00.000Z"), // 00:30 on 1 Oct in Lisbon
        item("d", "2026-09-30T12:00:00.000Z"),
      ],
      "Europe/Lisbon",
    );
    expect(groups.map((g) => [g.day, g.items.map((i) => [i.id, i.time])])).toEqual([
      [
        "2026-10-01",
        [
          ["a", "23:30"],
          ["b", "08:00"],
          ["c", "00:30"],
        ],
      ],
      ["2026-09-30", [["d", "13:00"]]],
    ]);
  });

  test("domains get sentence-case labels; unknown domains fall back", () => {
    expect(domainLabel("meds_supplements")).toBe("Meds and supplements");
    expect(domainLabel("vitals")).toBe("Vitals");
    expect(domainLabel("something_new")).toBe("Other");
  });

  test("severity maps to a semantic tone; none and info stay neutral", () => {
    expect(severityTone("critical")).toBe("destructive");
    expect(severityTone("warning")).toBe("warning");
    expect(severityTone("info")).toBeNull();
    expect(severityTone("none")).toBeNull();
  });

  test("source label prefers the first labelled source", () => {
    expect(sourceLabel(item("a", "2026-10-01T00:00:00.000Z"))).toBeNull();
    expect(
      sourceLabel(
        item("a", "2026-10-01T00:00:00.000Z", {
          sourceRefs: [{ type: "data_source", label: "Withings" }],
        }),
      ),
    ).toBe("Withings");
  });
});
