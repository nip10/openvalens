import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import sampleManifest from "../sample/workout-guide-sample.json" with { type: "json" };
import { isAllowedWgerImageUrl, isAllowedWorkoutGuideUrl } from "./media-download";
import { sampleFrameDir, sampleSnapshot, sampleWorkoutGuideEntries } from "./sample";
import {
  parseWorkoutGuideEntries,
  parseWorkoutGuideManifest,
  parseWorkoutGuideMediaId,
  WORKOUT_GUIDE,
  WORKOUT_GUIDE_RAW_BASE,
  workoutGuideAttribution,
  workoutGuideMediaId,
} from "./workout-guide";
import { WORKOUT_GUIDE_TO_WGER } from "./workout-guide-map";

const clone = () => JSON.parse(JSON.stringify(sampleManifest)) as any[];

describe("Workout Guide manifest (#400)", () => {
  test("parses the sample entries with three PNG frames each", () => {
    const entries = sampleWorkoutGuideEntries();
    expect(entries).toHaveLength(12);
    const squat = entries.find((entry) => entry.slug === "squat")!;
    expect(squat.frames.map((frame) => frame.pngPath)).toEqual([
      "assets/squat/frame-1.png",
      "assets/squat/frame-2.png",
      "assets/squat/frame-3.png",
    ]);
  });

  test("rejects frames with other rights metadata", () => {
    const wrongLicence = clone();
    wrongLicence[0].frames[1].attribution.license = "CC BY 4.0";
    expect(() => parseWorkoutGuideEntries(wrongLicence)).toThrow("rights");
    const wrongCreator = clone();
    wrongCreator[0].attribution.creator = "Someone else";
    expect(() => parseWorkoutGuideEntries(wrongCreator)).toThrow("rights");
    const twoFrames = clone();
    twoFrames[0].frames.pop();
    expect(() => parseWorkoutGuideEntries(twoFrames)).toThrow("three frames");
    const badPath = clone();
    badPath[0].frames[0].path = "assets/../etc/frame-1.svg";
    expect(() => parseWorkoutGuideEntries(badPath)).toThrow("frame is invalid");
  });

  test("the full manifest must match the pinned SHA-256", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(sampleManifest));
    expect(() => parseWorkoutGuideManifest(bytes)).toThrow("pinned revision");
  });

  test("credits Bryl Lim and Everkinetic, with the upstream changes", () => {
    const entry = sampleWorkoutGuideEntries().find((item) =>
      item.frames.some((frame) => frame.changes),
    )!;
    const frame = entry.frames.find((item) => item.changes)!;
    const text = workoutGuideAttribution(frame);
    expect(text).toContain("Workout Guide by Bryl Lim");
    expect(text).toContain("Everkinetic");
    expect(text).toContain("CC BY-SA 4.0");
    expect(text).toContain(frame.changes!);
    expect(text).toContain(frame.everkineticUrl!);
  });

  test("media ids round-trip", () => {
    expect(workoutGuideMediaId("bench-press", 2)).toBe("workout-guide:bench-press/frame-2");
    expect(parseWorkoutGuideMediaId("workout-guide:bench-press/frame-2")).toEqual({
      slug: "bench-press",
      index: 2,
    });
    expect(parseWorkoutGuideMediaId("workout-guide:../x/frame-2")).toBeNull();
    expect(parseWorkoutGuideMediaId("359")).toBeNull();
  });
});

describe("slug map", () => {
  test("each wger exercise maps to at most one Workout Guide slug", () => {
    const ids = Object.values(WORKOUT_GUIDE_TO_WGER).flat();
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[1-9]\d*$/);
    for (const slug of Object.keys(WORKOUT_GUIDE_TO_WGER))
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  test("every sample frame set belongs to a sample exercise", () => {
    const sampleIds = new Set(sampleSnapshot().accepted.map((row) => row.externalId));
    for (const entry of sampleWorkoutGuideEntries()) {
      const mapped = WORKOUT_GUIDE_TO_WGER[entry.slug] ?? [];
      expect(mapped.some((id) => sampleIds.has(id))).toBe(true);
    }
  });
});

describe("committed sample", () => {
  test("all 12 records pass the normaliser with their own licences", () => {
    const snapshot = sampleSnapshot();
    expect(snapshot.accepted).toHaveLength(12);
    expect(snapshot.rejectedRecords).toBe(0);
    for (const row of snapshot.accepted) {
      expect(["CC-BY-SA-3.0", "CC-BY-SA-4.0"]).toContain(row.licenseCode!);
      expect(row.author).toBeTruthy();
      expect(row.media).toEqual([]);
    }
  });

  test("the frames are on disk", () => {
    const dir = sampleFrameDir();
    expect(dir).not.toBeNull();
    for (const entry of sampleWorkoutGuideEntries())
      for (const frame of entry.frames)
        expect(existsSync(join(dir!, entry.slug, `frame-${frame.index}.png`))).toBe(true);
  });
});

describe("download allowlists", () => {
  test("Workout Guide: only the pinned manifest and PNG frames", () => {
    expect(isAllowedWorkoutGuideUrl(new URL(`${WORKOUT_GUIDE_RAW_BASE}manifest.json`))).toBe(true);
    expect(
      isAllowedWorkoutGuideUrl(new URL(`${WORKOUT_GUIDE_RAW_BASE}assets/squat/frame-3.png`)),
    ).toBe(true);
    expect(
      isAllowedWorkoutGuideUrl(new URL(`${WORKOUT_GUIDE_RAW_BASE}assets/squat/frame-3.svg`)),
    ).toBe(false);
    expect(
      isAllowedWorkoutGuideUrl(
        new URL(
          WORKOUT_GUIDE_RAW_BASE.replace(WORKOUT_GUIDE.commit, "main") + "assets/squat/frame-1.png",
        ),
      ),
    ).toBe(false);
    expect(
      isAllowedWorkoutGuideUrl(new URL(`${WORKOUT_GUIDE_RAW_BASE}assets/squat/frame-1.png?x=1`)),
    ).toBe(false);
  });

  test("wger: fixed JPEG/PNG image paths only", () => {
    expect(
      isAllowedWgerImageUrl(new URL("https://wger.de/media/exercise-images/192/Bench-press-1.png")),
    ).toBe(true);
    expect(
      isAllowedWgerImageUrl(new URL("https://wger.de/media/exercise-images/12/4a42cc6f.webp")),
    ).toBe(false);
    expect(
      isAllowedWgerImageUrl(new URL("http://wger.de/media/exercise-images/192/Bench-press-1.png")),
    ).toBe(false);
    expect(isAllowedWgerImageUrl(new URL("https://evil.test/media/exercise-images/1/a.png"))).toBe(
      false,
    );
  });
});
