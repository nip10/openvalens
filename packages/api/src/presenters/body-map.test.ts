import { describe, expect, test } from "bun:test";

import { englishI18n, inEnglish } from "@openvalens/i18n/testing";
import { PAIN_JOINT_REGIONS, PAIN_MAP_REGIONS, PAIN_REGION_IDS } from "@openvalens/pain/model";

import { fitViewBox, normalizePath, pathBounds } from "./body-map-geometry";

import {
  BODY_MAP_DIVERGING,
  BODY_MAP_NEUTRAL,
  BODY_MAP_PAIN,
  BODY_MAP_REGIONS,
  BODY_MAP_SEQUENTIAL,
  BODY_MAP_VIEWBOX,
  bodyMapArtwork,
  compositionLayer,
  dexaMeasurementTypes,
  normalizeDexaRegion,
  PAIN_JOINT_LABELS,
  painLayer,
  painRegionLabel,
  painStep,
  trainingLayer,
} from "./body-map";
import { PAIN_REGION_LABELS, painRegionEntryLabel } from "./pain-entry";

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
      expect(inEnglish(region.label).length).toBeGreaterThan(0);
      expect(region.path).toMatch(/^M[\d .A-Z-]+Z$/);
    }
  });

  test("the member's left is on the viewer's right from the front, and on the left from the back", () => {
    const x = (id: string) =>
      Number(/^M([\d.]+)/.exec(BODY_MAP_REGIONS.find((region) => region.id === id)!.path)![1]);
    expect(x("front.biceps_left")).toBeGreaterThan(100);
    expect(x("back.triceps_left")).toBeLessThan(100);
  });

  test("labels name the member's side, the part and the view", () => {
    const label = (id: string) =>
      inEnglish(BODY_MAP_REGIONS.find((region) => region.id === id)!.label);
    expect(label("front.head")).toBe("Head (front)");
    expect(label("front.biceps_left")).toBe("Left upper arm (front)");
    expect(label("front.pelvis")).toBe("Hips (front)");
    expect(label("back.traps")).toBe("Upper back and neck (back)");
    expect(label("back.hamstrings_right")).toBe("Right back of thigh (back)");
  });
});

describe("body map artwork", () => {
  test("both figures share region ids, and every path stays inside the view box", () => {
    expect(BODY_MAP_VIEWBOX).toBe("0 0 200 400");
    const male = bodyMapArtwork("male");
    const female = bodyMapArtwork("female");
    expect(male.regions).toBe(BODY_MAP_REGIONS);
    expect(female.regions.map((region) => region.id)).toEqual(
      BODY_MAP_REGIONS.map((region) => region.id),
    );
    for (const artwork of [male, female]) {
      for (const view of ["front", "back"] as const) {
        expect(artwork.base[view]).toMatch(/^M[\d .A-Z-]+Z$/);
        expect(artwork.outline[view]).toMatch(/^M[\d .A-Z-]+$/);
      }
      for (const region of artwork.regions) {
        expect(region.path).toMatch(/^M[\d .A-Z-]+Z$/);
        const xs = [...region.path.matchAll(/[MLCSQT]([\d.-]+)/g)].map((match) => Number(match[1]));
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...xs)).toBeLessThanOrEqual(200);
      }
    }
    const x = (id: string) =>
      Number(/^M([\d.]+)/.exec(female.regions.find((region) => region.id === id)!.path)![1]);
    expect(x("front.biceps_left")).toBeGreaterThan(100);
    expect(x("back.triceps_left")).toBeLessThan(100);
  });

  test("normalizePath makes commands absolute, scales them, and reads packed arc flags", () => {
    const transform = { scale: 0.5, dx: 10, dy: 0 };
    expect(normalizePath("m10 20h10v10l-10 0z", transform)).toEqual({
      d: "M15 10H20V15L15 15Z",
      minX: 15,
      maxX: 20,
    });
    // "012.5" is large-arc 0, sweep 1, then x = 2.5.
    expect(normalizePath("M0 0a2 2 0 012.5 1z", transform).d).toBe("M10 0A1 1 0 0 1 11.25 0.5Z");
    expect(fitViewBox("724 0 724 1448")).toEqual({ scale: 200 / 724, dx: -200, dy: 0 });
  });
});

describe("compositionLayer", () => {
  test("colours only regions the scan reported, from the most specific source", () => {
    const { fills } = compositionLayer({ measurementType: "fat_pct", values: scan }, englishI18n);
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
    const first = compositionLayer({ measurementType: "fat_pct", values: scan }, englishI18n);
    const second = compositionLayer(
      { measurementType: "fat_pct", values: [...scan].reverse() },
      englishI18n,
    );
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
    const { fills, legend } = compositionLayer(
      { measurementType: "fat_pct", values: scan, compareValues: earlier },
      englishI18n,
    );
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
    expect(fills["front.biceps_left"]!.sourceText).toBe("Change in DEXA left arm");
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
    const result = trainingLayer(
      [
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
      ],
      englishI18n,
    );
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

  test("is deterministic, so web and native draw the same colours and values", () => {
    const result = trainingLayer(
      [
        { sets: 12, muscles: [{ name: "Quadriceps", role: "primary" }] },
        { sets: 6, muscles: [{ name: "Glutes", role: "secondary" }] },
      ],
      englishI18n,
    );
    expect(
      Object.fromEntries(
        Object.entries(result.fills)
          .filter(([, fill]) => fill.valueText)
          .map(([id, fill]) => [id, `${fill.colour} ${fill.valueText}`]),
      ),
    ).toMatchSnapshot();
  });
});

describe("pain layer (#442)", () => {
  const jointIds = Object.keys(PAIN_JOINT_REGIONS);

  test("the pain model's regions are the map's regions and labels plus the joint spots", () => {
    expect(Object.keys(PAIN_MAP_REGIONS)).toEqual(BODY_MAP_REGIONS.map((region) => region.id));
    for (const region of BODY_MAP_REGIONS)
      expect<string>(PAIN_MAP_REGIONS[region.id as keyof typeof PAIN_MAP_REGIONS]).toBe(
        inEnglish(region.label),
      );
    for (const [id, name] of Object.entries(PAIN_JOINT_REGIONS))
      expect(inEnglish(PAIN_JOINT_LABELS[id as keyof typeof PAIN_JOINT_LABELS])).toBe(name);
    for (const id of PAIN_REGION_IDS) expect(painRegionLabel(id)).not.toBeNull();
    expect(painRegionLabel("joint.tail")).toBeNull();
  });

  test("the light pain labels (quick log, no artwork) are the map's own labels", () => {
    expect(Object.keys(PAIN_REGION_LABELS).sort()).toEqual([...PAIN_REGION_IDS].sort());
    for (const id of PAIN_REGION_IDS) {
      expect(painRegionEntryLabel(id)?.id).toBe(painRegionLabel(id)!.id!);
      expect(inEnglish(painRegionEntryLabel(id)!)).toBe(inEnglish(painRegionLabel(id)!));
    }
    expect(painRegionEntryLabel("joint.tail")).toBeNull();
  });

  test("joint spots are only on the pain layer: never map regions, never composition or training fills", () => {
    const ids = new Set(BODY_MAP_REGIONS.map((region) => region.id));
    for (const id of jointIds) expect(ids.has(id)).toBe(false);
    const composition = compositionLayer({ measurementType: "fat_pct", values: scan }, englishI18n);
    const training = trainingLayer([], englishI18n);
    expect(Object.keys(composition.fills).sort()).toEqual([...ids].sort());
    expect(Object.keys(training.fills).sort()).toEqual([...ids].sort());
  });

  test("every joint spot is drawn on both figures, inside the view box and on the member's side", () => {
    for (const figure of ["male", "female"] as const) {
      const spots = bodyMapArtwork(figure).painSpots;
      const front: string[] = spots.filter((spot) => spot.view === "front").map((spot) => spot.id);
      const back: string[] = spots.filter((spot) => spot.view === "back").map((spot) => spot.id);
      // The jaw only from the front; everything else from both sides.
      expect(front.sort()).toEqual([...jointIds].sort());
      expect(back.sort()).toEqual(jointIds.filter((id) => !id.startsWith("joint.jaw")).sort());
      for (const spot of spots) {
        expect(spot.path).toMatch(/^M[\d .A-Z-]+Z$/);
        const box = pathBounds(spot.path)!;
        expect(box.minX).toBeGreaterThanOrEqual(0);
        expect(box.maxX).toBeLessThanOrEqual(200);
        expect(box.minY).toBeGreaterThanOrEqual(0);
        expect(box.maxY).toBeLessThanOrEqual(400);
      }
      const centre = (id: string, view: "front" | "back") => {
        const box = pathBounds(spots.find((spot) => spot.id === id && spot.view === view)!.path)!;
        return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
      };
      // Front: the member's left is on the viewer's right. Back: on the left.
      expect(centre("joint.knee_left", "front").x).toBeGreaterThan(100);
      expect(centre("joint.knee_left", "back").x).toBeLessThan(100);
      expect(centre("joint.jaw_left", "front").x).toBeGreaterThan(100);
      // Top to bottom: jaw, elbow, hip, knee, ankle.
      const order = ["joint.jaw_left", "joint.elbow_left", "joint.hip_left", "joint.knee_left"];
      const ys = order.map((id) => centre(id, "front").y);
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
      expect(centre("joint.ankle_foot_left", "front").y).toBeGreaterThan(ys.at(-1)!);
    }
  });

  test("colours the highest rating on a 5-step scale with no red, and grey without a rating", () => {
    const { fills, legend } = painLayer(
      [
        { region: "joint.knee_left", highest: 4, entryCount: 2 },
        { region: "front.thigh_left", highest: 10, entryCount: 1 },
        { region: "back.calf_right", highest: 0, entryCount: 1 },
      ],
      7,
      englishI18n,
    );
    expect(fills["joint.knee_left"]).toEqual({
      colour: BODY_MAP_PAIN[2]!,
      valueText: "Highest 4 of 10",
      sourceText: "2 ratings in the last 7 days",
    });
    expect(fills["front.thigh_left"]!.colour).toBe(BODY_MAP_PAIN[4]!);
    expect(fills["back.calf_right"]!.colour).toBe(BODY_MAP_PAIN[0]!);
    expect(fills["joint.knee_right"]).toEqual({
      colour: BODY_MAP_NEUTRAL,
      valueText: null,
      sourceText: null,
    });
    expect(Object.keys(fills)).toHaveLength(BODY_MAP_REGIONS.length + jointIds.length);
    expect(legend.map((step) => step.label)).toEqual([
      "0 to 1",
      "2 to 3",
      "4 to 5",
      "6 to 7",
      "8 to 10",
      "No rating",
    ]);
    expect(Array.from({ length: 11 }, (_, rating) => painStep(rating))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4,
    ]);
    // No alarm red: every step is a cool hue (blue), not 330-30 degrees.
    for (const colour of BODY_MAP_PAIN) {
      const [r, g, b] = [1, 3, 5].map((index) =>
        Number.parseInt(colour.slice(index, index + 2), 16),
      );
      expect(b!).toBeGreaterThan(r!);
      expect(g!).toBeGreaterThanOrEqual(r!);
    }
  });

  test("the wording is the same for every rating, number aside", () => {
    const text = (rating: number) =>
      JSON.stringify(
        painLayer([{ region: "joint.neck", highest: rating, entryCount: 1 }], 7, englishI18n).fills[
          "joint.neck"
        ],
      )
        .replace(/#[0-9a-f]{6}/g, "#")
        .replace(/\d+/g, "N");
    for (let rating = 1; rating <= 10; rating++) expect(text(rating)).toBe(text(0));
  });
});
