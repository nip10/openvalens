import { describe, expect, test } from "bun:test";

import { englishI18n } from "@openvalens/i18n/testing";

import { buildCockpitBlocks } from "./cockpit";

describe("cockpit presenter", () => {
  test("builds four blocks in fixed order with empty fallbacks", () => {
    const blocks = buildCockpitBlocks(
      {
        weight: null,
        sleep: null,
        activity: null,
        vitals: null,
      },
      englishI18n,
    );
    expect(blocks.map((b) => b.key)).toEqual(["weight", "sleep", "activity", "vitals"]);
    expect(blocks[0]?.primary).toBe("—");
    expect(blocks[0]?.secondary).toBe("No reading yet");
  });

  test("formats each block with the right primary value", () => {
    const blocks = buildCockpitBlocks(
      {
        weight: { date: "2026-10-01", weightKg: 72.4 },
        sleep: {
          date: "2026-10-01",
          asleepMinutes: 452,
          status: "acceptable",
          bedtime: "22:47",
          wakeAt: "06:19",
        },
        activity: {
          date: "2026-10-01",
          steps: 5000,
          activeCaloriesKcal: 320,
          distanceMeters: 4200,
        },
        vitals: { date: "2026-10-01", heartRateAvgBpm: 72 },
      },
      englishI18n,
    );
    expect(blocks[0]?.primary).toBe("72.4 kg");
    expect(blocks[1]?.primary).toBe("7h 32m");
    expect(blocks[1]?.tertiary).toBe("22:47 → 06:19");
    expect(blocks[1]?.secondary).toBe("2026-10-01, Acceptable");
    expect(blocks[3]?.secondary).toBe("Avg, 2026-10-01");
    expect(blocks[2]?.primary).toBe("5.0k");
    expect(blocks[3]?.primary).toBe("72 bpm");
  });

  test("sleep block omits tertiary when bedtime or wakeAt missing", () => {
    const blocks = buildCockpitBlocks(
      {
        weight: null,
        sleep: {
          date: "2026-10-01",
          asleepMinutes: 480,
          status: "optimal",
          bedtime: null,
          wakeAt: "06:00",
        },
        activity: null,
        vitals: null,
      },
      englishI18n,
    );
    expect(blocks[1]?.tertiary).toBeNull();
  });
});
