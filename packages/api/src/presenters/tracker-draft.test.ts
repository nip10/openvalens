import { describe, expect, test } from "bun:test";

import {
  blankTrackerDraft,
  draftFromTracker,
  parseTargetValue,
  templateTrackerDraft,
  trackerCreatePayload,
  trackerDraftProblems,
  trackerUpdatePayload,
} from "./tracker-draft";

describe("tracker drafts", () => {
  test("templates set the type, icon and AI switch (off for mood and stress)", () => {
    expect(templateTrackerDraft("mood", "Mood")).toMatchObject({
      type: "scale",
      icon: "smile",
      aiVisible: false,
    });
    expect(templateTrackerDraft("sauna", "Sauna")).toMatchObject({
      type: "duration",
      aiVisible: true,
    });
  });

  test("a number tracker needs a name and a unit", () => {
    const draft = blankTrackerDraft();
    expect(trackerDraftProblems(draft)).toEqual(["name", "unit"]);
    expect(trackerCreatePayload({ ...draft, name: "Pages", unit: "pages" })).toMatchObject({
      name: "Pages",
      type: "number",
      unit: "pages",
      aggregation: "sum",
      target: null,
    });
  });

  test("targets are typed in the tracker's unit", () => {
    const sauna = { ...templateTrackerDraft("sauna", "Sauna"), targetEnabled: true };
    expect(parseTargetValue({ ...sauna, target: "20 min" })).toBe(1200);
    expect(trackerDraftProblems({ ...sauna, target: "soon" })).toEqual(["target"]);
    const flossed = { ...templateTrackerDraft("flossed", "Flossed"), targetEnabled: true };
    expect(parseTargetValue({ ...flossed, target: "5", targetPeriod: "week" })).toBe(5);
    expect(parseTargetValue({ ...flossed, target: "8", targetPeriod: "week" })).toBeNull();
    expect(trackerCreatePayload({ ...flossed, target: "5", targetPeriod: "week" })?.target).toEqual(
      { value: 5, period: "week" },
    );
    expect(parseTargetValue({ ...sauna, type: "number", target: "2,5" }, "pt-PT")).toBe(2.5);
  });
});

describe("editing a stored tracker", () => {
  const stored = {
    template: "sauna" as const,
    name: "Sauna",
    icon: "flame" as const,
    type: "duration" as const,
    unit: null,
    decimals: 0,
    aggregation: "sum" as const,
    target: { value: 1200, period: "day" as const },
    shared: true,
    aiVisible: true,
    locked: true,
  };

  test("round-trips the target in minutes and leaves locked fields out", () => {
    const draft = draftFromTracker(stored);
    expect(draft).toMatchObject({ target: "20 min", targetEnabled: true, shared: true });
    expect(trackerUpdatePayload("id-1", stored, { ...draft, name: "Hot room" })).toEqual({
      id: "id-1",
      name: "Hot room",
      icon: "flame",
      target: { value: 1200, period: "day" },
      decimals: 0,
      shared: true,
      aiVisible: true,
    });
    expect(trackerUpdatePayload("id-1", { locked: false }, draft)).toMatchObject({
      type: "duration",
      unit: null,
      aggregation: "sum",
    });
  });
});
