/**
 * Legacy Huami (pre-Zepp-OS Amazfit / Mi Band) model registry.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named model
 * with a full-string Java `Matcher.matches()` regex against the advertised
 * name. Every upstream pattern is compiled with `Pattern.CASE_INSENSITIVE`, so
 * the patterns here are anchored with `^`/`$` and flagged `i`. `matches()`
 * anchors the whole string, which is why "Amazfit Bip U" must not select
 * "Amazfit Bip U Pro".
 *
 * Source files at the pin (paths relative to the app repo root):
 * - devices/huami/HuamiCoordinator.java
 * - devices/huami/HuamiConst.java
 * - devices/huami/HuamiService.java
 * - devices/huami/<model>/<Model>Coordinator.java (one per model)
 * - service/devices/huami/HuamiSupport.java
 * - service/devices/huami/operations/init/InitOperation.java
 * - service/devices/huami/operations/fetch/AbstractFetchOperation.java
 * - service/devices/huami/operations/fetch/AbstractRepeatingFetchOperation.java
 * - service/devices/huami/operations/fetch/FetchActivityOperation.java
 * - devices/SleepSessionSegmenter.java
 *
 * Auth flag matrix
 * ----------------
 * `HuamiSupport` defaults to `authFlags = AUTH_BYTE (0x08)` and
 * `cryptFlags = 0x00`, which is the three-step key handshake. A support class
 * may override either byte:
 *
 * - `AmazfitBipSupport` (and `AmazfitCorSupport`, `AmazfitCor2Support`,
 *   `MiBand2Support`) keep the 0x08/0x00 default.
 * - `AmazfitBipSSupport` and its subclasses (`Bip S Lite`, `Bip U`, `Bip U
 *   Pro`, `Pop`, `Pop Pro`), `AmazfitGTSSupport` and its subclasses (`GTR`,
 *   `GTR Lite`, `GTR 2`, `GTR 2e`, `GTS 2`, `GTS 2e`, `GTS 2 Mini`, `T-Rex`,
 *   `T-Rex Pro`), `AmazfitBip3Support`, `AmazfitBip3ProSupport`,
 *   `AmazfitVergeLSupport`, `AmazfitBipLiteSupport`, `MiBand4Support` and its
 *   subclasses (`MiBand5`, `MiBand6`, `AmazfitBand5`, `AmazfitNeo`, `AmazfitX`,
 *   `ZeppE`) override to `authFlags = 0x00`, `cryptFlags = 0x80`.
 * - `MiBand3Support` overrides only `authFlags = 0x00`, so it keeps
 *   `cryptFlags = 0x00` (three-step handshake with an 0x00 auth byte).
 *
 * The registry stores both bytes per model instead of collapsing them into two
 * named groups, because Mi Band 3 is a third combination.
 *
 * Sample size matrix
 * ------------------
 * `HuamiSupport.mActivitySampleSize` defaults to 4 and a support class may
 * raise it to 8. `AmazfitGTRSupport`, `AmazfitGTRLiteSupport`,
 * `AmazfitGTSSupport` (and therefore `T-Rex` / `T-Rex Pro`) raise it from the
 * firmware version in `handleDeviceInfo`; every other model is fixed.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware in this codebase. This registry
 * records which models the codec is expected to reach; it is not a support
 * claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Mi Band / Huami primary service (activity control and data live here). */
export const HUAMI_SERVICE_UUID = "0000fee0-0000-1000-8000-00805f9b34fb";
/** Secondary service that carries the auth characteristic on many models. */
export const HUAMI_SERVICE_MIBAND2_UUID = "0000fee1-0000-1000-8000-00805f9b34fb";
/** Standard heart-rate service. */
export const HUAMI_HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
/** Standard current-time service (optional clock sync). */
export const HUAMI_CURRENT_TIME_SERVICE_UUID = "00001805-0000-1000-8000-00805f9b34fb";
/** Standard device-information service (optional firmware read). */
export const HUAMI_DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";

export const HUAMI_AUTH_UUID = "00000009-0000-3512-2118-0009af100700";
export const HUAMI_CONFIG_UUID = "00000003-0000-3512-2118-0009af100700";
export const HUAMI_ACTIVITY_CONTROL_UUID = "00000004-0000-3512-2118-0009af100700";
export const HUAMI_ACTIVITY_DATA_UUID = "00000005-0000-3512-2118-0009af100700";
export const HUAMI_BATTERY_UUID = "00000006-0000-3512-2118-0009af100700";
export const HUAMI_CHUNKED_UUID = "00000020-0000-3512-2118-0009af100700";
export const HUAMI_HEART_RATE_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb";
export const HUAMI_HEART_RATE_CONTROL_UUID = "00002a39-0000-1000-8000-00805f9b34fb";
export const HUAMI_CURRENT_TIME_UUID = "00002a2b-0000-1000-8000-00805f9b34fb";
export const HUAMI_FIRMWARE_REVISION_UUID = "00002a26-0000-1000-8000-00805f9b34fb";

/** Record kinds this family can emit. Steps are exact UTC minutes. */
export type HuamiLegacyRecordType = "steps" | "heart_rate" | "sleep_session";

/** Stable upstream YAML ids for the 27 Amazfit + 6 Mi Band models. */
export type HuamiLegacyModelId =
  | "amazfit_bip"
  | "amazfit_bip_lite"
  | "amazfit_bip_s"
  | "amazfit_bip_s_lite"
  | "amazfit_bip_u"
  | "amazfit_bip_u_pro"
  | "amazfit_bip_3"
  | "amazfit_bip_3_pro"
  | "amazfit_cor"
  | "amazfit_cor_2"
  | "amazfit_gtr"
  | "amazfit_gtr_lite"
  | "amazfit_gtr_2"
  | "amazfit_gtr_2e"
  | "amazfit_gts"
  | "amazfit_gts_2"
  | "amazfit_gts_2e"
  | "amazfit_gts_2_mini"
  | "amazfit_neo"
  | "amazfit_pop"
  | "amazfit_pop_pro"
  | "amazfit_trex"
  | "amazfit_trex_pro"
  | "amazfit_verge_lite"
  | "amazfit_x"
  | "zepp_e"
  | "amazfit_band_5"
  | "xiaomi_mi_band_2"
  | "xiaomi_mi_band_2_hrx"
  | "xiaomi_mi_band_3"
  | "xiaomi_mi_band_4"
  | "xiaomi_mi_band_5"
  | "xiaomi_mi_band_6";

/**
 * Per-model activity sample size. Fixed models always use one width; gated
 * models start at 4 and switch to 8 once the firmware version is known.
 */
export type HuamiSampleSizeRule =
  | Readonly<{ kind: "fixed"; size: 4 | 8 }>
  | Readonly<{
      kind: "firmware_gated";
      /** Upstream support class whose `handleDeviceInfo` gate applies. */
      rule: "gtr" | "gtr_lite" | "gts";
      below: 4;
      atLeast: 8;
    }>;

export type HuamiLegacyModel = Readonly<{
  /** Upstream YAML id. */
  id: HuamiLegacyModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns, matched case-insensitively like
   * upstream `Pattern.CASE_INSENSITIVE` + `Matcher.matches()`.
   */
  bleNamePatterns: readonly RegExp[];
  /** Auth byte written in every handshake frame (`HuamiSupport.getAuthFlags`). */
  authFlags: number;
  /** Crypt byte ORed into the request/response command (`getCryptFlags`). */
  cryptFlags: number;
  /** Activity sample width, fixed or firmware-gated. */
  sampleSize: HuamiSampleSizeRule;
  /** Record kinds the model's capture path can emit. */
  records: readonly HuamiLegacyRecordType[];
  /** Services the upstream support subscribes to or writes. */
  serviceUuids: readonly string[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const DEVICES_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huami";
const SERVICE_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huami";

const SHARED_SOURCES: readonly string[] = [
  `${DEVICES_ROOT}/HuamiCoordinator.java`,
  `${DEVICES_ROOT}/HuamiConst.java`,
  `${DEVICES_ROOT}/HuamiService.java`,
  `${SERVICE_ROOT}/HuamiSupport.java`,
  `${SERVICE_ROOT}/operations/init/InitOperation.java`,
  `${SERVICE_ROOT}/operations/fetch/AbstractFetchOperation.java`,
  `${SERVICE_ROOT}/operations/fetch/AbstractRepeatingFetchOperation.java`,
  `${SERVICE_ROOT}/operations/fetch/FetchActivityOperation.java`,
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/SleepSessionSegmenter.java",
];

const RECORDS: readonly HuamiLegacyRecordType[] = ["steps", "heart_rate", "sleep_session"];

const SERVICES: readonly string[] = [
  HUAMI_SERVICE_UUID,
  HUAMI_SERVICE_MIBAND2_UUID,
  HUAMI_HEART_RATE_SERVICE_UUID,
];

const FIXED_4: HuamiSampleSizeRule = Object.freeze({ kind: "fixed", size: 4 });
const FIXED_8: HuamiSampleSizeRule = Object.freeze({ kind: "fixed", size: 8 });
const GATED_GTR: HuamiSampleSizeRule = Object.freeze({
  kind: "firmware_gated",
  rule: "gtr",
  below: 4,
  atLeast: 8,
});
const GATED_GTR_LITE: HuamiSampleSizeRule = Object.freeze({
  kind: "firmware_gated",
  rule: "gtr_lite",
  below: 4,
  atLeast: 8,
});
const GATED_GTS: HuamiSampleSizeRule = Object.freeze({
  kind: "firmware_gated",
  rule: "gts",
  below: 4,
  atLeast: 8,
});

/** The default upstream three-step handshake bytes. */
const AUTH_LEGACY = Object.freeze({ authFlags: 0x08, cryptFlags: 0x00 });
/** The crypt handshake used by most of the family. */
const AUTH_CRYPT = Object.freeze({ authFlags: 0x00, cryptFlags: 0x80 });
/** Mi Band 3: three-step handshake with an 0x00 auth byte. */
const AUTH_MIBAND3 = Object.freeze({ authFlags: 0x00, cryptFlags: 0x00 });

type ModelSpec = Readonly<{
  id: HuamiLegacyModelId;
  displayName: string;
  patterns: readonly RegExp[];
  auth: Readonly<{ authFlags: number; cryptFlags: number }>;
  sampleSize: HuamiSampleSizeRule;
  /** Coordinator and support class paths, relative to the app repo root. */
  sources: readonly string[];
}>;

const SPECS: readonly ModelSpec[] = [
  {
    id: "amazfit_bip",
    displayName: "Amazfit Bip",
    patterns: [/^Amazfit Bip Watch$/i],
    auth: AUTH_LEGACY,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitbip/AmazfitBipCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbip/AmazfitBipSupport.java`,
    ],
  },
  {
    id: "amazfit_bip_lite",
    displayName: "Amazfit Bip Lite",
    patterns: [/^Amazfit Bip Lite$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitbip/AmazfitBipLiteCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbip/AmazfitBipLiteSupport.java`,
    ],
  },
  {
    id: "amazfit_bip_s",
    displayName: "Amazfit Bip S",
    patterns: [/^Amazfit Bip S$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitbips/AmazfitBipSCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbips/AmazfitBipSSupport.java`,
    ],
  },
  {
    id: "amazfit_bip_s_lite",
    displayName: "Amazfit Bip S Lite",
    patterns: [/^Bip S Lite$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitbips/AmazfitBipSLiteCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbips/AmazfitBipSLiteSupport.java`,
    ],
  },
  {
    id: "amazfit_bip_u",
    displayName: "Amazfit Bip U",
    patterns: [/^Amazfit Bip U$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitbipu/AmazfitBipUCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbipu/AmazfitBipUSupport.java`,
    ],
  },
  {
    id: "amazfit_bip_u_pro",
    displayName: "Amazfit Bip U Pro",
    patterns: [/^Amazfit Bip U Pro$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitbipupro/AmazfitBipUProCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbipupro/AmazfitBipUProSupport.java`,
    ],
  },
  {
    id: "amazfit_bip_3",
    displayName: "Amazfit Bip 3",
    patterns: [/^Amazfit Bip 3$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitbip3/AmazfitBip3Coordinator.java`,
      `${SERVICE_ROOT}/amazfitbip3/AmazfitBip3Support.java`,
    ],
  },
  {
    id: "amazfit_bip_3_pro",
    displayName: "Amazfit Bip 3 Pro",
    patterns: [/^Amazfit Bip 3 Pro$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitbip3pro/AmazfitBip3ProCoordinator.java`,
      `${SERVICE_ROOT}/amazfitbip3pro/AmazfitBip3ProSupport.java`,
    ],
  },
  {
    id: "amazfit_cor",
    displayName: "Amazfit Cor",
    patterns: [/^(?:Amazfit Band|Amazfit Cor)$/i],
    auth: AUTH_LEGACY,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitcor/AmazfitCorCoordinator.java`,
      `${SERVICE_ROOT}/amazfitcor/AmazfitCorSupport.java`,
    ],
  },
  {
    id: "amazfit_cor_2",
    displayName: "Amazfit Cor 2",
    patterns: [/^(?:Amazfit Band 2|Amazfit Cor 2)$/i],
    auth: AUTH_LEGACY,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitcor2/AmazfitCor2Coordinator.java`,
      `${SERVICE_ROOT}/amazfitcor2/AmazfitCor2Support.java`,
    ],
  },
  {
    id: "amazfit_gtr",
    displayName: "Amazfit GTR",
    patterns: [/^Amazfit GTR$/i],
    auth: AUTH_CRYPT,
    sampleSize: GATED_GTR,
    sources: [
      `${DEVICES_ROOT}/amazfitgtr/AmazfitGTRCoordinator.java`,
      `${SERVICE_ROOT}/amazfitgtr/AmazfitGTRSupport.java`,
    ],
  },
  {
    id: "amazfit_gtr_lite",
    displayName: "Amazfit GTR Lite",
    patterns: [/^Amazfit GTR L$/i],
    auth: AUTH_CRYPT,
    sampleSize: GATED_GTR_LITE,
    sources: [
      `${DEVICES_ROOT}/amazfitgtr/AmazfitGTRLiteCoordinator.java`,
      `${SERVICE_ROOT}/amazfitgtr/AmazfitGTRLiteSupport.java`,
    ],
  },
  {
    id: "amazfit_gtr_2",
    displayName: "Amazfit GTR 2",
    patterns: [/^Amazfit GTR 2$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitgtr2/AmazfitGTR2Coordinator.java`,
      `${SERVICE_ROOT}/amazfitgtr2/AmazfitGTR2Support.java`,
    ],
  },
  {
    id: "amazfit_gtr_2e",
    displayName: "Amazfit GTR 2e",
    patterns: [/^Amazfit GTR 2e$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitgtr2/AmazfitGTR2eCoordinator.java`,
      `${SERVICE_ROOT}/amazfitgtr2/AmazfitGTR2eSupport.java`,
    ],
  },
  {
    id: "amazfit_gts",
    displayName: "Amazfit GTS",
    patterns: [/^Amazfit GTS$/i],
    auth: AUTH_CRYPT,
    sampleSize: GATED_GTS,
    sources: [
      `${DEVICES_ROOT}/amazfitgts/AmazfitGTSCoordinator.java`,
      `${SERVICE_ROOT}/amazfitgts/AmazfitGTSSupport.java`,
    ],
  },
  {
    id: "amazfit_gts_2",
    displayName: "Amazfit GTS 2",
    patterns: [/^Amazfit GTS 2$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitgts2/AmazfitGTS2Coordinator.java`,
      `${SERVICE_ROOT}/amazfitgts2/AmazfitGTS2Support.java`,
    ],
  },
  {
    id: "amazfit_gts_2e",
    displayName: "Amazfit GTS 2e",
    patterns: [/^Amazfit GTS 2e$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitgts2/AmazfitGTS2eCoordinator.java`,
      `${SERVICE_ROOT}/amazfitgts2/AmazfitGTS2eSupport.java`,
    ],
  },
  {
    id: "amazfit_gts_2_mini",
    displayName: "Amazfit GTS 2 Mini",
    patterns: [/^Amazfit GTS2 mini$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitgts2/AmazfitGTS2MiniCoordinator.java`,
      `${SERVICE_ROOT}/amazfitgts2/AmazfitGTS2MiniSupport.java`,
    ],
  },
  {
    id: "amazfit_neo",
    displayName: "Amazfit Neo",
    patterns: [/^Amazfit Neo$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitneo/AmazfitNeoCoordinator.java`,
      `${SERVICE_ROOT}/amazfitneo/AmazfitNeoSupport.java`,
    ],
  },
  {
    id: "amazfit_pop",
    displayName: "Amazfit Pop",
    patterns: [/^Amazfit Pop$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitpop/AmazfitPopCoordinator.java`,
      `${SERVICE_ROOT}/amazfitpop/AmazfitPopSupport.java`,
    ],
  },
  {
    id: "amazfit_pop_pro",
    displayName: "Amazfit Pop Pro",
    patterns: [/^Amazfit Pop Pro$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitpoppro/AmazfitPopProCoordinator.java`,
      `${SERVICE_ROOT}/amazfitpoppro/AmazfitPopProSupport.java`,
    ],
  },
  {
    id: "amazfit_trex",
    displayName: "Amazfit T-Rex",
    patterns: [/^Amazfit T-Rex$/i],
    auth: AUTH_CRYPT,
    sampleSize: GATED_GTS,
    sources: [
      `${DEVICES_ROOT}/amazfittrex/AmazfitTRexCoordinator.java`,
      `${SERVICE_ROOT}/amazfittrex/AmazfitTRexSupport.java`,
    ],
  },
  {
    id: "amazfit_trex_pro",
    displayName: "Amazfit T-Rex Pro",
    patterns: [/^Amazfit T-Rex Pro$/i],
    auth: AUTH_CRYPT,
    sampleSize: GATED_GTS,
    sources: [
      `${DEVICES_ROOT}/amazfittrexpro/AmazfitTRexProCoordinator.java`,
      `${SERVICE_ROOT}/amazfittrexpro/AmazfitTRexProSupport.java`,
    ],
  },
  {
    id: "amazfit_verge_lite",
    displayName: "Amazfit Verge Lite",
    patterns: [/^Amazfit Verge L$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/amazfitvergel/AmazfitVergeLCoordinator.java`,
      `${SERVICE_ROOT}/amazfitvergel/AmazfitVergeLSupport.java`,
    ],
  },
  {
    id: "amazfit_x",
    displayName: "Amazfit X",
    patterns: [/^Amazfit X$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitx/AmazfitXCoordinator.java`,
      `${SERVICE_ROOT}/amazfitx/AmazfitXSupport.java`,
    ],
  },
  {
    id: "zepp_e",
    displayName: "Zepp E",
    patterns: [/^Zepp E$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/zeppe/ZeppECoordinator.java`,
      `${SERVICE_ROOT}/zeppe/ZeppESupport.java`,
    ],
  },
  {
    id: "amazfit_band_5",
    displayName: "Amazfit Band 5",
    patterns: [/^Amazfit Band 5$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/amazfitband5/AmazfitBand5Coordinator.java`,
      `${SERVICE_ROOT}/amazfitband5/AmazfitBand5Support.java`,
    ],
  },
  {
    id: "xiaomi_mi_band_2",
    displayName: "Mi Band 2",
    patterns: [/^MI Band 2$/i],
    auth: AUTH_LEGACY,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/miband2/MiBand2Coordinator.java`,
      `${SERVICE_ROOT}/miband2/MiBand2Support.java`,
    ],
  },
  {
    id: "xiaomi_mi_band_2_hrx",
    displayName: "Mi Band 2 HRX",
    patterns: [/^(?:Mi Band HRX|Mi Band 2i)$/i],
    auth: AUTH_LEGACY,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/miband2/MiBand2HRXCoordinator.java`,
      `${SERVICE_ROOT}/miband2/MiBand2Support.java`,
    ],
  },
  {
    id: "xiaomi_mi_band_3",
    displayName: "Mi Band 3",
    patterns: [/^(?:Mi Band 3|Xiaomi Band 3)$/i],
    auth: AUTH_MIBAND3,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/miband3/MiBand3Coordinator.java`,
      `${SERVICE_ROOT}/miband3/MiBand3Support.java`,
    ],
  },
  {
    id: "xiaomi_mi_band_4",
    displayName: "Mi Smart Band 4",
    patterns: [/^Mi Smart Band 4$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_4,
    sources: [
      `${DEVICES_ROOT}/miband4/MiBand4Coordinator.java`,
      `${SERVICE_ROOT}/miband4/MiBand4Support.java`,
    ],
  },
  {
    id: "xiaomi_mi_band_5",
    displayName: "Mi Smart Band 5",
    patterns: [/^Mi Smart Band 5$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/miband5/MiBand5Coordinator.java`,
      `${SERVICE_ROOT}/miband5/MiBand5Support.java`,
    ],
  },
  {
    id: "xiaomi_mi_band_6",
    displayName: "Mi Smart Band 6",
    patterns: [/^Mi Smart Band 6$/i],
    auth: AUTH_CRYPT,
    sampleSize: FIXED_8,
    sources: [
      `${DEVICES_ROOT}/miband6/MiBand6Coordinator.java`,
      `${SERVICE_ROOT}/miband6/MiBand6Support.java`,
    ],
  },
];

/**
 * The 33 models, in upstream catalog order. Every model shares the same
 * capture path, so `records` and `serviceUuids` are identical.
 */
export const HUAMI_LEGACY_MODELS: readonly HuamiLegacyModel[] = SPECS.map((spec) => ({
  id: spec.id,
  displayName: spec.displayName,
  transportValidated: false,
  bleNamePatterns: spec.patterns,
  authFlags: spec.auth.authFlags,
  cryptFlags: spec.auth.cryptFlags,
  sampleSize: spec.sampleSize,
  records: RECORDS,
  serviceUuids: SERVICES,
  sourceFiles: [...spec.sources, ...SHARED_SOURCES],
}));

const MODEL_BY_ID = new Map<HuamiLegacyModelId, HuamiLegacyModel>(
  HUAMI_LEGACY_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getHuamiLegacyModel(id: HuamiLegacyModelId): HuamiLegacyModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered legacy Huami model.
 *
 * Matching is name-only: upstream has no UUID fallback for this family.
 * Patterns are full-string (Java `matches()`) and case-insensitive. Returns
 * null when nothing matches.
 */
export function matchHuamiLegacyDevice(name: string | null | undefined): HuamiLegacyModel | null {
  if (!name) return null;
  for (const model of HUAMI_LEGACY_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}

/** Compares dotted numeric firmware versions. Non-numeric input sorts as 0. */
export function compareHuamiFirmwareVersion(left: string, right: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .split(".")
      .map((part) => {
        const parsed = Number.parseInt(part, 10);
        return Number.isFinite(parsed) ? parsed : 0;
      });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Resolves the activity sample width for a model.
 *
 * Fixed models ignore the firmware argument. Gated models reproduce the
 * upstream `handleDeviceInfo` checks:
 * - GTR: `>= 1.3.5.79`, or `>= 0.1.1.15` on the 32 mm variant (versions
 *   `>= 1.0.0.00` and `< 1.6.0.00` are the 47 mm variant).
 * - GTR Lite: `>= 1.0.0.33`.
 * - GTS / T-Rex / T-Rex Pro: `> 0.0.9.00`.
 *
 * A missing or unparseable firmware version stays at the upstream default (4).
 */
export function resolveHuamiSampleSize(
  rule: HuamiSampleSizeRule,
  firmwareVersion?: string | null,
): 4 | 8 {
  if (rule.kind === "fixed") return rule.size;
  if (!firmwareVersion) return rule.below;
  const version = firmwareVersion.trim();
  if (!/^\d+(?:\.\d+)*$/.test(version)) return rule.below;
  switch (rule.rule) {
    case "gtr": {
      if (compareHuamiFirmwareVersion(version, "1.3.5.79") >= 0) return rule.atLeast;
      const is47mm =
        compareHuamiFirmwareVersion(version, "1.0.0.00") >= 0 &&
        compareHuamiFirmwareVersion(version, "1.6.0.00") < 0;
      if (!is47mm && compareHuamiFirmwareVersion(version, "0.1.1.15") >= 0) return rule.atLeast;
      return rule.below;
    }
    case "gtr_lite":
      return compareHuamiFirmwareVersion(version, "1.0.0.33") >= 0 ? rule.atLeast : rule.below;
    case "gts":
      return compareHuamiFirmwareVersion(version, "0.0.9.00") > 0 ? rule.atLeast : rule.below;
  }
}
