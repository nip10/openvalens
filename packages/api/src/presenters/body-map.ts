/**
 * Body map (Issue #94), shared by `apps/web` (`<svg>`) and `apps/native`
 * (`react-native-svg`). Both renderers draw the regions and colours returned
 * here, so the same scan gives the same colours and values on both.
 *
 * Two separate layers, never blended:
 * - Composition: each map region takes its value from the most specific DEXA
 *   region the scan actually reported. A map region with no reported source
 *   stays neutral; nothing is interpolated or inferred from weight.
 * - Training: working sets in the last 7 days per muscle (primary = 1,
 *   secondary = 0.5), from catalog-linked exercises only.
 *
 * The shapes are simple self-drawn outlines (no vendored artwork), on a
 * 200 × 400 view box per side.
 *
 * Labels and copy are Lingui message descriptors; the layers render their
 * legend and value text through the `i18n` they are given (#67).
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export type BodyMapView = "front" | "back";
export type BodyMapSide = "left" | "right";

export type BodyMapRegion = {
  /** Unique across both views, e.g. `front.biceps_left`. */
  id: string;
  view: BodyMapView;
  /** Screen-reader and legend label. "Left" is the member's left. */
  label: MessageDescriptor;
  path: string;
  /** DEXA regions this map region can show, most specific first. */
  dexaSources: readonly string[];
  /** Training group this region shows (both sides share one group). */
  trainingGroup: TrainingGroup | null;
};

export const BODY_MAP_VIEWBOX = "0 0 200 400";

function rect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

const HEAD = "M80 30A20 20 0 1 0 120 30A20 20 0 1 0 80 30Z";

export const TRAINING_GROUPS = [
  "shoulders",
  "chest",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "obliques",
  "traps",
  "lats",
  "lower_back",
  "glutes",
  "quads",
  "hamstrings",
  "calves",
] as const;
export type TrainingGroup = (typeof TRAINING_GROUPS)[number];

export const TRAINING_GROUP_LABELS: Readonly<Record<TrainingGroup, MessageDescriptor>> =
  Object.freeze({
    shoulders: msg`Shoulders`,
    chest: msg`Chest`,
    biceps: msg`Biceps`,
    triceps: msg`Triceps`,
    forearms: msg`Forearms`,
    abs: msg`Abs`,
    obliques: msg`Obliques`,
    traps: msg`Traps`,
    lats: msg`Lats`,
    lower_back: msg`Lower back`,
    glutes: msg`Glutes`,
    quads: msg`Quads`,
    hamstrings: msg`Hamstrings`,
    calves: msg`Calves`,
  });

/** Whole labels per side, so each language can agree the side with the part. */
type ShapeLabel = MessageDescriptor | { left: MessageDescriptor; right: MessageDescriptor };

type Shape = {
  name: string;
  label: ShapeLabel;
  /** Viewer-left x for a paired shape, or the full shape for a single one. */
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  dexa: (side: BodyMapSide | null) => string[];
  group: TrainingGroup | null;
  /** Paired shapes are mirrored around x = 100 for the other side. */
  paired: boolean;
};

const arm = (side: BodyMapSide | null) => (side ? [`${side}_arm`, "arms"] : ["arms"]);
const leg = (side: BodyMapSide | null) => (side ? [`${side}_leg`, "legs"] : ["legs"]);
const trunk = (side: BodyMapSide | null) => (side ? [`${side}_trunk`, "trunk"] : ["trunk"]);

const FRONT: Shape[] = [
  {
    name: "shoulder",
    label: { left: msg`Left shoulder (front)`, right: msg`Right shoulder (front)` },
    x: 52,
    y: 58,
    w: 24,
    h: 24,
    r: 10,
    dexa: arm,
    group: "shoulders",
    paired: true,
  },
  {
    name: "chest",
    label: { left: msg`Left chest (front)`, right: msg`Right chest (front)` },
    x: 76,
    y: 60,
    w: 24,
    h: 40,
    r: 6,
    dexa: (s) => ["ribs", ...trunk(s)],
    group: "chest",
    paired: true,
  },
  {
    name: "biceps",
    label: { left: msg`Left upper arm (front)`, right: msg`Right upper arm (front)` },
    x: 48,
    y: 84,
    w: 18,
    h: 44,
    r: 8,
    dexa: arm,
    group: "biceps",
    paired: true,
  },
  {
    name: "forearm",
    label: { left: msg`Left forearm (front)`, right: msg`Right forearm (front)` },
    x: 42,
    y: 130,
    w: 16,
    h: 50,
    r: 7,
    dexa: arm,
    group: "forearms",
    paired: true,
  },
  {
    name: "abs",
    label: { left: msg`Left abdomen (front)`, right: msg`Right abdomen (front)` },
    x: 80,
    y: 102,
    w: 20,
    h: 52,
    r: 5,
    dexa: (s) => ["android", ...trunk(s)],
    group: "abs",
    paired: true,
  },
  {
    name: "obliques",
    label: { left: msg`Left side (front)`, right: msg`Right side (front)` },
    x: 70,
    y: 102,
    w: 10,
    h: 48,
    r: 4,
    dexa: (s) => ["android", ...trunk(s)],
    group: "obliques",
    paired: true,
  },
  {
    name: "pelvis",
    label: msg`Hips (front)`,
    x: 72,
    y: 156,
    w: 56,
    h: 22,
    r: 8,
    dexa: () => ["gynoid", "pelvis", "trunk"],
    group: null,
    paired: false,
  },
  {
    name: "thigh",
    label: { left: msg`Left thigh (front)`, right: msg`Right thigh (front)` },
    x: 72,
    y: 180,
    w: 26,
    h: 80,
    r: 10,
    dexa: leg,
    group: "quads",
    paired: true,
  },
  {
    name: "shin",
    label: { left: msg`Left lower leg (front)`, right: msg`Right lower leg (front)` },
    x: 76,
    y: 266,
    w: 20,
    h: 80,
    r: 8,
    dexa: leg,
    group: null,
    paired: true,
  },
];

const BACK: Shape[] = [
  {
    name: "traps",
    label: msg`Upper back and neck (back)`,
    x: 80,
    y: 50,
    w: 40,
    h: 24,
    r: 8,
    dexa: () => ["trunk"],
    group: "traps",
    paired: false,
  },
  {
    name: "shoulder",
    label: { left: msg`Left shoulder (back)`, right: msg`Right shoulder (back)` },
    x: 52,
    y: 58,
    w: 24,
    h: 24,
    r: 10,
    dexa: arm,
    group: "shoulders",
    paired: true,
  },
  {
    name: "upper_back",
    label: { left: msg`Left upper back (back)`, right: msg`Right upper back (back)` },
    x: 74,
    y: 76,
    w: 26,
    h: 50,
    r: 6,
    dexa: (s) => ["ribs", ...trunk(s)],
    group: "lats",
    paired: true,
  },
  {
    name: "triceps",
    label: { left: msg`Left upper arm (back)`, right: msg`Right upper arm (back)` },
    x: 48,
    y: 84,
    w: 18,
    h: 44,
    r: 8,
    dexa: arm,
    group: "triceps",
    paired: true,
  },
  {
    name: "forearm",
    label: { left: msg`Left forearm (back)`, right: msg`Right forearm (back)` },
    x: 42,
    y: 130,
    w: 16,
    h: 50,
    r: 7,
    dexa: arm,
    group: "forearms",
    paired: true,
  },
  {
    name: "lower_back",
    label: { left: msg`Left lower back (back)`, right: msg`Right lower back (back)` },
    x: 80,
    y: 128,
    w: 20,
    h: 26,
    r: 6,
    dexa: (s) => ["android", "spine", ...trunk(s)],
    group: "lower_back",
    paired: true,
  },
  {
    name: "glutes",
    label: { left: msg`Left glute (back)`, right: msg`Right glute (back)` },
    x: 72,
    y: 156,
    w: 28,
    h: 30,
    r: 10,
    dexa: (s) => ["gynoid", "pelvis", ...trunk(s)],
    group: "glutes",
    paired: true,
  },
  {
    name: "hamstrings",
    label: { left: msg`Left back of thigh (back)`, right: msg`Right back of thigh (back)` },
    x: 72,
    y: 188,
    w: 26,
    h: 72,
    r: 10,
    dexa: leg,
    group: "hamstrings",
    paired: true,
  },
  {
    name: "calf",
    label: { left: msg`Left calf (back)`, right: msg`Right calf (back)` },
    x: 76,
    y: 266,
    w: 20,
    h: 80,
    r: 8,
    dexa: leg,
    group: "calves",
    paired: true,
  },
];

function regionsFor(view: BodyMapView, shapes: Shape[]): BodyMapRegion[] {
  const regions: BodyMapRegion[] = [
    {
      id: `${view}.head`,
      view,
      label: view === "front" ? msg`Head (front)` : msg`Head (back)`,
      path: HEAD,
      dexaSources: ["head"],
      trainingGroup: null,
    },
  ];
  for (const shape of shapes) {
    if (!shape.paired || !("left" in shape.label)) {
      regions.push({
        id: `${view}.${shape.name}`,
        view,
        label: "left" in shape.label ? shape.label.left : shape.label,
        path: rect(shape.x, shape.y, shape.w, shape.h, shape.r),
        dexaSources: shape.dexa(null),
        trainingGroup: shape.group,
      });
      continue;
    }
    // Front view: the member's right is on the viewer's left. Back view: the reverse.
    const viewerLeft: BodyMapSide = view === "front" ? "right" : "left";
    for (const side of [viewerLeft, viewerLeft === "left" ? "right" : "left"] as const) {
      const x = side === viewerLeft ? shape.x : 200 - shape.x - shape.w;
      regions.push({
        id: `${view}.${shape.name}_${side}`,
        view,
        label: shape.label[side],
        path: rect(x, shape.y, shape.w, shape.h, shape.r),
        dexaSources: shape.dexa(side),
        trainingGroup: shape.group,
      });
    }
  }
  return regions;
}

export const BODY_MAP_REGIONS: readonly BodyMapRegion[] = Object.freeze([
  ...regionsFor("front", FRONT),
  ...regionsFor("back", BACK),
]);

// ─── Colours ──────────────────────────────────────────────────────

/** Fill for a region with no measured or logged value. */
export const BODY_MAP_NEUTRAL = "#d4d4d8";
/** Low to high. Neutral blues: no good/bad reading is implied. */
export const BODY_MAP_SEQUENTIAL = Object.freeze([
  "#dbeafe",
  "#93c5fd",
  "#60a5fa",
  "#2563eb",
  "#1e3a8a",
]);
/** Lower, slightly lower, about the same, slightly higher, higher. Not red/green. */
export const BODY_MAP_DIVERGING = Object.freeze([
  "#6d28d9",
  "#c4b5fd",
  "#f4f4f5",
  "#fdba74",
  "#c2410c",
]);

export type LegendStep = { colour: string; label: string };
export type RegionFill = {
  colour: string;
  /** Formatted value for labels; null when the region has no value. */
  valueText: string | null;
  /** Where the value came from (DEXA region or training group). */
  sourceText: string | null;
};

// ─── Composition layer ───────────────────────────────────────────

export const DEXA_MEASUREMENT_LABELS: Readonly<
  Record<string, { label: MessageDescriptor; unit: string }>
> = Object.freeze({
  fat_pct: { label: msg`Fat`, unit: "%" },
  bmd: { label: msg`Bone density`, unit: " g/cm²" },
  lean_mass: { label: msg`Lean mass`, unit: " g" },
  fat_mass: { label: msg`Fat mass`, unit: " g" },
});

/** `Left Arm`, `arm_left`, `L-arm` → `left_arm`. Unknown names pass through lowercased. */
export function normalizeDexaRegion(region: string): string {
  const base = region
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const short = /^(l|r)_(.+)$/.exec(base);
  if (short) return `${short[1] === "l" ? "left" : "right"}_${short[2]}`;
  const suffix = /^(.+)_(left|right)$/.exec(base);
  if (suffix) return `${suffix[2]}_${suffix[1]}`;
  return base;
}

function dexaLabel(region: string): string {
  const words = region.replace(/_/g, " ");
  return `DEXA ${words}`;
}

function formatMeasurement(value: number, measurementType: string, signed = false): string {
  const unit = DEXA_MEASUREMENT_LABELS[measurementType]?.unit ?? "";
  const digits = measurementType === "bmd" ? 3 : 1;
  const text = value.toFixed(digits);
  return `${signed && value > 0 ? "+" : ""}${text}${unit}`;
}

type DexaValue = { region: string; measurementType: string; value: number };

function valuesByRegion(values: readonly DexaValue[], measurementType: string) {
  const map = new Map<string, number>();
  for (const row of values)
    if (row.measurementType === measurementType && Number.isFinite(row.value))
      map.set(normalizeDexaRegion(row.region), row.value);
  return map;
}

/** Measurement types the scan reported, in a stable order (known types first). */
export function dexaMeasurementTypes(values: readonly DexaValue[]): string[] {
  const present = new Set(values.map((row) => row.measurementType));
  const known = Object.keys(DEXA_MEASUREMENT_LABELS).filter((type) => present.has(type));
  const other = [...present].filter((type) => !(type in DEXA_MEASUREMENT_LABELS)).sort();
  return [...known, ...other];
}

function sequentialStep(value: number, min: number, max: number): number {
  if (max === min) return 2;
  return Math.min(4, Math.max(0, Math.floor(((value - min) / (max - min)) * 5)));
}

/**
 * Colours each map region from one scan, or from the change between two
 * scans of the same record. Regions without a reported source are neutral.
 */
export function compositionLayer(
  input: {
    measurementType: string;
    values: readonly DexaValue[];
    compareValues?: readonly DexaValue[];
  },
  i18n: I18n,
): { fills: Record<string, RegionFill>; legend: LegendStep[] } {
  const current = valuesByRegion(input.values, input.measurementType);
  const earlier = input.compareValues
    ? valuesByRegion(input.compareValues, input.measurementType)
    : null;
  const chosen = new Map<string, { source: string; value: number }>();
  for (const region of BODY_MAP_REGIONS) {
    const source = region.dexaSources.find(
      (candidate) => current.has(candidate) && (!earlier || earlier.has(candidate)),
    );
    if (source === undefined) continue;
    const value = earlier ? current.get(source)! - earlier.get(source)! : current.get(source)!;
    chosen.set(region.id, { source, value });
  }

  const fills: Record<string, RegionFill> = {};
  const neutral = { colour: BODY_MAP_NEUTRAL, valueText: null, sourceText: null };
  const values = [...chosen.values()].map((entry) => entry.value);
  let legend: LegendStep[] = [];

  if (earlier) {
    const maxAbs = Math.max(0, ...values.map(Math.abs));
    const step = (delta: number) => {
      if (maxAbs === 0 || Math.abs(delta) < maxAbs * 0.2) return 2;
      const strong = Math.abs(delta) > maxAbs * 0.6;
      return delta < 0 ? (strong ? 0 : 1) : strong ? 4 : 3;
    };
    for (const region of BODY_MAP_REGIONS) {
      const entry = chosen.get(region.id);
      const source = entry ? dexaLabel(entry.source) : "";
      fills[region.id] = entry
        ? {
            colour: BODY_MAP_DIVERGING[step(entry.value)]!,
            valueText: formatMeasurement(entry.value, input.measurementType, true),
            sourceText: i18n._(msg`Change in ${source}`),
          }
        : neutral;
    }
    if (values.length) {
      const f = (v: number) => formatMeasurement(v, input.measurementType, true);
      const strong = f(maxAbs * 0.6).slice(1);
      const slight = f(maxAbs * 0.2).slice(1);
      legend = [
        { colour: BODY_MAP_DIVERGING[0]!, label: i18n._(msg`Lower by more than ${strong}`) },
        { colour: BODY_MAP_DIVERGING[1]!, label: i18n._(msg`Slightly lower`) },
        { colour: BODY_MAP_DIVERGING[2]!, label: i18n._(msg`Within ${slight}`) },
        { colour: BODY_MAP_DIVERGING[3]!, label: i18n._(msg`Slightly higher`) },
        { colour: BODY_MAP_DIVERGING[4]!, label: i18n._(msg`Higher by more than ${strong}`) },
      ];
    }
  } else {
    const min = Math.min(...values);
    const max = Math.max(...values);
    for (const region of BODY_MAP_REGIONS) {
      const entry = chosen.get(region.id);
      fills[region.id] = entry
        ? {
            colour: BODY_MAP_SEQUENTIAL[sequentialStep(entry.value, min, max)]!,
            valueText: formatMeasurement(entry.value, input.measurementType),
            sourceText: dexaLabel(entry.source),
          }
        : neutral;
    }
    if (values.length)
      legend =
        max === min
          ? [
              {
                colour: BODY_MAP_SEQUENTIAL[2]!,
                label: formatMeasurement(min, input.measurementType),
              },
            ]
          : BODY_MAP_SEQUENTIAL.map((colour, index) => {
              const from = formatMeasurement(
                min + ((max - min) * index) / 5,
                input.measurementType,
              );
              const to = formatMeasurement(
                min + ((max - min) * (index + 1)) / 5,
                input.measurementType,
              );
              return { colour, label: i18n._(msg`${from} to ${to}`) };
            });
  }
  legend.push({ colour: BODY_MAP_NEUTRAL, label: i18n._(msg`Not reported by this scan`) });
  return { fills, legend };
}

// ─── Training layer ──────────────────────────────────────────────

/**
 * Catalog muscle names (wger English and Latin names) to training groups.
 * Names not listed here are reported as unmapped, never guessed.
 */
const MUSCLE_GROUPS: Readonly<Record<string, TrainingGroup>> = Object.freeze({
  shoulders: "shoulders",
  shoulder: "shoulders",
  "anterior deltoid": "shoulders",
  deltoid: "shoulders",
  deltoids: "shoulders",
  chest: "chest",
  "pectoralis major": "chest",
  "serratus anterior": "chest",
  biceps: "biceps",
  "biceps brachii": "biceps",
  brachialis: "biceps",
  triceps: "triceps",
  "triceps brachii": "triceps",
  forearms: "forearms",
  forearm: "forearms",
  brachioradialis: "forearms",
  abs: "abs",
  "rectus abdominis": "abs",
  obliques: "obliques",
  "obliquus externus abdominis": "obliques",
  trapezius: "traps",
  traps: "traps",
  lats: "lats",
  "latissimus dorsi": "lats",
  "lower back": "lower_back",
  "erector spinae": "lower_back",
  glutes: "glutes",
  "gluteus maximus": "glutes",
  quads: "quads",
  quadriceps: "quads",
  "quadriceps femoris": "quads",
  hamstrings: "hamstrings",
  "biceps femoris": "hamstrings",
  calves: "calves",
  gastrocnemius: "calves",
  soleus: "calves",
});

export function trainingGroupForMuscle(name: string): TrainingGroup | null {
  return MUSCLE_GROUPS[name.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

export type TrainingExerciseInput = {
  sets: number;
  muscles: readonly { name: string; role: "primary" | "secondary" }[];
};

/** Weekly working sets: thresholds for the legend only, not a recommendation. */
const SET_STEPS = [4, 8, 12, 16] as const;

/**
 * Sets per training group. An exercise counts once per group, at its
 * strongest role there (primary = 1 × sets, secondary = 0.5 × sets), so two
 * muscles in one group never double-count the same set.
 */
export function trainingLayer(
  exercises: readonly TrainingExerciseInput[],
  i18n: I18n,
): {
  setsByGroup: Record<TrainingGroup, number>;
  unmappedMuscles: string[];
  fills: Record<string, RegionFill>;
  legend: LegendStep[];
} {
  const setsByGroup = Object.fromEntries(TRAINING_GROUPS.map((group) => [group, 0])) as Record<
    TrainingGroup,
    number
  >;
  const unmapped = new Set<string>();
  for (const exercise of exercises) {
    const weight = new Map<TrainingGroup, number>();
    for (const muscle of exercise.muscles) {
      const group = trainingGroupForMuscle(muscle.name);
      if (!group) {
        unmapped.add(muscle.name);
        continue;
      }
      weight.set(group, Math.max(weight.get(group) ?? 0, muscle.role === "primary" ? 1 : 0.5));
    }
    for (const [group, factor] of weight) setsByGroup[group] += exercise.sets * factor;
  }

  const fills: Record<string, RegionFill> = {};
  for (const region of BODY_MAP_REGIONS) {
    const sets = region.trainingGroup ? setsByGroup[region.trainingGroup] : 0;
    if (!region.trainingGroup || sets === 0) {
      fills[region.id] = { colour: BODY_MAP_NEUTRAL, valueText: null, sourceText: null };
      continue;
    }
    const step = SET_STEPS.filter((threshold) => sets >= threshold).length;
    const count = formatSets(sets);
    fills[region.id] = {
      colour: BODY_MAP_SEQUENTIAL[step]!,
      valueText: i18n._(msg`${count} sets`),
      sourceText: i18n._(TRAINING_GROUP_LABELS[region.trainingGroup]),
    };
  }
  const legend: LegendStep[] = [
    { colour: BODY_MAP_SEQUENTIAL[0]!, label: i18n._(msg`Under 4 sets`) },
    { colour: BODY_MAP_SEQUENTIAL[1]!, label: i18n._(msg`4 to under 8`) },
    { colour: BODY_MAP_SEQUENTIAL[2]!, label: i18n._(msg`8 to under 12`) },
    { colour: BODY_MAP_SEQUENTIAL[3]!, label: i18n._(msg`12 to under 16`) },
    { colour: BODY_MAP_SEQUENTIAL[4]!, label: i18n._(msg`16 or more`) },
    { colour: BODY_MAP_NEUTRAL, label: i18n._(msg`No logged sets`) },
  ];
  return { setsByGroup, unmappedMuscles: [...unmapped].sort(), fills, legend };
}

export function formatSets(sets: number): string {
  return Number.isInteger(sets) ? String(sets) : sets.toFixed(1);
}

export const BODY_MAP_COPY = Object.freeze({
  intro: msg`Two separate views of your own records: measured DEXA values by region, and the sets you logged this week by muscle group.`,
  composition: msg`Colours come only from regions the selected scan measured. Regions the scan did not report stay grey; nothing is estimated.`,
  compare: msg`Shows the measured change per region between two of your scans.`,
  training: msg`Working sets in the last 7 days. A muscle the exercise mainly works counts 1 per set; a muscle it also works counts 0.5. Exercises not linked to the catalog are listed below and not counted.`,
});
