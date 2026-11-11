/**
 * FitPro (LM517-class) band and watch model registry.
 *
 * Ported from Gadgetbridge's FitPro family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name (`AbstractBLEDeviceCoordinator.supports`), so every pattern here is
 * written with explicit `^`/`$`. Matching is case-sensitive, as upstream's
 * patterns are.
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/fitpro/
 *   FitProConstants.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/fitpro/
 *   FitProDeviceCoordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/fitpro/
 *   FitProSampleProvider.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/fitpro/
 *   colacao/ColaCao21Coordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/fitpro/
 *   colacao/ColaCao23Coordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/fitpro/
 *   FitProDeviceSupport.java
 *
 * Every model in this family is a `pair_free` band that pushes stored history
 * after an ack-driven fetch trigger: 15-minute step buckets, staged sleep and
 * realtime heart rate. There is no advertisement-based capture.
 *
 * Transport
 * ---------
 * The family speaks a Nordic-UART-shaped protocol on the NON-standard
 * `…cca9d` suffix (the usual Nordic UART service ends in `…cca9e`). Service
 * `6e400001-b5a3-f393-e0a9-e50e24dcca9d`; writes go to the TX characteristic
 * `6e400002-…` and notifications arrive on the RX characteristic `6e400003-…`.
 * Upstream subscribes to RX and writes TX, and this registry keeps that
 * naming: `writeUuid` is TX, `notifyUuid` is RX.
 *
 * Name patterns
 * -------------
 * `FitProDeviceCoordinator.getSupportedDeviceName()` is one shared pattern:
 * `^(M6.*|M4.*|LH716|Sunset 6|Watch7|Fit1900|716|YBW-05|SERIES 11|BRAZ-7HAR)$`.
 * The two ColaCao coordinators override it with `ColaCao21` / `ColaCao23`
 * (unanchored upstream, but `matches()` anchors the whole string). Two
 * catalogued models, D13 116Plus and Y68, have no coordinator pattern at the
 * pin; their entries are marked `namePatternSource: "catalog"` and use the
 * marketed name, which is not verified against hardware.
 *
 * Heart rate
 * ----------
 * The ColaCao coordinators override `supportsHeartRateMeasurement()` to false
 * ("HR requests crash the device"), so `heartRateMeasurement` is false for
 * those two models and the session does not enable the realtime stream for
 * them. The codec still parses heart-rate notifications: the flag gates the
 * request, not the parser.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the codec is expected to reach;
 * it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** FitPro UART service (`6e400001-…-cca9d`). */
export const FITPRO_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9d";
/** Phone → band write characteristic (`6e400002-…-cca9d`). */
export const FITPRO_WRITE_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9d";
/** Band → phone notify characteristic (`6e400003-…-cca9d`). */
export const FITPRO_NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9d";

/** Record kinds this family can emit. */
export type FitProRecordType = "steps_interval" | "sleep_session" | "heart_rate";

/** Stable upstream YAML ids for the thirteen registered models. */
export type FitProModelId =
  | "colacao_2021"
  | "colacao_2023"
  | "fitpro_braz7harry"
  | "fitpro_d13_116plus"
  | "fitpro_fit_1900"
  | "fitpro_lh716"
  | "fitpro_m4"
  | "fitpro_m6"
  | "fitpro_series_11"
  | "fitpro_sunset_6"
  | "fitpro_watch_7"
  | "fitpro_y68"
  | "fitpro_ybw_05";

/**
 * Where a name pattern comes from. `coordinator` patterns are copied from the
 * upstream coordinator at the pin; `catalog` patterns describe a model the
 * upstream catalog lists under this vendor but that no coordinator claims, so
 * the pattern is the marketed name and is unverified.
 */
export type FitProNamePatternSource = "coordinator" | "catalog";

export type FitProModel = Readonly<{
  /** Upstream YAML id. */
  id: FitProModelId;
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
  /** Provenance of `bleNamePatterns`. */
  namePatternSource: FitProNamePatternSource;
  /**
   * Upstream `supportsHeartRateMeasurement()`; false for the two ColaCao
   * models, whose coordinator disables heart-rate requests.
   */
  heartRateMeasurement: boolean;
  /** Record kinds the model's capture path can emit. */
  records: readonly FitProRecordType[];
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const DEVICES_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/fitpro";
const SERVICE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/fitpro";

const SHARED_SOURCE_FILES: readonly string[] = [
  `${DEVICES_ROOT}/FitProConstants.java`,
  `${DEVICES_ROOT}/FitProDeviceCoordinator.java`,
  `${DEVICES_ROOT}/FitProSampleProvider.java`,
  `${SERVICE_ROOT}/FitProDeviceSupport.java`,
];

const RECORDS: readonly FitProRecordType[] = ["steps_interval", "sleep_session", "heart_rate"];

const SERVICES: readonly string[] = [FITPRO_SERVICE_UUID];

type ModelDefinition = Readonly<{
  id: FitProModelId;
  displayName: string;
  patterns: readonly RegExp[];
  namePatternSource?: FitProNamePatternSource;
  heartRateMeasurement?: boolean;
  /** Extra provenance files, relative to the app repo root. */
  extraSourceFiles?: readonly string[];
}>;

/**
 * The thirteen models, in upstream catalog order. Every model shares the same
 * capture path, so `records` and `serviceUuids` are identical; only the name
 * patterns and the heart-rate capability vary.
 */
const DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "colacao_2021",
    displayName: "ColaCao 2021",
    patterns: [/^ColaCao21$/],
    heartRateMeasurement: false,
    extraSourceFiles: [`${DEVICES_ROOT}/colacao/ColaCao21Coordinator.java`],
  },
  {
    id: "colacao_2023",
    displayName: "ColaCao 2023",
    patterns: [/^ColaCao23$/],
    heartRateMeasurement: false,
    extraSourceFiles: [`${DEVICES_ROOT}/colacao/ColaCao23Coordinator.java`],
  },
  {
    id: "fitpro_braz7harry",
    displayName: "FitPro BRAZ/7HARRY",
    patterns: [/^BRAZ-7HAR$/],
  },
  {
    id: "fitpro_d13_116plus",
    displayName: "FitPro D13 116Plus",
    patterns: [/^D13 116Plus$/],
    namePatternSource: "catalog",
  },
  {
    id: "fitpro_fit_1900",
    displayName: "FitPro Fit1900",
    patterns: [/^Fit1900$/],
  },
  {
    id: "fitpro_lh716",
    displayName: "FitPro LH716",
    // Upstream's shared pattern accepts both spellings for this model.
    patterns: [/^LH716$/, /^716$/],
  },
  {
    id: "fitpro_m4",
    displayName: "FitPro M4",
    patterns: [/^M4.*$/],
  },
  {
    id: "fitpro_m6",
    displayName: "FitPro M6",
    patterns: [/^M6.*$/],
  },
  {
    id: "fitpro_series_11",
    displayName: "FitPro Series 11",
    patterns: [/^SERIES 11$/],
  },
  {
    id: "fitpro_sunset_6",
    displayName: "FitPro Sunset 6",
    patterns: [/^Sunset 6$/],
  },
  {
    id: "fitpro_watch_7",
    displayName: "FitPro Watch 7",
    patterns: [/^Watch7$/],
  },
  {
    id: "fitpro_y68",
    displayName: "FitPro Y68",
    patterns: [/^Y68$/],
    namePatternSource: "catalog",
  },
  {
    id: "fitpro_ybw_05",
    displayName: "FitPro YBW-05",
    patterns: [/^YBW-05$/],
  },
];

export const FITPRO_MODELS: readonly FitProModel[] = DEFINITIONS.map((definition) => ({
  id: definition.id,
  displayName: definition.displayName,
  transportValidated: false,
  bleNamePatterns: definition.patterns,
  namePatternSource: definition.namePatternSource ?? "coordinator",
  heartRateMeasurement: definition.heartRateMeasurement ?? true,
  records: RECORDS,
  serviceUuids: SERVICES,
  sourceFiles: [...(definition.extraSourceFiles ?? []), ...SHARED_SOURCE_FILES],
}));

const MODEL_BY_ID = new Map<FitProModelId, FitProModel>(
  FITPRO_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getFitProModel(id: FitProModelId): FitProModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered FitPro model.
 *
 * Matching is name-only, like upstream's coordinator regex. Patterns are
 * full-string (Java `matches()`) and case-sensitive. Returns null when nothing
 * matches.
 */
export function matchFitProDevice(name: string | null | undefined): FitProModel | null {
  if (!name) return null;
  for (const model of FITPRO_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}
