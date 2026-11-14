import { describe, expect, test } from "bun:test";

import {
  mapEach,
  mapHealthConnectMindfulness,
  mapMindfulSession,
  mapStateOfMind,
  type StateOfMindSampleLike,
} from "./map";

describe("HealthKit mindful sessions → duration entries (#452)", () => {
  test("a 10-minute session is 600 seconds at its start", () => {
    expect(
      mapMindfulSession({
        uuid: "HK-1",
        startDate: new Date("2026-11-14T07:00:00.000Z"),
        endDate: new Date("2026-11-14T07:10:00.000Z"),
      }),
    ).toEqual({ sourceRecordId: "HK-1", value: 600, loggedAt: "2026-11-14T07:00:00.000Z" });
  });

  test("rounds to whole seconds and drops empty or over-long sessions", () => {
    expect(
      mapMindfulSession({
        uuid: "HK-2",
        startDate: "2026-11-14T07:00:00.000Z",
        endDate: "2026-11-14T07:01:30.400Z",
      })?.value,
    ).toBe(90);
    expect(
      mapMindfulSession({
        uuid: "HK-3",
        startDate: "2026-11-14T07:00:00.000Z",
        endDate: "2026-11-14T07:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      mapMindfulSession({
        uuid: "HK-4",
        startDate: "2026-11-13T07:00:00.000Z",
        endDate: "2026-11-14T07:00:01.000Z",
      }),
    ).toBeNull();
    expect(
      mapMindfulSession({
        uuid: "",
        startDate: "2026-11-14T07:00:00Z",
        endDate: "2026-11-14T07:05:00Z",
      }),
    ).toBeNull();
  });
});

describe("HealthKit State of Mind → 1-5 mood (#452)", () => {
  const sample = (valenceClassification: number, kind = 2): StateOfMindSampleLike => ({
    uuid: `SOM-${valenceClassification}-${kind}`,
    startDate: "2026-11-14T20:00:00.000Z",
    kind,
    valenceClassification,
  });

  test("daily moods map through the fixed table", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((level) => mapStateOfMind(sample(level))?.value)).toEqual([
      1, 2, 2, 3, 4, 4, 5,
    ]);
    expect(mapStateOfMind(sample(6))).toEqual({
      sourceRecordId: "SOM-6-2",
      value: 4,
      loggedAt: "2026-11-14T20:00:00.000Z",
    });
  });

  test("momentary emotions and unknown levels are not imported", () => {
    expect(mapStateOfMind(sample(7, 1))).toBeNull();
    expect(mapStateOfMind(sample(9))).toBeNull();
    expect(mapEach([sample(1), sample(5, 1), sample(7)], mapStateOfMind)).toHaveLength(2);
  });
});

describe("Health Connect mindfulness → duration entries (#452)", () => {
  test("uses the record id and the session length", () => {
    expect(
      mapHealthConnectMindfulness({
        startTime: "2026-11-14T07:00:00.000Z",
        endTime: "2026-11-14T07:20:00.000Z",
        metadata: { id: "hc-1" },
      }),
    ).toEqual({ sourceRecordId: "hc-1", value: 1200, loggedAt: "2026-11-14T07:00:00.000Z" });
  });

  test("a record without an id cannot be imported idempotently, so it is dropped", () => {
    expect(
      mapHealthConnectMindfulness({
        startTime: "2026-11-14T07:00:00.000Z",
        endTime: "2026-11-14T07:20:00.000Z",
      }),
    ).toBeNull();
  });
});
