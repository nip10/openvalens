/**
 * Colmi / Yawell smart-ring model registry.
 *
 * Ported from Gadgetbridge's Yawell ring family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name; `matches()` anchors the whole string, so every pattern here is written
 * with explicit `^`/`$`. Matching is case-sensitive, as upstream's patterns
 * are: the Colmi R07/R10/R12 patterns spell out the `COLMI ` prefix, and the
 * Yawell patterns require an uppercase hex suffix.
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/yawell/ring/
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/yawell/ring/YawellRingDeviceSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/yawell/ring/YawellRingConstants.java
 *
 * Every model in this family is a GATT connection device (`pair_free` in the
 * upstream catalog) that syncs stored history on connection: 15-minute step
 * buckets, sleep sessions with stage breakdown, and 5-minute heart-rate
 * history. There is no advertisement-based capture.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the parsers are expected to
 * reach; it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/**
 * Yawell V1 (Nordic-style) service. Normal 16-byte commands are written to the
 * write characteristic and notifications arrive on the notify characteristic.
 */
export const COLMI_V1_SERVICE_UUID = "6e40fff0-b5a3-f393-e0a9-e50e24dcca9e";
export const COLMI_V1_WRITE_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const COLMI_V1_NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** Yawell V2 big-data service (sleep history). */
export const COLMI_V2_SERVICE_UUID = "de5bf728-d711-4e47-af26-65e3012a5dc7";
export const COLMI_V2_COMMAND_UUID = "de5bf72a-d711-4e47-af26-65e3012a5dc7";
export const COLMI_V2_NOTIFY_UUID = "de5bf729-d711-4e47-af26-65e3012a5dc7";

/** Record kinds this family can emit. */
export type ColmiRingRecordType = "steps_interval" | "sleep_session" | "heart_rate";

/** Stable upstream YAML ids for the eleven registered ring models. */
export type ColmiRingModelId =
  | "colmi_r02"
  | "colmi_r03"
  | "colmi_r06"
  | "colmi_r07"
  | "colmi_r09"
  | "colmi_r10"
  | "colmi_r12"
  | "yawell_r05"
  | "yawell_r10"
  | "yawell_r11"
  | "yawell_ai_health_watchpad";

export type ColmiRingModel = Readonly<{
  /** Upstream YAML id. */
  id: ColmiRingModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns, matched case-sensitively like
   * upstream `Matcher.matches()`.
   */
  bleNamePatterns: readonly RegExp[];
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Record kinds the model's capture path can emit. */
  records: readonly ColmiRingRecordType[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const SERVICE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/yawell/ring";

const SOURCE_FILES: readonly string[] = [
  `${SERVICE_ROOT}/YawellRingDeviceSupport.java`,
  `${SERVICE_ROOT}/YawellRingConstants.java`,
];

const RECORDS: readonly ColmiRingRecordType[] = ["steps_interval", "sleep_session", "heart_rate"];

const SERVICES: readonly string[] = [COLMI_V1_SERVICE_UUID, COLMI_V2_SERVICE_UUID];

/**
 * The eleven models, in upstream catalog order. Every model shares the same
 * capture path, so `records` and `serviceUuids` are identical.
 */
export const COLMI_RING_MODELS: readonly ColmiRingModel[] = [
  {
    id: "colmi_r02",
    displayName: "Colmi R02",
    transportValidated: false,
    bleNamePatterns: [/^R02_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_r03",
    displayName: "Colmi R03",
    transportValidated: false,
    bleNamePatterns: [/^R03_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_r06",
    displayName: "Colmi R06",
    transportValidated: false,
    bleNamePatterns: [/^R06_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_r07",
    displayName: "Colmi R07",
    transportValidated: false,
    bleNamePatterns: [/^COLMI R07_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_r09",
    displayName: "Colmi R09",
    transportValidated: false,
    bleNamePatterns: [/^R09_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_r10",
    displayName: "Colmi R10",
    transportValidated: false,
    bleNamePatterns: [/^COLMI R10_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_r12",
    displayName: "Colmi R12",
    transportValidated: false,
    bleNamePatterns: [/^COLMI R12_.*$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "yawell_r05",
    displayName: "Yawell R05",
    transportValidated: false,
    bleNamePatterns: [/^R05_[0-9A-F]{4}$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "yawell_r10",
    displayName: "Yawell R10",
    transportValidated: false,
    bleNamePatterns: [/^R10_[0-9A-F]{4}$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "yawell_r11",
    displayName: "Yawell R11",
    transportValidated: false,
    bleNamePatterns: [/^R11C?_[0-9A-F]{4}$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "yawell_ai_health_watchpad",
    displayName: "Yawell Y27 AI Health WatchPad",
    transportValidated: false,
    bleNamePatterns: [/^Y27_[0-9A-F]{4}$/],
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
];

const MODEL_BY_ID = new Map<ColmiRingModelId, ColmiRingModel>(
  COLMI_RING_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getColmiRingModel(id: ColmiRingModelId): ColmiRingModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered ring model.
 *
 * Matching is name-only: upstream has no UUID fallback for this family.
 * Patterns are full-string (Java `matches()`) and case-sensitive. Returns null
 * when nothing matches.
 */
export function matchColmiRingDevice(name: string | null | undefined): ColmiRingModel | null {
  if (!name) return null;
  for (const model of COLMI_RING_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}
