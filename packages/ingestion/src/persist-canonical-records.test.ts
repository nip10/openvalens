import { describe, expect, test } from "bun:test";

import { mobileIntentDedupeHash } from "./persist-canonical-records";

const sleepIntent = {
  kind: "health_event",
  canonicalType: "sleep_session",
  eventAt: "2026-03-07T23:00:00.000Z",
  endAt: "2026-03-08T07:00:00.000Z",
  title: null,
  sourceEventId: "same-vendor-session-id",
  sourceApp: "Wearable",
  rawRecord: { externalRecordId: "same-vendor-session-id" },
} as const;

describe("owner-aware sleep dedupe", () => {
  test("identical vendor ids and timestamps remain independent per owner", () => {
    expect(mobileIntentDedupeHash("apple_health", sleepIntent, "user-a")).not.toBe(
      mobileIntentDedupeHash("apple_health", sleepIntent, "user-b"),
    );
  });

  test("replays for the same owner retain the same hash", () => {
    expect(mobileIntentDedupeHash("apple_health", sleepIntent, "user-a")).toBe(
      mobileIntentDedupeHash("apple_health", sleepIntent, "user-a"),
    );
  });
});
