import { z } from "zod";

/**
 * Pain log model (Issue #442). Pure TypeScript: the ids, bounds and input
 * shapes shared by the API, the Coach tool and the MCP tools.
 *
 * A pain entry is a record of what the member rated: one body-map region, a
 * 0-10 rating, an optional type, a time and an optional note. There is no
 * score, no likely cause and no guidance that changes with the value.
 */

export const PAIN_RATING_MIN = 0;
export const PAIN_RATING_MAX = 10;

export const PAIN_TYPES = [
  "ache",
  "sharp",
  "burning",
  "throbbing",
  "stiffness",
  "tingling",
] as const;
export type PainType = (typeof PAIN_TYPES)[number];

/** Days the pain layer looks back: 7 by default, 30 selectable. */
export const PAIN_MAP_WINDOWS = [7, 30] as const;
export type PainMapWindow = (typeof PAIN_MAP_WINDOWS)[number];

/** Days a region's history looks back. */
export const PAIN_HISTORY_WINDOWS = [30, 90, 365] as const;
export type PainHistoryWindow = (typeof PAIN_HISTORY_WINDOWS)[number];

/** A region's history shows workouts dated within this many days before a rating (48 h). */
export const PAIN_WORKOUT_LOOKBACK_DAYS = 2;

export const PAIN_LIMITS = Object.freeze({
  noteLength: 500,
  /** Regions one log call may cover (one entry each). */
  regionsPerLog: 12,
  /** Entries a region's history returns at most. */
  historyEntries: 200,
});

/**
 * The pain-only joint spots, member's left and right. They are drawn only on
 * the pain layer of the body map; the muscle regions are reused as they are.
 */
export const PAIN_JOINT_REGIONS = Object.freeze({
  "joint.neck": "Neck",
  "joint.jaw_left": "Left jaw",
  "joint.jaw_right": "Right jaw",
  "joint.elbow_left": "Left elbow",
  "joint.elbow_right": "Right elbow",
  "joint.wrist_hand_left": "Left wrist and hand",
  "joint.wrist_hand_right": "Right wrist and hand",
  "joint.hip_left": "Left hip",
  "joint.hip_right": "Right hip",
  "joint.knee_left": "Left knee",
  "joint.knee_right": "Right knee",
  "joint.ankle_foot_left": "Left ankle and foot",
  "joint.ankle_foot_right": "Right ankle and foot",
} as const);
export type PainJointRegion = keyof typeof PAIN_JOINT_REGIONS;

/**
 * The body-map regions (`packages/api/src/presenters/body-map.ts`) with their
 * English names, for the Coach and connected AI apps. A test in the API
 * package keeps this list equal to the map's regions and labels.
 */
export const PAIN_MAP_REGIONS = Object.freeze({
  "front.head": "Head (front)",
  "front.shoulder_right": "Right shoulder (front)",
  "front.shoulder_left": "Left shoulder (front)",
  "front.chest_right": "Right chest (front)",
  "front.chest_left": "Left chest (front)",
  "front.biceps_right": "Right upper arm (front)",
  "front.biceps_left": "Left upper arm (front)",
  "front.forearm_right": "Right forearm (front)",
  "front.forearm_left": "Left forearm (front)",
  "front.abs_right": "Right abdomen (front)",
  "front.abs_left": "Left abdomen (front)",
  "front.obliques_right": "Right side (front)",
  "front.obliques_left": "Left side (front)",
  "front.pelvis": "Hips (front)",
  "front.thigh_right": "Right thigh (front)",
  "front.thigh_left": "Left thigh (front)",
  "front.shin_right": "Right lower leg (front)",
  "front.shin_left": "Left lower leg (front)",
  "back.head": "Head (back)",
  "back.traps": "Upper back and neck (back)",
  "back.shoulder_left": "Left shoulder (back)",
  "back.shoulder_right": "Right shoulder (back)",
  "back.upper_back_left": "Left upper back (back)",
  "back.upper_back_right": "Right upper back (back)",
  "back.triceps_left": "Left upper arm (back)",
  "back.triceps_right": "Right upper arm (back)",
  "back.forearm_left": "Left forearm (back)",
  "back.forearm_right": "Right forearm (back)",
  "back.lower_back_left": "Left lower back (back)",
  "back.lower_back_right": "Right lower back (back)",
  "back.glutes_left": "Left glute (back)",
  "back.glutes_right": "Right glute (back)",
  "back.hamstrings_left": "Left back of thigh (back)",
  "back.hamstrings_right": "Right back of thigh (back)",
  "back.calf_left": "Left calf (back)",
  "back.calf_right": "Right calf (back)",
} as const);

/** Every region a pain entry may name, with its English name. */
export const PAIN_REGION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  ...PAIN_MAP_REGIONS,
  ...PAIN_JOINT_REGIONS,
});

export const PAIN_REGION_IDS: readonly string[] = Object.freeze(Object.keys(PAIN_REGION_NAMES));

export function isPainRegion(value: string): boolean {
  return Object.hasOwn(PAIN_REGION_NAMES, value);
}

/** The English name of a region, for AI tools; the apps use the localized label. */
export function painRegionName(region: string): string {
  return isPainRegion(region) ? PAIN_REGION_NAMES[region]! : region;
}

// ─── Days ─────────────────────────────────────────────────────

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDateIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds whole days to a calendar date. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Whole days from `earlier` to `later` (both YYYY-MM-DD). */
export function daysBetween(earlier: string, later: string): number {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000,
  );
}

// ─── Inputs ───────────────────────────────────────────────────

const timeZone = z.string().min(1).max(64).refine(isTimeZone, { message: "Unknown time zone." });
const region = z.string().min(1).max(60).refine(isPainRegion, { message: "Unknown body region." });

export const painPreferenceInput = z
  .strictObject({ enabled: z.boolean().optional(), aiVisible: z.boolean().optional() })
  .refine((input) => input.enabled !== undefined || input.aiVisible !== undefined, {
    message: "Choose a setting to change.",
  });

export const painLogInput = z.strictObject({
  /** One entry per region. */
  regions: z
    .array(region)
    .min(1)
    .max(PAIN_LIMITS.regionsPerLog)
    .refine((list) => new Set(list).size === list.length, { message: "Choose each region once." }),
  rating: z.number().int().min(PAIN_RATING_MIN).max(PAIN_RATING_MAX),
  type: z.enum(PAIN_TYPES).nullable().optional(),
  /** Defaults to now; never in the future. */
  loggedAt: z.iso.datetime({ offset: true }).optional(),
  timeZone,
  note: z
    .string()
    .trim()
    .max(PAIN_LIMITS.noteLength, { message: `Use up to ${PAIN_LIMITS.noteLength} characters.` })
    .nullable()
    .optional(),
});
export type PainLogInput = z.infer<typeof painLogInput>;

export const painEntryIdInput = z.strictObject({ id: z.uuid() });

export const painMapInput = z.strictObject({
  days: z
    .union(PAIN_MAP_WINDOWS.map((days) => z.literal(days)) as [z.ZodLiteral<7>, z.ZodLiteral<30>])
    .default(7),
  timeZone,
});

export const painHistoryInput = z.strictObject({
  region,
  days: z
    .union(
      PAIN_HISTORY_WINDOWS.map((days) => z.literal(days)) as [
        z.ZodLiteral<30>,
        z.ZodLiteral<90>,
        z.ZodLiteral<365>,
      ],
    )
    .default(90),
  timeZone,
});
