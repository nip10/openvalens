import { describe, expect, test } from "bun:test";

import {
  feedFitsTracker,
  feedsFor,
  feedSupportedOnIos,
  moodFromValenceClassification,
  sessionDurationSeconds,
  STATE_OF_MIND_CLASSIFICATIONS,
  TRACKER_FEED_DEFINITIONS,
  trackerFeedImportInput,
} from "./feeds";
import { findTrackerTemplate } from "./model";

describe("State of Mind → 1-5 mood (#452)", () => {
  test("the fixed table: 1 · 2,2 · 3 · 4,4 · 5", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(moodFromValenceClassification)).toEqual([1, 2, 2, 3, 4, 4, 5]);
  });

  test("names each of Apple's seven classifications, in order", () => {
    expect(STATE_OF_MIND_CLASSIFICATIONS.map((row) => row.key)).toEqual([
      "very_unpleasant",
      "unpleasant",
      "slightly_unpleasant",
      "neutral",
      "slightly_pleasant",
      "pleasant",
      "very_pleasant",
    ]);
  });

  test("an unknown classification maps to nothing", () => {
    expect(moodFromValenceClassification(0)).toBeNull();
    expect(moodFromValenceClassification(8)).toBeNull();
    expect(moodFromValenceClassification(2.5)).toBeNull();
  });

  test("the mood template keeps AI reads off by default", () => {
    expect(findTrackerTemplate("mood")?.aiVisible).toBe(false);
    expect(TRACKER_FEED_DEFINITIONS.healthkit_state_of_mind.template).toBe("mood");
  });
});

describe("mindful session → duration seconds (#452)", () => {
  test("rounds to whole seconds", () => {
    expect(sessionDurationSeconds("2026-11-14T07:00:00Z", "2026-11-14T07:10:00Z")).toBe(600);
    expect(sessionDurationSeconds("2026-11-14T07:00:00Z", "2026-11-14T07:00:59.6Z")).toBe(60);
    expect(
      sessionDurationSeconds(new Date("2026-11-14T07:00:00Z"), new Date("2026-11-14T08:05:00Z")),
    ).toBe(3900);
  });

  test("refuses empty, reversed, unreadable and over-24-hour sessions", () => {
    expect(sessionDurationSeconds("2026-11-14T07:00:00Z", "2026-11-14T07:00:00Z")).toBeNull();
    expect(sessionDurationSeconds("2026-11-14T07:00:00Z", "2026-11-14T07:00:00.4Z")).toBeNull();
    expect(sessionDurationSeconds("2026-11-14T07:10:00Z", "2026-11-14T07:00:00Z")).toBeNull();
    expect(sessionDurationSeconds("not a date", "2026-11-14T07:00:00Z")).toBeNull();
    expect(sessionDurationSeconds("2026-11-14T00:00:00Z", "2026-11-15T00:00:01Z")).toBeNull();
    expect(sessionDurationSeconds("2026-11-14T00:00:00Z", "2026-11-15T00:00:00Z")).toBe(86_400);
  });
});

describe("feeds and tracker types (#452)", () => {
  test("meditation feeds fill duration trackers; State of Mind fills 1-5 trackers", () => {
    expect(feedFitsTracker("healthkit_mindful_sessions", "duration")).toBe(true);
    expect(feedFitsTracker("health_connect_mindfulness", "duration")).toBe(true);
    expect(feedFitsTracker("healthkit_state_of_mind", "scale")).toBe(true);
    expect(feedFitsTracker("healthkit_mindful_sessions", "scale")).toBe(false);
    expect(feedFitsTracker("healthkit_state_of_mind", "duration")).toBe(false);
    expect(feedFitsTracker("healthkit_state_of_mind", "number")).toBe(false);
    expect(feedFitsTracker("health_connect_mindfulness", "yes_no")).toBe(false);
  });

  test("each phone offers only its own platform's feeds", () => {
    expect(feedsFor("ios", "duration")).toEqual(["healthkit_mindful_sessions"]);
    expect(feedsFor("ios", "scale")).toEqual(["healthkit_state_of_mind"]);
    expect(feedsFor("android", "duration")).toEqual(["health_connect_mindfulness"]);
    expect(feedsFor("android", "scale")).toEqual([]);
    expect(feedsFor("ios", "number")).toEqual([]);
  });

  test("State of Mind needs iOS 18; mindful minutes do not", () => {
    expect(feedSupportedOnIos("healthkit_state_of_mind", 17)).toBe(false);
    expect(feedSupportedOnIos("healthkit_state_of_mind", null)).toBe(false);
    expect(feedSupportedOnIos("healthkit_state_of_mind", 18)).toBe(true);
    expect(feedSupportedOnIos("healthkit_mindful_sessions", 16)).toBe(true);
  });

  test("Health Connect mindfulness is marked experimental", () => {
    expect(TRACKER_FEED_DEFINITIONS.health_connect_mindfulness.experimental).toBe(true);
    expect(TRACKER_FEED_DEFINITIONS.healthkit_mindful_sessions.experimental).toBe(false);
  });

  test("an import batch holds 1 to 200 entries with record ids", () => {
    const entry = { sourceRecordId: "A", value: 600, loggedAt: "2026-11-14T07:00:00Z" };
    const base = {
      feed: "healthkit_mindful_sessions",
      trackerId: "00000000-0000-4000-8000-000000000001",
      timeZone: "Europe/Lisbon",
    };
    expect(trackerFeedImportInput.safeParse({ ...base, entries: [entry] }).success).toBe(true);
    expect(trackerFeedImportInput.safeParse({ ...base, entries: [] }).success).toBe(false);
    expect(
      trackerFeedImportInput.safeParse({ ...base, entries: Array(201).fill(entry) }).success,
    ).toBe(false);
    expect(
      trackerFeedImportInput.safeParse({ ...base, entries: [{ ...entry, sourceRecordId: "" }] })
        .success,
    ).toBe(false);
  });
});
