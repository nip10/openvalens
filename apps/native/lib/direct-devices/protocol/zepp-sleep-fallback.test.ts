import { expect, test } from "bun:test";

import {
  segmentZeppSleep,
  zeppFallbackStage,
  type ZeppFallbackMinute,
} from "./zepp-sleep-fallback";

const T0 = Date.UTC(2026, 10, 5, 23, 0) / 1000;
/** Builds consecutive minutes from a compact spec: L/D/R sleep, . awake 0 steps, s awake with steps. */
function minutes(spec: string, start = T0): ZeppFallbackMinute[] {
  return [...spec].map((char, index) => ({
    time: start + index * 60,
    steps: char === "s" ? 12 : 0,
    sleep: char === "L" ? "light" : char === "D" ? "deep" : char === "R" ? "rem" : null,
  }));
}
const iso = (offsetMinutes: number) => new Date((T0 + offsetMinutes * 60) * 1000).toISOString();

test("the threshold stage map matches upstream", () => {
  expect(zeppFallbackStage(120, 0, 0)).toBe("light");
  expect(zeppFallbackStage(120, 43, 0)).toBe("deep");
  expect(zeppFallbackStage(120, 43 | 128, 56)).toBe("rem");
  expect(zeppFallbackStage(120, 42, 55)).toBe("light");
  expect(zeppFallbackStage(1, 99, 99)).toBeNull();
});

test("a session closes on a stepping minute; stages group by kind with a trailing minute", () => {
  const { sessions, openStart } = segmentZeppSleep(minutes("LLLLDDDDRR..LLs"));
  expect(openStart).toBeNull();
  expect(sessions).toHaveLength(1);
  // Upstream quirk: the first stage takes its kind from the second minute.
  expect(sessions[0]).toEqual({
    startTime: iso(0),
    endTime: iso(14),
    stages: [
      { stage: "light", startTime: iso(0), endTime: iso(3) },
      { stage: "deep", startTime: iso(3), endTime: iso(7) },
      { stage: "rem", startTime: iso(7), endTime: iso(9) },
      { stage: "awake", startTime: iso(9), endTime: iso(11) },
      { stage: "light", startTime: iso(11), endTime: iso(14) },
    ],
  });
});

test("more than an hour without sleep closes the session; short sessions are dropped", () => {
  const long = segmentZeppSleep(minutes("LLLLLLLL" + ".".repeat(61) + "LLL"));
  expect(long.sessions).toHaveLength(1);
  expect(long.sessions[0]!.endTime).toBe(iso(8));
  // The trailing three minutes are a new, still-open session.
  expect(long.openStart).toBe(T0 + 69 * 60);
  // 5 minutes including the pad is not a session.
  expect(segmentZeppSleep(minutes("LLLLs")).sessions).toEqual([]);
});

test("a night still in progress at the end of the data is reported open, not published", () => {
  const { sessions, openStart } = segmentZeppSleep(minutes("..LLLLLLDDDD"));
  expect(sessions).toEqual([]);
  expect(openStart).toBe(T0 + 2 * 60);
});
