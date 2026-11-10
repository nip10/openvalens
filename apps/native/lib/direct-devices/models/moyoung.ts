/**
 * Moyoung / Da Fit watch and band model registry.
 *
 * Ported from Gadgetbridge's Moyoung family at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name (`AbstractDeviceCoordinator.supports`), so every pattern here is written
 * with explicit `^`/`$`. Matching is case-sensitive except where the upstream
 * coordinator passes `Pattern.CASE_INSENSITIVE` (only P22B1).
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/moyoung/
 *   AbstractMoyoungDeviceCoordinator.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/moyoung/
 *   *Coordinator.java (one per model; listed in each entry's `sourceFiles`)
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/moyoung/
 *   MoyoungConstants.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/moyoung/
 *   MoyoungDeviceSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/moyoung/
 *   MoyoungPacketIn.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/moyoung/
 *   MoyoungPacketOut.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/moyoung/
 *   FetchDataOperation.java
 *
 * Every model in this family is a `pair_free`/`feature_high` watch that syncs
 * stored history on connection. This registry only claims the two record kinds
 * the native codec actually produces: `heart_rate` history and `sleep_session`.
 * Steps are deliberately not mapped: the protocol only exposes daily totals
 * (CMD 51 args 1/2), which cannot be turned into honest intraday intervals.
 *
 * MTU differs per model: upstream's `getMtu()` returns 508 everywhere except
 * KW19-B and P22B1, which inherit the 20-byte default. The value selects the
 * packet framing mode (legacy size byte vs MTU-mode size high byte), so it is
 * part of the per-model contract rather than a transport tuning knob.
 *
 * `supportsHeartRateHistory` is upstream's `supportsHeartRateHistory()`; only
 * L70 overrides it to true. It gates the CMD 54 one-minute history request.
 * Upstream additionally marks Fire-Boltt Ninja Phantom, L70 and MT55 as
 * supporting realtime heart-rate streaming (`supportsHeartRateStreaming()`);
 * streaming is deliberately not wired in this codebase, so it is not recorded
 * as a capability here.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the codec is expected to reach;
 * it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Moyoung service (`feea`). */
export const MOYOUNG_SERVICE_UUID = "0000feea-0000-1000-8000-00805f9b34fb";
/** Realtime pedometer characteristic (`fee1`); read-only, not used for history. */
export const MOYOUNG_STEPS_UUID = "0000fee1-0000-1000-8000-00805f9b34fb";
/** Phone → watch packet characteristic (`fee2`). */
export const MOYOUNG_DATA_OUT_UUID = "0000fee2-0000-1000-8000-00805f9b34fb";
/** Watch → phone notify characteristic (`fee3`). */
export const MOYOUNG_DATA_IN_UUID = "0000fee3-0000-1000-8000-00805f9b34fb";

/** Record kinds this family can emit. */
export type MoyoungRecordType = "heart_rate" | "sleep_session";

/** Stable upstream YAML ids for the 31 registered models. */
export type MoyoungModelId =
  | "moyoung_blackview_r60"
  | "moyoung_colmi_i28_ultra"
  | "moyoung_colmi_p76"
  | "moyoung_colmi_p80"
  | "moyoung_colmi_p81"
  | "moyoung_colmi_v72"
  | "moyoung_colmi_v73"
  | "moyoung_colmi_v76"
  | "moyoung_colmi_v89"
  | "moyoung_zl02d"
  | "moyoung_advan_watch_se1_ai"
  | "moyoung_alt_vibe"
  | "moyoung_c20"
  | "moyoung_c20_pro"
  | "moyoung_hc96"
  | "moyoung_itech_active_3"
  | "moyoung_bettdow_fb051"
  | "moyoung_fireboltt_069"
  | "moyoung_fireboltt_ninja_phantom"
  | "moyoung_fireboltt_talk"
  | "moyoung_garett_eva"
  | "moyoung_ksix_venture"
  | "moyoung_kt80"
  | "moyoung_kw19_b"
  | "moyoung_l70"
  | "moyoung_misirun_c17"
  | "moyoung_mt55"
  | "moyoung_p22b1"
  | "moyoung_r50_pro"
  | "moyoung_rainbuvvy_t97"
  | "moyoung_viran_c29";

export type MoyoungModel = Readonly<{
  /** Upstream YAML id. */
  id: MoyoungModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns. `Matcher.matches()` anchors the whole
   * string, so patterns are written with explicit `^`/`$`; the P22B1 pattern is
   * case-insensitive like its upstream `Pattern.CASE_INSENSITIVE`.
   */
  bleNamePatterns: readonly RegExp[];
  /** Upstream coordinator MTU: 508 for most models, 20 for KW19-B and P22B1. */
  mtu: number;
  /** Upstream `supportsHeartRateHistory()`; gates the CMD 54 history request. */
  supportsHeartRateHistory: boolean;
  /** Record kinds the model's capture path can emit. */
  records: readonly MoyoungRecordType[];
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const DEVICES_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/moyoung";
const SERVICE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/moyoung";

const SHARED_SOURCE_FILES: readonly string[] = [
  `${DEVICES_ROOT}/AbstractMoyoungDeviceCoordinator.java`,
  `${DEVICES_ROOT}/MoyoungConstants.java`,
  `${SERVICE_ROOT}/MoyoungDeviceSupport.java`,
  `${SERVICE_ROOT}/MoyoungPacketIn.java`,
  `${SERVICE_ROOT}/MoyoungPacketOut.java`,
  `${SERVICE_ROOT}/FetchDataOperation.java`,
];

const RECORDS: readonly MoyoungRecordType[] = ["heart_rate", "sleep_session"];

const SERVICES: readonly string[] = [MOYOUNG_SERVICE_UUID];

type ModelDefinition = Readonly<{
  id: MoyoungModelId;
  displayName: string;
  /** Upstream coordinator class name, used for provenance. */
  coordinator: string;
  patterns: readonly RegExp[];
  mtu?: number;
  supportsHeartRateHistory?: boolean;
}>;

/**
 * The 31 models, in upstream catalog order. Every model shares the same capture
 * path, so `records` and `serviceUuids` are identical; only the name pattern,
 * MTU and heart-rate-history capability vary.
 */
const DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "moyoung_blackview_r60",
    displayName: "Moyoung Blackview R60",
    coordinator: "BlackviewR60Coordinator",
    patterns: [/^R60$/],
  },
  {
    id: "moyoung_colmi_i28_ultra",
    displayName: "Moyoung Colmi I28 Ultra",
    coordinator: "ColmiI28UltraCoordinator",
    patterns: [/^i28 Ultra$/],
  },
  {
    id: "moyoung_colmi_p76",
    displayName: "Moyoung Colmi P76",
    coordinator: "ColmiP76Coordinator",
    patterns: [/^P76J$/],
  },
  {
    id: "moyoung_colmi_p80",
    displayName: "Moyoung Colmi P80",
    coordinator: "ColmiP80Coordinator",
    patterns: [/^P80$/],
  },
  {
    id: "moyoung_colmi_p81",
    displayName: "Moyoung Colmi P81",
    coordinator: "ColmiP81Coordinator",
    patterns: [/^P81c$/],
  },
  {
    id: "moyoung_colmi_v72",
    displayName: "Moyoung Colmi V72",
    coordinator: "ColmiV72Coordinator",
    patterns: [/^V72$/],
  },
  {
    id: "moyoung_colmi_v73",
    displayName: "Moyoung Colmi V73",
    coordinator: "ColmiV73Coordinator",
    patterns: [/^V73$/],
  },
  {
    id: "moyoung_colmi_v76",
    displayName: "Moyoung Colmi V76",
    coordinator: "ColmiV76Coordinator",
    patterns: [/^V76$/],
  },
  {
    id: "moyoung_colmi_v89",
    displayName: "Moyoung Colmi V89",
    coordinator: "ColmiV89Coordinator",
    // Upstream pattern is `V89\.?`; matches() anchors it, so the trailing dot
    // is optional and nothing else may follow.
    patterns: [/^V89\.?$/],
  },
  {
    id: "moyoung_zl02d",
    displayName: "Moyoung ZL02D",
    coordinator: "ZL02DCoordinator",
    patterns: [/^ZL02D$/],
  },
  {
    id: "moyoung_advan_watch_se1_ai",
    displayName: "Moyoung Advan Watch SE1 AI",
    coordinator: "AdvanWatchSE1AICoordinator",
    patterns: [/^SE1$/],
  },
  {
    id: "moyoung_alt_vibe",
    displayName: "Moyoung Alt Vibe",
    coordinator: "AltVibeCoordinator",
    patterns: [/^Alt Vibe$/],
  },
  {
    id: "moyoung_c20",
    displayName: "Moyoung C20",
    coordinator: "C20Coordinator",
    patterns: [/^C *20$/],
  },
  {
    id: "moyoung_c20_pro",
    displayName: "Moyoung C20 Pro",
    coordinator: "C20ProCoordinator",
    patterns: [/^C20_Pro$/],
  },
  {
    id: "moyoung_hc96",
    displayName: "Moyoung HC96",
    coordinator: "HC96Coordinator",
    patterns: [/^HC96$/],
  },
  {
    id: "moyoung_itech_active_3",
    displayName: "Moyoung iTech Active 3",
    coordinator: "ITechActive3Coordinator",
    patterns: [/^iTECH Active 3$/],
  },
  {
    id: "moyoung_bettdow_fb051",
    displayName: "Moyoung Bettdow FB051",
    coordinator: "BettdowFB051Coordinator",
    patterns: [/^Bettdow FB051$/],
  },
  {
    id: "moyoung_fireboltt_069",
    displayName: "Moyoung Fireboltt 069",
    coordinator: "FireBoltt069Coordinator",
    patterns: [/^FireBoltt 069$/],
  },
  {
    id: "moyoung_fireboltt_ninja_phantom",
    displayName: "Moyoung Fireboltt Ninja Phantom",
    coordinator: "FireBolttNinjaPhantomCoordinator",
    patterns: [/^FB BGS001$/],
  },
  {
    id: "moyoung_fireboltt_talk",
    displayName: "Moyoung Fireboltt Talk",
    coordinator: "FireBolttTalkCoordinator",
    patterns: [/^FireBoltt 080$/],
  },
  {
    id: "moyoung_garett_eva",
    displayName: "Moyoung Garett Eva",
    coordinator: "GarettEvaCoordinator",
    patterns: [/^Garett Eva$/],
  },
  {
    id: "moyoung_ksix_venture",
    displayName: "Moyoung KSIX Venture",
    coordinator: "KsixVentureCoordinator",
    patterns: [/^KSIX VENTURE$/],
  },
  {
    id: "moyoung_kt80",
    displayName: "Moyoung KT80",
    coordinator: "KT80Coordinator",
    patterns: [/^KT80$/],
  },
  {
    id: "moyoung_kw19_b",
    displayName: "Moyoung KW19 B",
    coordinator: "KW19BCoordinator",
    patterns: [/^KW19-B$/],
    // No getMtu() override: inherits AbstractMoyoungDeviceCoordinator's 20.
    mtu: 20,
  },
  {
    id: "moyoung_l70",
    displayName: "Moyoung L70",
    coordinator: "L70Coordinator",
    patterns: [/^L *70$/],
    supportsHeartRateHistory: true,
  },
  {
    id: "moyoung_misirun_c17",
    displayName: "Moyoung Misirun C17",
    coordinator: "MisirunC17Coordinator",
    patterns: [/^C17$/],
  },
  {
    id: "moyoung_mt55",
    displayName: "Moyoung MT55",
    coordinator: "MT55Coordinator",
    patterns: [/^MT55$/],
  },
  {
    id: "moyoung_p22b1",
    displayName: "Moyoung P22B1",
    coordinator: "P22B1Coordinator",
    // `Pattern.compile("^P22B1", Pattern.CASE_INSENSITIVE)`; matches() anchors
    // the whole string, so this is exactly "P22B1" in any case.
    patterns: [/^P22B1$/i],
    mtu: 20,
  },
  {
    id: "moyoung_r50_pro",
    displayName: "Moyoung R50 Pro",
    coordinator: "R50ProCoordinator",
    patterns: [/^R50Pro$/],
  },
  {
    id: "moyoung_rainbuvvy_t97",
    displayName: "Moyoung Rainbuvvy T97",
    coordinator: "RainbuvvyT97Coordinator",
    patterns: [/^T97$/],
  },
  {
    id: "moyoung_viran_c29",
    displayName: "Moyoung Viran C29",
    coordinator: "ViranC29Coordinator",
    patterns: [/^C29$/],
  },
];

export const MOYOUNG_MODELS: readonly MoyoungModel[] = DEFINITIONS.map((definition) => ({
  id: definition.id,
  displayName: definition.displayName,
  transportValidated: false,
  bleNamePatterns: definition.patterns,
  mtu: definition.mtu ?? 508,
  supportsHeartRateHistory: definition.supportsHeartRateHistory ?? false,
  records: RECORDS,
  serviceUuids: SERVICES,
  sourceFiles: [`${DEVICES_ROOT}/${definition.coordinator}.java`, ...SHARED_SOURCE_FILES],
}));

const MODEL_BY_ID = new Map<MoyoungModelId, MoyoungModel>(
  MOYOUNG_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getMoyoungModel(id: MoyoungModelId): MoyoungModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered Moyoung model.
 *
 * Matching is name-only, like upstream's coordinator regex. Patterns are
 * full-string (Java `matches()`) and case-sensitive unless the model's
 * upstream pattern is case-insensitive. Returns null when nothing matches.
 */
export function matchMoyoungDevice(name: string | null | undefined): MoyoungModel | null {
  if (!name) return null;
  for (const model of MOYOUNG_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}
