import assert from "node:assert/strict";
import test from "node:test";

import { deriveSleepDailySummaries } from "./derive-daily-summary";

test("deriveSleepDailySummaries summarizes a single overnight session", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-1",
        start: "2026-03-07T23:30:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        sourceApp: "Oura",
        sourceDevice: "Ring Gen3",
        stageIntervals: [
          { stage: "awake", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T00:15:00.000Z" },
          { stage: "deep", start: "2026-03-08T00:15:00.000Z", end: "2026-03-08T01:15:00.000Z" },
          { stage: "rem", start: "2026-03-08T01:15:00.000Z", end: "2026-03-08T02:45:00.000Z" },
          { stage: "light", start: "2026-03-08T02:15:00.000Z", end: "2026-03-08T07:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0], {
    date: "2026-03-08",
    mainSleepStart: "2026-03-07T23:30:00.000Z",
    mainSleepEnd: "2026-03-08T07:00:00.000Z",
    mainSleepAsleepMinutes: 435,
    asleepMinutes: 435,
    timeInBedMinutes: 450,
    awakeMinutes: 15,
    sleepEfficiencyPct: 96.7,
    deepMinutes: 60,
    remMinutes: 90,
    lightMinutes: 255,
    unknownStageMinutes: 30,
    interruptionsCount: 1,
    sleepMidpoint: "2026-03-08T03:15:00.000Z",
    targetMinutes: 480,
    sleepDebtMinutes: 45,
    qualityScore: 76,
    confidence: "high",
    status: "acceptable",
    sourceSummary: "Oura / Ring Gen3",
    sessionIds: ["sleep-1"],
  });
});

test("deriveSleepDailySummaries combines nap and overnight sleep into one daily summary", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "overnight-1",
        start: "2026-03-07T23:30:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
      },
      {
        id: "nap-1",
        start: "2026-03-08T13:00:00.000Z",
        end: "2026-03-08T13:30:00.000Z",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.date, "2026-03-08");
  assert.deepEqual(summaries[0]!.sessionIds, ["overnight-1", "nap-1"]);
  assert.equal(summaries[0]!.mainSleepStart, "2026-03-07T23:30:00.000Z");
  assert.equal(summaries[0]!.mainSleepEnd, "2026-03-08T07:00:00.000Z");
  assert.equal(summaries[0]!.mainSleepAsleepMinutes, 450);
  assert.equal(summaries[0]!.asleepMinutes, 480);
  assert.equal(summaries[0]!.timeInBedMinutes, 480);
});

test("deriveSleepDailySummaries keeps main sleep asleep minutes separate from naps", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      { id: "overnight-2", start: "2026-03-07T23:00:00.000Z", end: "2026-03-08T03:00:00.000Z" },
      { id: "nap-3", start: "2026-03-08T13:00:00.000Z", end: "2026-03-08T15:00:00.000Z" },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.asleepMinutes, 360);
  assert.equal(summaries[0]!.mainSleepAsleepMinutes, 240);
});

test("deriveSleepDailySummaries chooses longer overnight sleep as main over wearable nap", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "phone-overnight",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        sourceDevice: "Phone",
      },
      {
        id: "ring-nap",
        start: "2026-03-08T13:00:00.000Z",
        end: "2026-03-08T13:30:00.000Z",
        sourceDevice: "Ring",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.mainSleepStart, "2026-03-07T23:00:00.000Z");
  assert.equal(summaries[0]!.mainSleepEnd, "2026-03-08T07:00:00.000Z");
  assert.equal(summaries[0]!.mainSleepAsleepMinutes, 480);
  assert.equal(summaries[0]!.asleepMinutes, 510);
});

test("deriveSleepDailySummaries does not let nested wearable nap discard longer overnight sleep", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "phone-overnight",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        sourceDevice: "Phone",
      },
      {
        id: "ring-nested",
        start: "2026-03-08T02:00:00.000Z",
        end: "2026-03-08T02:30:00.000Z",
        sourceDevice: "Ring",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.mainSleepStart, "2026-03-07T23:00:00.000Z");
  assert.equal(summaries[0]!.mainSleepEnd, "2026-03-08T07:00:00.000Z");
  assert.equal(summaries[0]!.mainSleepAsleepMinutes, 480);
  assert.equal(summaries[0]!.asleepMinutes, 480);
  assert.deepEqual(summaries[0]!.sessionIds, ["phone-overnight"]);
});

test("deriveSleepDailySummaries does not create phantom unknown minutes across disjoint sessions", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "overnight-1",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-07T23:00:00.000Z", end: "2026-03-08T07:00:00.000Z" },
        ],
      },
      {
        id: "nap-1",
        start: "2026-03-08T14:00:00.000Z",
        end: "2026-03-08T15:00:00.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T14:00:00.000Z", end: "2026-03-08T15:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.timeInBedMinutes, 540);
  assert.equal(summary.lightMinutes, 540);
  assert.equal(summary.unknownStageMinutes, 0);
  assert.equal(
    summary.deepMinutes +
      summary.remMinutes +
      summary.lightMinutes +
      summary.awakeMinutes +
      summary.unknownStageMinutes <=
      summary.timeInBedMinutes,
    true,
  );
});

test("deriveSleepDailySummaries keeps one summary per date and merges nap with overnight sleep", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "overnight-1",
        start: "2026-03-07T23:30:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        sourceApp: "Oura",
        sourceDevice: "Ring Gen3",
        stageIntervals: [
          { stage: "awake", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T00:15:00.000Z" },
          { stage: "deep", start: "2026-03-08T00:15:00.000Z", end: "2026-03-08T01:15:00.000Z" },
        ],
      },
      {
        id: "nap-2",
        start: "2026-03-08T13:00:00.000Z",
        end: "2026-03-08T13:30:00.000Z",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.date, "2026-03-08");
  assert.equal(summaries[0]!.mainSleepStart, "2026-03-07T23:30:00.000Z");
  assert.equal(summaries[0]!.mainSleepEnd, "2026-03-08T07:00:00.000Z");
  assert.equal(summaries[0]!.mainSleepAsleepMinutes, 435);
  assert.equal(summaries[0]!.asleepMinutes, 465);
  assert.equal(summaries[0]!.timeInBedMinutes, 480);
  assert.deepEqual(summaries[0]!.sessionIds, ["overnight-1", "nap-2"]);
});

test("deriveSleepDailySummaries keeps main sleep asleep minutes separate from nap sleep", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "overnight-2",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T03:00:00.000Z",
      },
      {
        id: "nap-3",
        start: "2026-03-08T13:00:00.000Z",
        end: "2026-03-08T15:00:00.000Z",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.asleepMinutes, 360);
  assert.equal(summaries[0]!.mainSleepAsleepMinutes, 240);
});

test("deriveSleepDailySummaries prefers wearable sessions over phone duplicates without double counting", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "phone-1",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        sourceApp: "Health",
        sourceDevice: "Phone",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T04:00:00.000Z" },
        ],
      },
      {
        id: "wearable-1",
        start: "2026-03-07T23:05:00.000Z",
        end: "2026-03-08T07:10:00.000Z",
        sourceApp: "Oura",
        sourceDevice: "Ring Gen3",
        stageIntervals: [
          { stage: "awake", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T00:10:00.000Z" },
          { stage: "deep", start: "2026-03-08T00:10:00.000Z", end: "2026-03-08T01:10:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(summary.date, "2026-03-08");
  assert.equal(summary.mainSleepStart, "2026-03-07T23:05:00.000Z");
  assert.equal(summary.mainSleepEnd, "2026-03-08T07:10:00.000Z");
  assert.deepEqual(summary.sessionIds, ["wearable-1"]);
  assert.equal((summary.timeInBedMinutes ?? 0) <= 485, true);
  assert.equal(summary.asleepMinutes <= (summary.timeInBedMinutes ?? 0), true);
});

test("deriveSleepDailySummaries prefers wearable source over a longer phone duplicate", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "phone-duplicate",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:20:00.000Z",
        sourceDevice: "Phone",
      },
      {
        id: "watch-duplicate",
        start: "2026-03-07T23:05:00.000Z",
        end: "2026-03-08T07:05:00.000Z",
        sourceDevice: "Watch",
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.mainSleepStart, "2026-03-07T23:05:00.000Z");
  assert.equal(summary.mainSleepEnd, "2026-03-08T07:05:00.000Z");
  assert.deepEqual(summary.sessionIds, ["watch-duplicate"]);
});

test("deriveSleepDailySummaries removes only true duplicate overlaps and keeps partial overlaps", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "phone-duplicate",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:20:00.000Z",
        sourceDevice: "Phone",
      },
      {
        id: "watch-duplicate",
        start: "2026-03-07T23:05:00.000Z",
        end: "2026-03-08T07:05:00.000Z",
        sourceDevice: "Watch",
      },
      {
        id: "nap-partial",
        start: "2026-03-08T06:30:00.000Z",
        end: "2026-03-08T07:30:00.000Z",
        sourceDevice: "Watch",
      },
    ],
  });

  const summary = summaries[0]!;
  assert.deepEqual(summary.sessionIds, ["watch-duplicate", "nap-partial"]);
});

test("deriveSleepDailySummaries only removes overlaps meeting the duplicate threshold per candidate", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "phone-true-duplicate",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        sourceDevice: "Phone",
      },
      {
        id: "watch-preferred-duplicate",
        start: "2026-03-07T23:05:00.000Z",
        end: "2026-03-08T07:05:00.000Z",
        sourceDevice: "Watch",
      },
      {
        id: "watch-partial",
        start: "2026-03-08T06:30:00.000Z",
        end: "2026-03-08T08:00:00.000Z",
        sourceDevice: "Watch",
      },
    ],
  });

  const summary = summaries[0]!;
  assert.deepEqual(summary.sessionIds, ["watch-preferred-duplicate", "watch-partial"]);
});

test("deriveSleepDailySummaries keeps partially overlapping sessions when overlap is below duplicate threshold", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "overnight-1",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
      },
      {
        id: "nap-partial",
        start: "2026-03-08T06:30:00.000Z",
        end: "2026-03-08T07:30:00.000Z",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.deepEqual(summaries[0]!.sessionIds, ["overnight-1", "nap-partial"]);
  assert.equal(summaries[0]!.timeInBedMinutes, 510);
  assert.equal(summaries[0]!.asleepMinutes, 510);
});

test("deriveSleepDailySummaries trims overlapping stage intervals before counting minutes", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-7",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        stageIntervals: [
          { stage: "deep", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T02:00:00.000Z" },
          { stage: "rem", start: "2026-03-08T01:30:00.000Z", end: "2026-03-08T03:00:00.000Z" },
          { stage: "light", start: "2026-03-08T03:00:00.000Z", end: "2026-03-08T07:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  const summary = summaries[0]!;
  assert.equal(
    summary.deepMinutes +
      summary.remMinutes +
      summary.lightMinutes +
      summary.awakeMinutes +
      summary.unknownStageMinutes <=
      (summary.timeInBedMinutes ?? 0),
    true,
  );
  assert.equal(summary.deepMinutes, 90);
  assert.equal(summary.remMinutes, 90);
});

test("deriveSleepDailySummaries counts uncovered in-session minutes as unknown stage minutes", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "partial-stage",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T01:30:00.000Z" },
        ],
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.timeInBedMinutes, 480);
  assert.equal(summary.lightMinutes, 30);
  assert.equal(summary.unknownStageMinutes, 450);
  assert.notEqual(summary.confidence, "high");
});

test("deriveSleepDailySummaries uses normalized stage coverage when intervals overlap", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "overlap-stage",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T04:00:00.000Z" },
          { stage: "deep", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T02:00:00.000Z" },
          { stage: "rem", start: "2026-03-08T03:30:00.000Z", end: "2026-03-08T04:30:00.000Z" },
        ],
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.lightMinutes, 150);
  assert.equal(summary.deepMinutes, 60);
  assert.equal(summary.remMinutes, 60);
  assert.equal(summary.unknownStageMinutes, 210);
  assert.equal(
    summary.awakeMinutes +
      summary.deepMinutes +
      summary.remMinutes +
      summary.lightMinutes +
      summary.unknownStageMinutes,
    summary.timeInBedMinutes,
  );
});

test("deriveSleepDailySummaries computes unknown minutes from normalized overlapping coverage", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-overlap-coverage",
        start: "2026-03-07T23:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T04:00:00.000Z" },
          { stage: "deep", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T02:00:00.000Z" },
          { stage: "rem", start: "2026-03-08T03:30:00.000Z", end: "2026-03-08T04:30:00.000Z" },
        ],
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.lightMinutes, 150);
  assert.equal(summary.deepMinutes, 60);
  assert.equal(summary.remMinutes, 60);
  assert.equal(summary.unknownStageMinutes, 210);
  assert.equal(
    summary.awakeMinutes +
      summary.deepMinutes +
      summary.remMinutes +
      summary.lightMinutes +
      summary.unknownStageMinutes,
    summary.timeInBedMinutes,
  );
});

test("deriveSleepDailySummaries does not expand second-offset stage intervals beyond session duration", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "second-offset-stage",
        start: "2026-03-08T00:00:30.000Z",
        end: "2026-03-08T00:10:31.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T00:00:30.000Z", end: "2026-03-08T00:10:31.000Z" },
        ],
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.timeInBedMinutes, 10);
  assert.equal(summary.lightMinutes, 10);
  assert.equal(
    summary.awakeMinutes +
      summary.deepMinutes +
      summary.remMinutes +
      summary.lightMinutes +
      summary.unknownStageMinutes,
    summary.timeInBedMinutes,
  );
});

test("deriveSleepDailySummaries reconciles multiple fractional stage intervals to session duration", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "fractional-stages",
        start: "2026-03-08T00:00:00.000Z",
        end: "2026-03-08T00:10:00.000Z",
        stageIntervals: [
          { stage: "awake", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T00:02:30.000Z" },
          { stage: "light", start: "2026-03-08T00:02:30.000Z", end: "2026-03-08T00:05:00.000Z" },
          { stage: "deep", start: "2026-03-08T00:05:00.000Z", end: "2026-03-08T00:07:30.000Z" },
          { stage: "rem", start: "2026-03-08T00:07:30.000Z", end: "2026-03-08T00:10:00.000Z" },
        ],
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.timeInBedMinutes, 10);
  assert.equal(
    summary.awakeMinutes +
      summary.deepMinutes +
      summary.remMinutes +
      summary.lightMinutes +
      summary.unknownStageMinutes,
    summary.timeInBedMinutes,
  );
});

test("deriveSleepDailySummaries applies stage precedence across overlaps", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-precedence",
        start: "2026-03-08T00:00:00.000Z",
        end: "2026-03-08T07:00:00.000Z",
        stageIntervals: [
          { stage: "light", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T07:00:00.000Z" },
          { stage: "deep", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T02:00:00.000Z" },
          { stage: "rem", start: "2026-03-08T04:00:00.000Z", end: "2026-03-08T05:00:00.000Z" },
        ],
      },
    ],
  });

  const summary = summaries[0]!;
  assert.equal(summary.deepMinutes, 60);
  assert.equal(summary.remMinutes, 60);
  assert.equal(summary.lightMinutes, 300);
});

test("deriveSleepDailySummaries rejects invalid durations", () => {
  assert.deepEqual(
    deriveSleepDailySummaries({
      targetMinutes: 480,
      sessions: [{ id: "missing-end", start: "2026-03-08T00:00:00.000Z", end: null }],
    }),
    [],
  );

  assert.deepEqual(
    deriveSleepDailySummaries({
      targetMinutes: 480,
      sessions: [
        { id: "negative", start: "2026-03-08T01:00:00.000Z", end: "2026-03-08T00:00:00.000Z" },
      ],
    }),
    [],
  );

  assert.deepEqual(
    deriveSleepDailySummaries({
      targetMinutes: 480,
      sessions: [
        { id: "too-short", start: "2026-03-08T00:00:00.000Z", end: "2026-03-08T00:09:00.000Z" },
      ],
    }),
    [],
  );

  assert.deepEqual(
    deriveSleepDailySummaries({
      targetMinutes: 480,
      sessions: [
        { id: "too-long", start: "2026-03-08T00:00:00.000Z", end: "2026-03-09T00:01:00.000Z" },
      ],
    }),
    [],
  );
});

test("deriveSleepDailySummaries skips invalid reversed and out-of-session stage intervals", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-3",
        start: "2026-03-08T23:00:00.000Z",
        end: "2026-03-09T07:00:00.000Z",
        stageIntervals: [
          { stage: "awake", start: "not-a-date", end: "2026-03-09T00:15:00.000Z" },
          { stage: "deep", start: "2026-03-09T01:00:00.000Z", end: "2026-03-09T00:30:00.000Z" },
          { stage: "light", start: "2026-03-08T22:30:00.000Z", end: "2026-03-08T23:15:00.000Z" },
          { stage: "awake", start: "2026-03-09T06:45:00.000Z", end: "2026-03-09T07:30:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(Number.isNaN(summaries[0]!.awakeMinutes), false);
  assert.equal(Number.isNaN(summaries[0]!.sleepEfficiencyPct ?? NaN), false);
  assert.equal(summaries[0]!.awakeMinutes, 15);
  assert.equal(summaries[0]!.sleepEfficiencyPct, 96.9);
  assert.equal(summaries[0]!.asleepMinutes, 465);
  assert.equal(summaries[0]!.deepMinutes, 0);
  assert.equal(summaries[0]!.lightMinutes, 15);
});

test("deriveSleepDailySummaries clamps excessive awake minutes within the session", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-4",
        start: "2026-03-08T23:00:00.000Z",
        end: "2026-03-09T07:00:00.000Z",
        stageIntervals: [
          { stage: "awake", start: "2026-03-08T22:00:00.000Z", end: "2026-03-09T08:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.awakeMinutes, 480);
  assert.equal(summaries[0]!.asleepMinutes, 0);
  assert.equal(summaries[0]!.sleepEfficiencyPct, 0);
  assert.equal(summaries[0]!.sleepDebtMinutes, 480);
  assert.equal(
    summaries[0]!.sleepEfficiencyPct! >= 0 && summaries[0]!.sleepEfficiencyPct! <= 100,
    true,
  );
  assert.equal(summaries[0]!.asleepMinutes >= 0, true);
});

test("deriveSleepDailySummaries counts awake interruptions deterministically and fragments low-efficiency sleep", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 400,
    sessions: [
      {
        id: "sleep-5",
        start: "2026-03-08T23:00:00.000Z",
        end: "2026-03-09T07:00:00.000Z",
        stageIntervals: [
          { stage: "awake", start: "2026-03-08T23:10:00.000Z", end: "2026-03-08T23:45:00.000Z" },
          { stage: "awake", start: "2026-03-09T00:45:00.000Z", end: "2026-03-09T01:25:00.000Z" },
          { stage: "awake", start: "2026-03-09T02:15:00.000Z", end: "2026-03-09T03:10:00.000Z" },
          { stage: "awake", start: "2026-03-09T04:00:00.000Z", end: "2026-03-09T04:40:00.000Z" },
          { stage: "awake", start: "2026-03-09T05:10:00.000Z", end: "2026-03-09T05:30:00.000Z" },
          { stage: "light", start: "2026-03-09T05:30:00.000Z", end: "2026-03-09T07:00:00.000Z" },
        ],
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.interruptionsCount, 5);
  assert.equal(summaries[0]!.sleepEfficiencyPct, 60.4);
  assert.equal(summaries[0]!.status, "fragmented_sleep");
});

test("deriveSleepDailySummaries keeps confidence uncertain without stage data", () => {
  const summaries = deriveSleepDailySummaries({
    targetMinutes: 480,
    sessions: [
      {
        id: "sleep-6",
        start: "2026-03-08T23:00:00.000Z",
        end: "2026-03-09T07:00:00.000Z",
      },
    ],
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]!.sleepEfficiencyPct, 100);
  assert.equal(summaries[0]!.confidence !== "high", true);
  assert.equal(summaries[0]!.unknownStageMinutes, 480);
});
