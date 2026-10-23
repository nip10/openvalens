import { describe, expect, test } from "bun:test";

import {
  BODY_MAP_DIVERGING,
  BODY_MAP_NEUTRAL,
  BODY_MAP_REGIONS,
  BODY_MAP_SEQUENTIAL,
  compositionLayer,
  dexaMeasurementTypes,
  normalizeDexaRegion,
  trainingLayer,
} from "./body-map";

const scan = [
  { region: "left_arm", measurementType: "fat_pct", value: 20 },
  { region: "right_arm", measurementType: "fat_pct", value: 22 },
  { region: "trunk", measurementType: "fat_pct", value: 30 },
  { region: "android", measurementType: "fat_pct", value: 35 },
  { region: "head", measurementType: "bmd", value: 2.1 },
];

describe("body map regions", () => {
  test("ids are unique and every region has a label and a path", () => {
    const ids = BODY_MAP_REGIONS.map((region) => region.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const region of BODY_MAP_REGIONS) {
      expect(region.label.length).toBeGreaterThan(0);
      expect(region.path).toMatch(/^M[\d .A-Z-]+Z$/);
    }
  });

  test("the member's left is on the viewer's right from the front, and on the left from the back", () => {
    const x = (id: string) =>
      Number(/^M([\d.]+)/.exec(BODY_MAP_REGIONS.find((region) => region.id === id)!.path)![1]);
    expect(x("front.biceps_left")).toBeGreaterThan(100);
    expect(x("back.triceps_left")).toBeLessThan(100);
  });
});

describe("compositionLayer", () => {
  test("colours only regions the scan reported, from the most specific source", () => {
    const { fills } = compositionLayer({ measurementType: "fat_pct", values: scan });
    expect(fills["front.biceps_left"]).toMatchObject({
      valueText: "20.0%",
      sourceText: "DEXA left arm",
    });
    // Android is more specific than trunk for the abdomen.
    expect(fills["front.abs_left"]).toMatchObject({
      valueText: "35.0%",
      colour: BODY_MAP_SEQUENTIAL[4],
    });
    // The chest has no android source, so it falls back to the reported trunk.
    expect(fills["front.chest_right"]).toMatchObject({ valueText: "30.0%" });
    // Legs and head (for fat %) were not reported: neutral, never interpolated.
    for (const id of ["front.thigh_left", "back.calf_right", "front.head"])
      expect(fills[id]).toEqual({ colour: BODY_MAP_NEUTRAL, valueText: null, sourceText: null });
  });

  test("is deterministic, so web and native draw the same colours and values", () => {
    const first = compositionLayer({ measurementType: "fat_pct", values: scan });
    const second = compositionLayer({ measurementType: "fat_pct", values: [...scan].reverse() });
    expect(second).toEqual(first);
    expect(
      Object.fromEntries(
        Object.entries(first.fills)
          .filter(([, fill]) => fill.valueText)
          .map(([id, fill]) => [id, `${fill.colour} ${fill.valueText}`]),
      ),
    ).toMatchSnapshot();
  });

  test("compare mode colours the measured change using a source both scans reported", () => {
    const earlier = [
      { region: "left_arm", measurementType: "fat_pct", value: 24 },
      { region: "right_arm", measurementType: "fat_pct", value: 22 },
      { region: "trunk", measurementType: "fat_pct", value: 28 },
    ];
    const { fills, legend } = compositionLayer({
      measurementType: "fat_pct",
      values: scan,
      compareValues: earlier,
    });
    expect(fills["front.biceps_left"]).toMatchObject({
      valueText: "-4.0%",
      colour: BODY_MAP_DIVERGING[0],
    });
    expect(fills["front.biceps_right"]).toMatchObject({
      valueText: "0.0%",
      colour: BODY_MAP_DIVERGING[2],
    });
    // Android is only in the newer scan, so the abdomen compares the trunk.
    expect(fills["front.abs_left"]).toMatchObject({ valueText: "+2.0%" });
    expect(fills["front.thigh_left"]!.colour).toBe(BODY_MAP_NEUTRAL);
    expect(legend.at(-1)).toEqual({ colour: BODY_MAP_NEUTRAL, label: "Not reported by this scan" });
  });

  test("normalizes region spellings and lists measurement types", () => {
    expect(normalizeDexaRegion("Left Arm")).toBe("left_arm");
    expect(normalizeDexaRegion("arm_right")).toBe("right_arm");
    expect(normalizeDexaRegion("L-leg")).toBe("left_leg");
    expect(normalizeDexaRegion("Android")).toBe("android");
    expect(
      dexaMeasurementTypes([...scan, { region: "x", measurementType: "zzz", value: 1 }]),
    ).toEqual(["fat_pct", "bmd", "zzz"]);
  });
});

describe("trainingLayer", () => {
  test("counts primary as 1 and secondary as 0.5, once per group, and lists unknown muscles", () => {
    const result = trainingLayer([
      // Bench press: 4 sets.
      {
        sets: 4,
        muscles: [
          { name: "Chest", role: "primary" },
          { name: "Triceps", role: "secondary" },
          { name: "Anterior deltoid", role: "secondary" },
        ],
      },
      // Curls: 3 sets. Biceps and brachialis share a group: counted once, as primary.
      {
        sets: 3,
        muscles: [
          { name: "Biceps", role: "primary" },
          { name: "Brachialis", role: "secondary" },
          { name: "Mystery muscle", role: "secondary" },
        ],
      },
    ]);
    expect(result.setsByGroup).toMatchObject({ chest: 4, triceps: 2, shoulders: 2, biceps: 3 });
    expect(result.setsByGroup.quads).toBe(0);
    expect(result.unmappedMuscles).toEqual(["Mystery muscle"]);
    expect(result.fills["front.chest_left"]).toMatchObject({
      valueText: "4 sets",
      colour: BODY_MAP_SEQUENTIAL[1],
    });
    expect(result.fills["back.shoulder_right"]).toMatchObject({ valueText: "2 sets" });
    expect(result.fills["front.thigh_left"]!.colour).toBe(BODY_MAP_NEUTRAL);
    expect(result.fills["front.head"]!.colour).toBe(BODY_MAP_NEUTRAL);
  });
});
