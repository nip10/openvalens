/**
 * The one shared list of things a member can log (#440). Pure TypeScript —
 * safe for the app bundle.
 *
 * Web (command palette), mobile (the "+" log picker), MCP write tools (#439 M2)
 * and custom trackers (#441) all read this list instead of keeping their own.
 * A kind says what it writes (its fields and units), how it saves (at once with
 * an undo, or as a draft / full form), which RBAC permission the save path
 * checks, and which feature setting must be on for it to appear.
 *
 * `availableLogKinds(context)` is the single filter: a kind shows only when the
 * member can write it and has the feature turned on. Custom trackers (#441)
 * and drink presets (#443, {@link drinkLogKinds}) pass their own kinds
 * through the same filter via the `kinds` argument, so there is one rule for
 * every surface. Pain (#442) is a built-in kind behind the member's own
 * pain-log opt-in.
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Action, Resource } from "@openvalens/auth/access/permissions";
import type { TrackerIcon } from "@openvalens/trackers/model";
import { isRole, ROLE_PERMISSION_PRESETS } from "@openvalens/auth/access/roles";
import { DRINK_PRESETS, type DrinkPresetKey } from "@openvalens/nutrition/drinks";
import { PAIN_RATING_MAX, PAIN_RATING_MIN } from "@openvalens/pain/model";

import type { PersonModule } from "../wellness-profile-contract";
import { DRINK_PRESET_LABELS } from "./drinks";
import { MANUAL_ENTRY_FIELDS, type ManualEntryField } from "./manual-entry";
import { SLEEP_QUALITY_MAX, SLEEP_QUALITY_MIN } from "./manual-sleep";

/** Built-in kinds. Custom kinds use their own ids (e.g. `tracker:<id>`, #441). */
export const BUILT_IN_LOG_KIND_IDS = [
  "weight",
  "blood_pressure",
  "heart_rate",
  "resting_heart_rate",
  "steps",
  "active_calories",
  "distance",
  "sleep",
  "lab_result",
  "private_measurement",
  "pain",
  "food",
  "water",
  "workout",
  "supplement_intake",
  "goal_checkin",
] as const;
export type BuiltInLogKindId = (typeof BUILT_IN_LOG_KIND_IDS)[number];

/**
 * `at_once`: saves the moment it is confirmed, then offers an undo toast and
 * stays editable. `draft`: opens a draft or the full form (food, labs,
 * workouts) because one value is not enough to save.
 */
export type LogSaveBehaviour = "at_once" | "draft";

/** The RBAC permission the kind's save path checks on the server. */
export type LogKindPermission = { resource: Resource; action: Extract<Action, "write"> };

/** A member preference that must be on, on top of the module. */
export type LogKindPreference = "plain_water" | "private_body" | "pain";

/** What must be turned on for the kind to appear. */
export type LogKindGate = {
  /** The `enabledModules` module, or `null` for always-on parts (goals). */
  module: PersonModule | null;
  preference?: LogKindPreference;
};

/** Platform-neutral icon keys; each app maps them to its lucide icon. */
export type LogKindIconKey =
  | "scale"
  | "gauge"
  | "heart-pulse"
  | "heart"
  | "footprints"
  | "flame"
  | "route"
  | "moon"
  | "flask"
  | "ruler"
  | "utensils"
  | "droplet"
  | "dumbbell"
  | "pill"
  | "target"
  | "person-standing"
  | "cup-soda"
  // Custom tracker icons (#441).
  | TrackerIcon;

/**
 * `yes_no`, `duration` (seconds; typed as "20 min", "1:30") and `text` (an
 * optional note) are used by custom trackers (#441).
 */
export type LogFieldType =
  | "number"
  | "datetime"
  | "rating"
  | "choice"
  | "yes_no"
  | "duration"
  | "text";

/**
 * Where a `choice` field's options come from: the member's own data, or a
 * fixed list (`pain_region`: the body map's regions and joint spots;
 * `pain_type`: ache, sharp, …).
 */
export type LogChoiceSource =
  | "lab_marker"
  | "private_measurement"
  | "supplement"
  | "goal"
  | "pain_region"
  | "pain_type";

export type LogUnit = {
  /** Stored unit code (`mmHg`, `bpm`, `kg`, `ml`, …). */
  code: string;
  /** Shown next to the value. */
  symbol: MessageDescriptor;
};

export type LogKindField = {
  id: string;
  label: MessageDescriptor;
  type: LogFieldType;
  required: boolean;
  unit?: LogUnit;
  /** Other units the member may type; the save path converts to `unit`. */
  acceptedUnits?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  /** Canonical metric the field writes through `healthRecord.ingestMetricSample`. */
  metricCode?: string;
  choiceSource?: LogChoiceSource;
};

export type LogKind<Id extends string = string> = {
  id: Id;
  label: MessageDescriptor;
  icon: LogKindIconKey;
  save: LogSaveBehaviour;
  permission: LogKindPermission;
  gate: LogKindGate;
  fields: readonly LogKindField[];
  /** Where the full form lives (expo-router paths drop the route groups). */
  paths: { web: string; native: string };
};

const unit = (code: string, symbol: MessageDescriptor): LogUnit => ({ code, symbol });

const RECORDS_WRITE: LogKindPermission = { resource: "records", action: "write" };

const observedAt: LogKindField = {
  id: "observedAt",
  label: msg`Time`,
  type: "datetime",
  required: false,
};

function metricField(
  id: string,
  field: ManualEntryField,
  overrides: Partial<LogKindField> = {},
): LogKindField {
  return {
    id,
    label: field.label,
    type: "number",
    required: true,
    unit: unit(field.unitCode, field.unit),
    min: field.min,
    max: field.max,
    step: field.step,
    metricCode: field.metric,
    ...overrides,
  };
}

function singleMetricKind(
  id: BuiltInLogKindId,
  field: ManualEntryField,
  icon: LogKindIconKey,
  module: PersonModule,
  paths: LogKind["paths"],
): LogKind<BuiltInLogKindId> {
  return {
    id,
    label: field.label,
    icon,
    save: "at_once",
    permission: RECORDS_WRITE,
    gate: { module },
    fields: [metricField("value", field), observedAt],
    paths,
  };
}

const VITALS_PATHS = { web: "/records/vitals", native: "/records/vitals" };
const ACTIVITY_PATHS = { web: "/records/activity", native: "/records/activity" };

export const LOG_KINDS: readonly LogKind<BuiltInLogKindId>[] = Object.freeze([
  {
    ...singleMetricKind("weight", MANUAL_ENTRY_FIELDS.weight, "scale", "body", {
      web: "/body",
      native: "/body",
    }),
    fields: [
      metricField("value", MANUAL_ENTRY_FIELDS.weight, { acceptedUnits: ["kg", "lb"] }),
      observedAt,
    ],
  },
  {
    id: "blood_pressure",
    label: msg`Blood pressure`,
    icon: "gauge",
    save: "at_once",
    permission: RECORDS_WRITE,
    gate: { module: "heart" },
    fields: [
      metricField("systolic", MANUAL_ENTRY_FIELDS.blood_pressure_systolic),
      metricField("diastolic", MANUAL_ENTRY_FIELDS.blood_pressure_diastolic),
      metricField("pulse", MANUAL_ENTRY_FIELDS.heart_rate, {
        label: msg`Pulse`,
        required: false,
      }),
      observedAt,
    ],
    paths: VITALS_PATHS,
  },
  singleMetricKind(
    "heart_rate",
    MANUAL_ENTRY_FIELDS.heart_rate,
    "heart-pulse",
    "heart",
    VITALS_PATHS,
  ),
  singleMetricKind(
    "resting_heart_rate",
    MANUAL_ENTRY_FIELDS.resting_heart_rate,
    "heart",
    "heart",
    VITALS_PATHS,
  ),
  singleMetricKind("steps", MANUAL_ENTRY_FIELDS.steps, "footprints", "activity", ACTIVITY_PATHS),
  singleMetricKind(
    "active_calories",
    MANUAL_ENTRY_FIELDS.active_calories,
    "flame",
    "activity",
    ACTIVITY_PATHS,
  ),
  singleMetricKind("distance", MANUAL_ENTRY_FIELDS.distance, "route", "activity", ACTIVITY_PATHS),
  {
    id: "sleep",
    label: msg`Sleep`,
    icon: "moon",
    save: "at_once",
    permission: RECORDS_WRITE,
    gate: { module: "sleep" },
    fields: [
      { id: "bedtime", label: msg`Bedtime`, type: "datetime", required: true },
      { id: "wakeAt", label: msg`Wake time`, type: "datetime", required: true },
      {
        id: "quality",
        label: msg`Quality`,
        type: "rating",
        required: false,
        min: SLEEP_QUALITY_MIN,
        max: SLEEP_QUALITY_MAX,
        step: 1,
      },
    ],
    paths: { web: "/records/sleep", native: "/records/sleep" },
  },
  {
    id: "lab_result",
    label: msg`Lab result`,
    icon: "flask",
    save: "draft",
    permission: RECORDS_WRITE,
    gate: { module: "labs" },
    fields: [
      {
        id: "marker",
        label: msg`Marker`,
        type: "choice",
        required: true,
        choiceSource: "lab_marker",
      },
      { id: "value", label: msg`Value`, type: "number", required: true },
      observedAt,
    ],
    paths: { web: "/records/labs", native: "/records/labs" },
  },
  {
    id: "private_measurement",
    label: msg`Private measurement`,
    icon: "ruler",
    save: "at_once",
    permission: { resource: "weight", action: "write" },
    gate: { module: "body", preference: "private_body" },
    fields: [
      {
        id: "measurement",
        label: msg`Measurement`,
        type: "choice",
        required: true,
        choiceSource: "private_measurement",
      },
      {
        // The unit follows the chosen measurement: cm/in, or kg/lb for weight.
        id: "value",
        label: msg`Value`,
        type: "number",
        required: true,
        acceptedUnits: ["cm", "in", "kg", "lb"],
      },
      observedAt,
    ],
    paths: { web: "/private-measurements", native: "/private-measurements" },
  },
  {
    // Pain (#442): only for a member who turned the pain log on; the server
    // also checks that the session is the member's own. The picker opens the
    // body map's pain layer to tap a region; a one-liner saves at once.
    id: "pain",
    label: msg`Pain`,
    icon: "person-standing",
    save: "at_once",
    permission: RECORDS_WRITE,
    gate: { module: "body", preference: "pain" },
    fields: [
      {
        id: "region",
        label: msg`Where`,
        type: "choice",
        required: true,
        choiceSource: "pain_region",
      },
      {
        id: "rating",
        label: msg`Rating from 0 to 10`,
        type: "rating",
        required: true,
        min: PAIN_RATING_MIN,
        max: PAIN_RATING_MAX,
        step: 1,
      },
      {
        id: "type",
        label: msg`Type (optional)`,
        type: "choice",
        required: false,
        choiceSource: "pain_type",
      },
      observedAt,
    ],
    // Mobile opens the pain layer from the link; the web palette passes it as search params.
    paths: { web: "/body-map", native: "/body-map?layer=pain" },
  },
  {
    id: "food",
    label: msg`Food`,
    icon: "utensils",
    save: "draft",
    permission: RECORDS_WRITE,
    gate: { module: "food" },
    fields: [],
    paths: { web: "/nutrition", native: "/nutrition" },
  },
  {
    id: "water",
    label: msg`Water`,
    icon: "droplet",
    save: "at_once",
    permission: RECORDS_WRITE,
    gate: { module: "food", preference: "plain_water" },
    fields: [
      {
        id: "quantity",
        label: msg`Amount`,
        type: "number",
        required: true,
        unit: unit("ml", msg({ message: "ml", comment: "Unit symbol; keep as is." })),
        acceptedUnits: ["ml", "l", "fl_oz"],
        min: 1,
        max: 5_000,
        step: 1,
      },
      observedAt,
    ],
    paths: { web: "/nutrition", native: "/nutrition" },
  },
  {
    id: "workout",
    label: msg`Workout`,
    icon: "dumbbell",
    save: "draft",
    permission: { resource: "workout", action: "write" },
    gate: { module: "activity" },
    fields: [],
    paths: { web: "/workouts", native: "/workouts" },
  },
  {
    id: "supplement_intake",
    label: msg`Supplement taken`,
    icon: "pill",
    save: "at_once",
    permission: { resource: "supplements", action: "write" },
    gate: { module: "supplements" },
    fields: [
      {
        id: "supplement",
        label: msg`Supplement`,
        type: "choice",
        required: true,
        choiceSource: "supplement",
      },
      observedAt,
    ],
    paths: { web: "/supplements", native: "/supplements" },
  },
  {
    id: "goal_checkin",
    label: msg`Goal check-in`,
    icon: "target",
    save: "at_once",
    permission: { resource: "goals", action: "write" },
    gate: { module: null },
    fields: [
      { id: "goal", label: msg`Goal`, type: "choice", required: true, choiceSource: "goal" },
      { id: "value", label: msg`Value`, type: "number", required: true },
      observedAt,
    ],
    paths: { web: "/goals", native: "/goals" },
  },
] satisfies LogKind<BuiltInLogKindId>[]);

/** What decides which kinds a member sees. */
export type LogKindContext = {
  /** The wellness profile's choice: `null` = not chosen yet (every module on). */
  enabledModules: readonly PersonModule[] | null | undefined;
  /** Member preferences; unknown (still loading) reads as off. */
  preferences: Partial<Record<LogKindPreference, boolean>>;
  /**
   * Whether the member's role grants a permission. Omit it to show every kind
   * the features allow; the server still checks the permission on save.
   */
  can?: (permission: LogKindPermission) => boolean;
};

/**
 * A `can` check from the member's workspace role (`sharing.me`), for
 * `LogKindContext.can`. An unknown role gives `undefined` (show every kind the
 * features allow); the server still checks the permission on save.
 */
export function logKindPermissionCheck(
  role: string | null | undefined,
): LogKindContext["can"] | undefined {
  if (!isRole(role)) return undefined;
  const matrix = ROLE_PERMISSION_PRESETS[role];
  return (permission) => matrix[permission.resource][permission.action];
}

export function isLogKindAvailable(kind: LogKind, context: LogKindContext): boolean {
  const { module, preference } = kind.gate;
  if (module !== null && Array.isArray(context.enabledModules)) {
    if (!context.enabledModules.includes(module)) return false;
  }
  if (preference !== undefined && context.preferences[preference] !== true) return false;
  if (context.can && !context.can(kind.permission)) return false;
  return true;
}

/**
 * The kinds the member can log now, in list order. Pass `kinds` to filter a
 * longer list (built-ins plus custom trackers) with the same rule.
 */
export function availableLogKinds<K extends LogKind>(
  context: LogKindContext,
  kinds: readonly K[] = LOG_KINDS as unknown as readonly K[],
): K[] {
  return kinds.filter((kind) => isLogKindAvailable(kind, context));
}

export function findLogKind(id: string): LogKind<BuiltInLogKindId> | undefined {
  return LOG_KINDS.find((kind) => kind.id === id);
}

// ─── Drink presets (#443) ────────────────────────────────────────

export type DrinkLogKindId = `drink:${DrinkPresetKey}`;

const DRINK_KIND_PREFIX = "drink:";

/** Largest drink volume a quick log accepts, in ml. */
export const DRINK_MAX_ML = 2_000;

export function drinkLogKindId(key: DrinkPresetKey): DrinkLogKindId {
  return `${DRINK_KIND_PREFIX}${key}`;
}

/** The preset key of a `drink:<key>` kind id, or null for any other kind. */
export function drinkPresetKeyOfLogKind(kindId: string): DrinkPresetKey | null {
  if (!kindId.startsWith(DRINK_KIND_PREFIX)) return null;
  const key = kindId.slice(DRINK_KIND_PREFIX.length);
  return DRINK_PRESETS.some((preset) => preset.key === key) ? (key as DrinkPresetKey) : null;
}

/**
 * One drink preset as a log kind. It saves at once as a catalog food in the
 * current meal slot (`nutritionDiary.logEntry`, method `preset`), with the
 * preset's volume unless another is typed ("beer 500"). Gated on the food
 * module, like food itself.
 */
export function drinkLogKind(key: DrinkPresetKey): LogKind<DrinkLogKindId> {
  return {
    id: drinkLogKindId(key),
    label: DRINK_PRESET_LABELS[key],
    icon: "cup-soda",
    save: "at_once",
    permission: RECORDS_WRITE,
    gate: { module: "food" },
    fields: [
      {
        id: "volume",
        label: msg`Amount`,
        type: "number",
        required: false,
        unit: unit("ml", msg({ message: "ml", comment: "Unit symbol; keep as is." })),
        acceptedUnits: ["ml", "cl", "l"],
        min: 1,
        max: DRINK_MAX_ML,
        step: 1,
      },
      observedAt,
    ],
    paths: { web: "/nutrition", native: "/nutrition" },
  };
}

/**
 * The drink presets the server can log now (`nutritionDrinks.presets`, the
 * `available` ones: the FDC catalog is imported), as log kinds in preset
 * order. Pass them to {@link availableLogKinds} with the built-ins.
 */
export function drinkLogKinds(
  presets: readonly { key: DrinkPresetKey; available: boolean }[] | null | undefined,
): LogKind<DrinkLogKindId>[] {
  const ready = new Set(
    (presets ?? []).filter((entry) => entry.available).map((entry) => entry.key),
  );
  return DRINK_PRESETS.filter((preset) => ready.has(preset.key)).map((preset) =>
    drinkLogKind(preset.key),
  );
}
