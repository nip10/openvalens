import { describe, expect, mock, test } from "bun:test";

// Loading the real `orpc` reads the server URL from `@/env`; the root test run
// has no web env unless an earlier file set one up.
mock.module("@/env", () => ({ ENV: { VITE_SERVER_URL: "https://health.example/" } }));

const { liftTrend, routineLifts } = await import("./workout-lifts");

describe("routineLifts", () => {
  test("each routine exercise once, by library id or by typed name", () => {
    const lifts = routineLifts([
      {
        exercises: [
          { exerciseId: 9, name: "Back squat" },
          { exerciseId: null, name: "Sled push" },
        ],
      },
      {
        exercises: [
          { exerciseId: 9, name: "Squat" },
          { exerciseId: null, name: "sled push" },
          { exerciseId: 12, name: "Bench press" },
        ],
      },
    ]);
    expect(lifts.map((lift) => [lift.name, lift.ref])).toEqual([
      ["Back squat", { exerciseId: 9 }],
      ["Sled push", { name: "Sled push" }],
      ["Bench press", { exerciseId: 12 }],
    ]);
  });
});

describe("liftTrend", () => {
  test("top sets oldest first and the change since the first", () => {
    const trend = liftTrend({
      items: [
        { date: "2026-11-10", topSetWeightKg: 85 },
        { date: "2026-10-01", topSetWeightKg: 75 },
        { date: "2026-10-20", topSetWeightKg: null },
        { date: "2026-10-25", topSetWeightKg: 80 },
      ],
    });
    expect(trend.values).toEqual([75, 80, 85]);
    expect(trend.change).toBe(10);
    expect(trend.first?.date).toBe("2026-10-01");
    expect(trend.latest?.date).toBe("2026-11-10");
  });

  test("one session has no change, and no sessions have no latest", () => {
    expect(liftTrend({ items: [{ date: "2026-11-10", topSetWeightKg: 60 }] }).change).toBeNull();
    expect(liftTrend(undefined).latest).toBeNull();
  });
});
