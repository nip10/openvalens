/**
 * GloryFit smartwatch model registry.
 *
 * Ported from Gadgetbridge's GloryFit family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name; `matches()` anchors the whole string, so every pattern here is written
 * with explicit `^`/`$`. Matching is case-sensitive unless the upstream
 * coordinator passes `Pattern.CASE_INSENSITIVE` (only the HiFuture Zone 2
 * does).
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/gloryfit/GloryFitCoordinator.kt
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/gloryfit/watches/*.kt
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/gloryfit/GloryFitSupport.kt
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/gloryfit/GloryFitFetcher.kt
 *
 * Every model in this family is a `pair_free`/`feature_high` watch that syncs
 * stored history on connection: hourly step buckets, 10-minute heart-rate
 * blocks and sleep sessions with stages. There is no advertisement-based
 * capture. Six coordinators override upstream's default bonding style from ASK
 * to NONE; the rest keep ASK.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the parsers are expected to
 * reach; it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Command service (`000055ff-…`): small commands and their notifications. */
export const GLORYFIT_CMD_SERVICE_UUID = "000055ff-0000-1000-8000-00805f9b34fb";
/** Phone → watch command characteristic. */
export const GLORYFIT_CMD_WRITE_UUID = "000033f1-0000-1000-8000-00805f9b34fb";
/** Watch → phone command notification characteristic. */
export const GLORYFIT_CMD_NOTIFY_UUID = "000033f2-0000-1000-8000-00805f9b34fb";

/** Bulk-data service (`000056ff-…`): sleep stages and other bulk payloads. */
export const GLORYFIT_DATA_SERVICE_UUID = "000056ff-0000-1000-8000-00805f9b34fb";
/** Phone → watch bulk-data characteristic. */
export const GLORYFIT_DATA_WRITE_UUID = "000034f1-0000-1000-8000-00805f9b34fb";
/** Watch → phone bulk-data notification characteristic. */
export const GLORYFIT_DATA_NOTIFY_UUID = "000034f2-0000-1000-8000-00805f9b34fb";

/** Record kinds this family can emit. */
export type GloryFitRecordType = "steps_interval" | "heart_rate" | "sleep_session";

/** Stable upstream YAML ids for the seventeen registered watch models. */
export type GloryFitModelId =
  | "gloryfit_d3"
  | "gloryfit_r1"
  | "gloryfit_s52"
  | "gloryfit_swiss_peak"
  | "gloryfit_t70"
  | "gloryfit_y6"
  | "gloryfit_y66"
  | "blackview_r3max"
  | "colmi_p10"
  | "dotn_p66d"
  | "grv_fc1"
  | "haylou_watch_2_pro"
  | "hifuture_zone_2"
  | "imiki_frame_2"
  | "kieslect_calling_smartwatch_kr_pro"
  | "oukitel_bt103"
  | "qecnato_s10";

/**
 * Upstream bonding style. `none` means the coordinator overrides the default
 * `BONDING_STYLE_ASK`; `ask` is the inherited default.
 */
export type GloryFitBondingStyle = "ask" | "none";

export type GloryFitModel = Readonly<{
  /** Upstream YAML id. */
  id: GloryFitModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns, matched like upstream
   * `Matcher.matches()`. Case-sensitive unless the pattern carries the `i`
   * flag (the HiFuture coordinator is the only CASE_INSENSITIVE one).
   */
  bleNamePatterns: readonly RegExp[];
  /** Upstream bonding style. */
  bonding: GloryFitBondingStyle;
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Record kinds the model's capture path can emit. */
  records: readonly GloryFitRecordType[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const DEVICES_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/gloryfit";
const SERVICE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/gloryfit";

const SOURCE_FILES: readonly string[] = [
  `${DEVICES_ROOT}/GloryFitCoordinator.kt`,
  `${DEVICES_ROOT}/watches/BlackviewR3MaxCoordinator.kt`,
  `${DEVICES_ROOT}/watches/ColmiP10Coordinator.kt`,
  `${DEVICES_ROOT}/watches/D3Coordinator.kt`,
  `${DEVICES_ROOT}/watches/DotnP66DCoordinator.kt`,
  `${DEVICES_ROOT}/watches/GrvFc1Coordinator.kt`,
  `${DEVICES_ROOT}/watches/HaylouWatch2ProCoordinator.kt`,
  `${DEVICES_ROOT}/watches/HiFutureZone2Coordinator.kt`,
  `${DEVICES_ROOT}/watches/ImikiFrame2Coordinator.kt`,
  `${DEVICES_ROOT}/watches/KieslectCallingSmartwatchKrProCoordinator.kt`,
  `${DEVICES_ROOT}/watches/OukitelBT103Coordinator.kt`,
  `${DEVICES_ROOT}/watches/QecnatoS10Coordinator.kt`,
  `${DEVICES_ROOT}/watches/R1Coordinator.kt`,
  `${DEVICES_ROOT}/watches/S52Coordinator.kt`,
  `${DEVICES_ROOT}/watches/SwissPeakCoordinator.kt`,
  `${DEVICES_ROOT}/watches/T70Coordinator.kt`,
  `${DEVICES_ROOT}/watches/Y66Coordinator.kt`,
  `${DEVICES_ROOT}/watches/Y6Coordinator.kt`,
  `${SERVICE_ROOT}/GloryFitSupport.kt`,
  `${SERVICE_ROOT}/GloryFitFetcher.kt`,
];

const RECORDS: readonly GloryFitRecordType[] = ["steps_interval", "heart_rate", "sleep_session"];

const SERVICES: readonly string[] = [GLORYFIT_CMD_SERVICE_UUID, GLORYFIT_DATA_SERVICE_UUID];

/**
 * The seventeen models, in the shared identity catalog's order. Every model
 * shares the same capture path, so `records` and `serviceUuids` are identical.
 */
export const GLORYFIT_MODELS: readonly GloryFitModel[] = [
  {
    id: "gloryfit_d3",
    displayName: "GloryFit D3",
    transportValidated: false,
    bleNamePatterns: [/^D3\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "gloryfit_r1",
    displayName: "GloryFit R1",
    transportValidated: false,
    bleNamePatterns: [/^R1\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "gloryfit_s52",
    displayName: "GloryFit S52",
    transportValidated: false,
    bleNamePatterns: [/^S52$/],
    bonding: "none",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "gloryfit_swiss_peak",
    displayName: "GloryFit Swiss Peak",
    transportValidated: false,
    bleNamePatterns: [/^Swiss Peak-[0-9A-F]{4}$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "gloryfit_t70",
    displayName: "GloryFit T70",
    transportValidated: false,
    bleNamePatterns: [/^T70 *\(ID-[0-9A-F]{4}\)$/],
    bonding: "none",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "gloryfit_y6",
    displayName: "GloryFit Y6",
    transportValidated: false,
    bleNamePatterns: [/^Y6\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "gloryfit_y66",
    displayName: "GloryFit Y66",
    transportValidated: false,
    bleNamePatterns: [/^Y66\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "blackview_r3max",
    displayName: "Blackview R3 Max",
    transportValidated: false,
    bleNamePatterns: [/^R3Max\(ID-[0-9A-F]{4}\)$/],
    bonding: "none",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "colmi_p10",
    displayName: "Colmi P10",
    transportValidated: false,
    bleNamePatterns: [/^P10\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "dotn_p66d",
    displayName: "Dotn P66D",
    transportValidated: false,
    bleNamePatterns: [/^P66D\(ID-[0-9A-F]{4}\)$/],
    bonding: "none",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "grv_fc1",
    displayName: "GRV FC1",
    transportValidated: false,
    bleNamePatterns: [/^FC1\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "haylou_watch_2_pro",
    displayName: "Haylou Watch 2 Pro",
    transportValidated: false,
    bleNamePatterns: [/^HAYLOU Watch 2 Pro$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "hifuture_zone_2",
    displayName: "HiFuture Zone 2",
    transportValidated: false,
    bleNamePatterns: [/^Zone 2 *\(ID-[0-9A-F]{4}\)$/i],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "imiki_frame_2",
    displayName: "IMIKI Frame 2",
    transportValidated: false,
    bleNamePatterns: [/^IMIKI FRAME 2$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "kieslect_calling_smartwatch_kr_pro",
    displayName: "Kieslect Kr Pro",
    transportValidated: false,
    bleNamePatterns: [/^Watch Kr Pro-[0-9A-F]{4}$/],
    bonding: "none",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "oukitel_bt103",
    displayName: "Oukitel BT103",
    transportValidated: false,
    bleNamePatterns: [/^BT103\(ID-[0-9A-F]{4}\)$/],
    bonding: "ask",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
  {
    id: "qecnato_s10",
    displayName: "Qecnato S10",
    transportValidated: false,
    bleNamePatterns: [/^S10$/],
    bonding: "none",
    serviceUuids: SERVICES,
    records: RECORDS,
    sourceFiles: SOURCE_FILES,
  },
];

const MODEL_BY_ID = new Map<GloryFitModelId, GloryFitModel>(
  GLORYFIT_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getGloryFitModel(id: GloryFitModelId): GloryFitModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered GloryFit model.
 *
 * Matching is name-only: upstream has no UUID fallback for this family.
 * Patterns are full-string (Java `matches()`); only the HiFuture Zone 2
 * pattern is case-insensitive. Returns null when nothing matches.
 */
export function matchGloryFitDevice(name: string | null | undefined): GloryFitModel | null {
  if (!name) return null;
  for (const model of GLORYFIT_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}
