import { describe, expect, test } from "bun:test";

import { deriveSleepDailySummaries } from "./derive-daily-summary";
import { countedSleepSessions, isManualSleepPayload, manualSleepDuplicateIds } from "./manual";
import { manualSleepSessionsFromRows } from "./manual-sessions";
import { buildSleepDailySummariesFromEventRows } from "./queries";
import type { SleepSessionInput } from "./types";

const device: SleepSessionInput = {
  id: "device",
  start: "2026-11-11T23:30:00.000Z",
  end: "2026-11-12T06:30:00.000Z",
  sourceApp: "Oura",
};
const manualSameNight: SleepSessionInput = {
  id: "manual-1",
  start: "2026-11-11T23:00:00.000Z",
  end: "2026-11-12T07:00:00.000Z",
  sourceApp: "manual",
  manual: true,
};
const manualOtherNight: SleepSessionInput = {
  id: "manual-2",
  start: "2026-11-12T23:00:00.000Z",
  end: "2026-11-13T07:00:00.000Z",
  sourceApp: "manual",
  manual: true,
};

describe("manual sleep never overrides device sleep", () => {
  test("a manual night overlapping a device night is a possible duplicate", () => {
    expect([...manualSleepDuplicateIds([device, manualSameNight, manualOtherNight])]).toEqual([
      "manual-1",
    ]);
  });

  test("any overlap counts, even a short one", () => {
    const nap: SleepSessionInput = {
      id: "nap",
      start: "2026-11-12T06:00:00.000Z",
      end: "2026-11-12T08:00:00.000Z",
      manual: true,
    };
    expect(manualSleepDuplicateIds([device, nap]).has("nap")).toBe(true);
  });

  test("manual nights never flag each other or device nights", () => {
    expect(manualSleepDuplicateIds([manualSameNight, { ...manualSameNight, id: "m" }]).size).toBe(
      0,
    );
    expect(manualSleepDuplicateIds([device, { ...device, id: "device-2" }]).size).toBe(0);
  });

  test("the device night wins in totals; a lone manual night counts", () => {
    expect(
      countedSleepSessions([device, manualSameNight, manualOtherNight]).map((s) => s.id),
    ).toEqual(["device", "manual-2"]);
    const days = deriveSleepDailySummaries({
      sessions: [device, manualSameNight, manualOtherNight],
    });
    expect(days.map((day) => [day.date, day.asleepMinutes, day.sessionIds])).toEqual([
      ["2026-11-12", 420, ["device"]],
      ["2026-11-13", 480, ["manual-2"]],
    ]);
  });

  test("event rows marked entryMode manual are read as manual", () => {
    expect(isManualSleepPayload({ entryMode: "manual" })).toBe(true);
    expect(isManualSleepPayload({ sourceApp: "manual" })).toBe(false);
    expect(isManualSleepPayload(null)).toBe(false);
    const days = buildSleepDailySummariesFromEventRows([
      {
        id: 1,
        eventAt: new Date(device.start),
        title: null,
        payloadJson: { endAt: device.end, sourceApp: "Oura" },
      },
      {
        id: 2,
        eventAt: new Date(manualSameNight.start),
        title: null,
        payloadJson: { endAt: manualSameNight.end, entryMode: "manual", sourceApp: "manual" },
      },
    ]);
    expect(days[0]?.sessionIds).toEqual(["1"]);
    expect(days[0]?.asleepMinutes).toBe(420);
  });
});

describe("manualSleepSessionsFromRows", () => {
  const rows = [
    {
      id: 3,
      userId: "user-1",
      eventAt: new Date(manualOtherNight.start),
      payloadJson: { endAt: manualOtherNight.end, entryMode: "manual", quality: 4 },
    },
    {
      id: 2,
      userId: "user-1",
      eventAt: new Date(manualSameNight.start),
      payloadJson: { endAt: manualSameNight.end, entryMode: "manual" },
    },
    {
      id: 1,
      userId: null,
      eventAt: new Date(device.start),
      payloadJson: { endAt: device.end, sourceApp: "Oura" },
    },
    {
      id: 4,
      userId: "user-2",
      eventAt: new Date(manualOtherNight.start),
      payloadJson: { endAt: manualOtherNight.end, entryMode: "manual" },
    },
  ];

  test("lists only the member's own manual nights, flagging device overlaps", () => {
    expect(manualSleepSessionsFromRows(rows, "user-1")).toEqual([
      {
        id: 3,
        startAt: manualOtherNight.start,
        endAt: manualOtherNight.end as string,
        quality: 4,
        possibleDuplicate: false,
      },
      {
        id: 2,
        startAt: manualSameNight.start,
        endAt: manualSameNight.end as string,
        quality: null,
        possibleDuplicate: true,
      },
    ]);
  });

  test("respects the since cutoff", () => {
    expect(
      manualSleepSessionsFromRows(rows, "user-1", Date.parse("2026-11-12T12:00:00.000Z")).map(
        (session) => session.id,
      ),
    ).toEqual([3]);
  });
});
