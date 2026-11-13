import { describe, expect, test } from "bun:test";

import {
  blankTrackerDraft,
  parseTargetValue,
  templateTrackerDraft,
  trackerCreatePayload,
  trackerDraftProblems,
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
