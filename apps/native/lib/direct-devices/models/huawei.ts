/**
 * Huawei/Honor health-wearable registry.
 *
 * Ported from Gadgetbridge's Huawei coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Huawei coordinators do not use
 * exact BLE names or MAC-suffix regexes like Zepp OS/Xiaomi; each overrides
 * `getSupportedDeviceName()` with
 * `Pattern.compile(<lowercase prefix> + ".*", Pattern.CASE_INSENSITIVE)`.
 * The registry therefore stores one lowercase prefix per catalog model and
 * matches with a case-insensitive `startsWith`.
 *
 * Source (base coordinator):
 * https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei/HuaweiCoordinator.java
 *
 * Filter: catalog entries with `vendor in {huawei, honor}` and
 * `category == "wearables"`. That yields 66 models. The six
 * `category == "headphones"` entries (FreeBuds/FreeClip/FreeArc) are audio
 * devices and are excluded.
 *
 * IMPORTANT: `transportValidated` is false for every model. No Huawei/Honor
 * model has source-level transport validation in this codebase and no model
 * has hardware validation.
 *
 * Sync capability
 * ---------------
 * `sync` is true only for the 25 models upstream puts on `HuaweiLECoordinator`
 * (BLE). Those run the service 0x07 stored-history sync in this codebase. The
 * remaining 41 models are Bluetooth-Classic upstream (RFCOMM sync), and this
 * stack is BLE-only, so they stay connection-only.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Stable upstream YAML ids for the 66 health-relevant Huawei/Honor wearables. */
export type HuaweiModelId =
  | "honor_band_3"
  | "honor_band_4"
  | "honor_band_5"
  | "honor_band_6"
  | "honor_band_7"
  | "honor_band_9"
  | "honor_band_10"
  | "honor_magic_watch"
  | "honor_magicwatch_2"
  | "honor_watch_4"
  | "honor_watch_4_pro"
  | "honor_watch_5"
  | "honor_watch_5_pro"
  | "honor_watch_6"
  | "honor_watch_gs_3"
  | "honor_watch_gs_pro"
  | "huawei_band_2"
  | "huawei_band_2_pro"
  | "huawei_band_3_pro"
  | "huawei_band_4"
  | "huawei_band_4_pro"
  | "huawei_band_6"
  | "huawei_band_7"
  | "huawei_band_8"
  | "huawei_band_9"
  | "huawei_band_10"
  | "huawei_band_11"
  | "huawei_band_11_pro"
  | "huawei_band_3e"
  | "huawei_band_4e"
  | "huawei_talk_band_b6"
  | "huawei_watch_3"
  | "huawei_watch_3_pro"
  | "huawei_watch_4"
  | "huawei_watch_4_pro"
  | "huawei_watch_5"
  | "huawei_watch_6"
  | "huawei_watch_6_pro"
  | "huawei_watch_d2"
  | "huawei_watch_d3"
  | "huawei_watch_gt"
  | "huawei_watch_gt_2"
  | "huawei_watch_gt_2_pro"
  | "huawei_watch_gt_2e"
  | "huawei_watch_gt_3"
  | "huawei_watch_gt_3_pro"
  | "huawei_watch_gt_3_se"
  | "huawei_watch_gt_4"
  | "huawei_watch_gt_5"
  | "huawei_watch_gt_5_pro"
  | "huawei_watch_gt_6"
  | "huawei_watch_gt_6_pro"
  | "huawei_watch_gt_7"
  | "huawei_watch_gt_7_pro"
  | "huawei_watch_gt_cyber"
  | "huawei_watch_gt_runner"
  | "huawei_watch_gt_runner_2"
  | "huawei_watch_fit"
  | "huawei_watch_fit_2"
  | "huawei_watch_fit_3"
  | "huawei_watch_fit_4"
  | "huawei_watch_fit_4_pro"
  | "huawei_watch_fit_5"
  | "huawei_watch_fit_5_pro"
  | "huawei_watch_ultimate"
  | "huawei_watch_ultimate_2";
/** Upstream `feature_*` support level. */
export type HuaweiFeatureLevel = "most" | "unknown" | "poor";

export type HuaweiModel = Readonly<{
  id: HuaweiModelId;
  displayName: string;
  category: "wearables";
  featureLevel: HuaweiFeatureLevel;
  experimental: boolean;
  /** Always false: no Huawei/Honor model is transport-validated. */
  transportValidated: false;
  /** Lowercase prefix from the coordinator's case-insensitive name pattern. */
  bleNamePrefix: string;
  /** Upstream coordinator source file, relative to the app repo root. */
  sourceFile: string;
  /**
   * True when upstream registers the model on `HuaweiLECoordinator`, so the
   * stored-history sync (service 0x07) runs over BLE. False for the
   * Bluetooth-Classic models, which upstream syncs over RFCOMM; this stack is
   * BLE-only, so those stay connection-only.
   */
  sync: boolean;
  /**
   * True when the coordinator overrides `isNewHonorProtocol()`, which swaps the
   * FE86/FE01/FE02 GATT UUIDs for Honor's `c5f0ad48-…`/`2a5fc8bd-…`/
   * `a563d757-…` set.
   */
  newHonorProtocol: boolean;
}>;

const HUAWEI_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huawei";

/**
 * The 25 models whose upstream coordinator extends `HuaweiLECoordinator`
 * (`grep -rl "extends HuaweiLECoordinator"` at the pin). Band 2 and Band 2 Pro
 * share `HuaweiBand2ProCoordinator`, and Band 3e/4e share
 * `HuaweiBandAw70Coordinator`, so each pair is BLE.
 */
const BLE_SYNC_MODEL_IDS: ReadonlySet<HuaweiModelId> = new Set<HuaweiModelId>([
  "honor_band_3",
  "honor_band_4",
  "honor_band_5",
  "honor_band_6",
  "honor_band_7",
  "honor_band_9",
  "honor_band_10",
  "honor_magic_watch",
  "huawei_band_2",
  "huawei_band_2_pro",
  "huawei_band_3_pro",
  "huawei_band_4",
  "huawei_band_4_pro",
  "huawei_band_6",
  "huawei_band_7",
  "huawei_band_8",
  "huawei_band_9",
  "huawei_band_10",
  "huawei_band_11",
  "huawei_band_11_pro",
  "huawei_band_3e",
  "huawei_band_4e",
  "huawei_watch_fit",
  "huawei_watch_gt",
  "huawei_watch_gt_2e",
]);

/** The three coordinators that override `isNewHonorProtocol()`. */
const NEW_HONOR_PROTOCOL_MODEL_IDS: ReadonlySet<HuaweiModelId> = new Set<HuaweiModelId>([
  "honor_band_7",
  "honor_band_9",
  "honor_band_10",
]);

type HuaweiModelSpec = Omit<HuaweiModel, "sync" | "newHonorProtocol">;

/** The 66 health-relevant Huawei/Honor wearables, in catalog order. */
const MODEL_SPECS: readonly HuaweiModelSpec[] = [
  {
    id: "honor_band_3",
    displayName: "Honor Band 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor band 3-",
    sourceFile: `${HUAWEI_ROOT}/honorband3/HonorBand3Coordinator.java`,
  },
  {
    id: "honor_band_4",
    displayName: "Honor Band 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor band 4-",
    sourceFile: `${HUAWEI_ROOT}/honorband4/HonorBand4Coordinator.java`,
  },
  {
    id: "honor_band_5",
    displayName: "Honor Band 5",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor band 5-",
    sourceFile: `${HUAWEI_ROOT}/honorband5/HonorBand5Coordinator.java`,
  },
  {
    id: "honor_band_6",
    displayName: "Honor Band 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor band 6-",
    sourceFile: `${HUAWEI_ROOT}/honorband6/HonorBand6Coordinator.java`,
  },
  {
    id: "honor_band_7",
    displayName: "Honor Band 7",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "honor band 7-",
    sourceFile: `${HUAWEI_ROOT}/honorband7/HonorBand7Coordinator.java`,
  },
  {
    id: "honor_band_9",
    displayName: "Honor Band 9",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "honor band 9-",
    sourceFile: `${HUAWEI_ROOT}/honorband9/HonorBand9Coordinator.java`,
  },
  {
    id: "honor_band_10",
    displayName: "Honor Band 10",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "honor band 10-",
    sourceFile: `${HUAWEI_ROOT}/honorband10/HonorBand10Coordinator.java`,
  },
  {
    id: "honor_magic_watch",
    displayName: "Honor Magic Watch",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch-",
    sourceFile: `${HUAWEI_ROOT}/honormagicwatch/HonorMagicWatchCoordinator.java`,
  },
  {
    id: "honor_magicwatch_2",
    displayName: "Honor MagicWatch 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor magicwatch 2-",
    sourceFile: `${HUAWEI_ROOT}/honormagicwatch2/HonorMagicWatch2Coordinator.java`,
  },
  {
    id: "honor_watch_4",
    displayName: "Honor Watch 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch 4-",
    sourceFile: `${HUAWEI_ROOT}/honorwatch4/HonorWatch4Coordinator.java`,
  },
  {
    id: "honor_watch_4_pro",
    displayName: "Honor Watch 4 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch 4 pro-",
    sourceFile: `${HUAWEI_ROOT}/honorwatch4/HonorWatch4Coordinator.java`,
  },
  {
    id: "honor_watch_5",
    displayName: "Honor Watch 5",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch 5-",
    sourceFile: `${HUAWEI_ROOT}/honorwatch5/HonorWatch5Coordinator.java`,
  },
  {
    id: "honor_watch_5_pro",
    displayName: "Honor Watch 5 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch 5 pro-",
    sourceFile: `${HUAWEI_ROOT}/honorwatch5pro/HonorWatch5ProCoordinator.java`,
  },
  {
    id: "honor_watch_6",
    displayName: "Honor Watch 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch 6-",
    sourceFile: `${HUAWEI_ROOT}/honorwatch6/HonorWatch6Coordinator.java`,
  },
  {
    id: "honor_watch_gs_3",
    displayName: "Honor Watch GS 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch gs 3-",
    sourceFile: `${HUAWEI_ROOT}/honorwatchgs3/HonorWatchGS3Coordinator.java`,
  },
  {
    id: "honor_watch_gs_pro",
    displayName: "Honor Watch GS Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "honor watch gs pro-",
    sourceFile: `${HUAWEI_ROOT}/honorwatchgspro/HonorWatchGSProCoordinator.java`,
  },
  {
    id: "huawei_band_2",
    displayName: "Huawei Band 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 2-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband2pro/HuaweiBand2ProCoordinator.java`,
  },
  {
    id: "huawei_band_2_pro",
    displayName: "Huawei Band 2 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei band 2 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband2pro/HuaweiBand2ProCoordinator.java`,
  },
  {
    id: "huawei_band_3_pro",
    displayName: "Huawei Band 3 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 3 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband3pro/HuaweiBand3ProCoordinator.java`,
  },
  {
    id: "huawei_band_4",
    displayName: "Huawei Band 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 4-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband4pro/HuaweiBand4ProCoordinator.java`,
  },
  {
    id: "huawei_band_4_pro",
    displayName: "Huawei Band 4 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 4 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband4pro/HuaweiBand4ProCoordinator.java`,
  },
  {
    id: "huawei_band_6",
    displayName: "Huawei Band 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 6-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband6/HuaweiBand6Coordinator.java`,
  },
  {
    id: "huawei_band_7",
    displayName: "Huawei Band 7",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 7-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband7/HuaweiBand7Coordinator.java`,
  },
  {
    id: "huawei_band_8",
    displayName: "Huawei Band 8",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 8-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband8/HuaweiBand8Coordinator.java`,
  },
  {
    id: "huawei_band_9",
    displayName: "Huawei Band 9",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 9-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband9/HuaweiBand9Coordinator.java`,
  },
  {
    id: "huawei_band_10",
    displayName: "Huawei Band 10",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 10-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband10/HuaweiBand10Coordinator.java`,
  },
  {
    id: "huawei_band_11",
    displayName: "Huawei Band 11",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei band 11-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband11/HuaweiBand11Coordinator.java`,
  },
  {
    id: "huawei_band_11_pro",
    displayName: "Huawei Band 11 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei band 11 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiband11pro/HuaweiBand11ProCoordinator.java`,
  },
  {
    id: "huawei_band_3e",
    displayName: "Huawei Band 3e",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 3e-",
    sourceFile: `${HUAWEI_ROOT}/huaweibandaw70/HuaweiBandAw70Coordinator.java`,
  },
  {
    id: "huawei_band_4e",
    displayName: "Huawei Band 4e",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei band 4e-",
    sourceFile: `${HUAWEI_ROOT}/huaweibandaw70/HuaweiBandAw70Coordinator.java`,
  },
  {
    id: "huawei_talk_band_b6",
    displayName: "Huawei Talk Band B6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei b6-",
    sourceFile: `${HUAWEI_ROOT}/huaweitalkbandb6/HuaweiTalkBandB6Coordinator.java`,
  },
  {
    id: "huawei_watch_3",
    displayName: "Huawei Watch 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch 3-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch3/HuaweiWatch3Coordinator.java`,
  },
  {
    id: "huawei_watch_3_pro",
    displayName: "Huawei Watch 3 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch 3 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch3/HuaweiWatch3Coordinator.java`,
  },
  {
    id: "huawei_watch_4",
    displayName: "Huawei Watch 4",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch 4-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch4pro/HuaweiWatch4ProCoordinator.java`,
  },
  {
    id: "huawei_watch_4_pro",
    displayName: "Huawei Watch 4 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch 4 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch4pro/HuaweiWatch4ProCoordinator.java`,
  },
  {
    id: "huawei_watch_5",
    displayName: "Huawei Watch 5",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch 5-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch5/HuaweiWatch5Coordinator.java`,
  },
  {
    id: "huawei_watch_6",
    displayName: "Huawei Watch 6",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch 6-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch6/HuaweiWatch6Coordinator.java`,
  },
  {
    id: "huawei_watch_6_pro",
    displayName: "Huawei Watch 6 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch 6 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatch6/HuaweiWatch6ProCoordinator.java`,
  },
  {
    id: "huawei_watch_d2",
    displayName: "Huawei Watch D2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch d2-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchd2/HuaweiWatchD2Coordinator.java`,
  },
  {
    id: "huawei_watch_d3",
    displayName: "Huawei Watch D3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch d3-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchd3/HuaweiWatchD3Coordinator.java`,
  },
  {
    id: "huawei_watch_gt",
    displayName: "Huawei Watch GT",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt/HuaweiWatchGTCoordinator.java`,
  },
  {
    id: "huawei_watch_gt_2",
    displayName: "Huawei Watch GT 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 2-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt2/HuaweiWatchGT2Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_2_pro",
    displayName: "Huawei Watch GT 2 Pro",
    category: "wearables",
    featureLevel: "poor",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 2 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt2/HuaweiWatchGT2Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_2e",
    displayName: "Huawei Watch GT 2e",
    category: "wearables",
    featureLevel: "poor",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 2e-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt2e/HuaweiWatchGT2eCoordinator.java`,
  },
  {
    id: "huawei_watch_gt_3",
    displayName: "Huawei Watch GT 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 3-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt3/HuaweiWatchGT3Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_3_pro",
    displayName: "Huawei Watch GT 3 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 3 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt3/HuaweiWatchGT3Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_3_se",
    displayName: "Huawei Watch GT 3 SE",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 3 se-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt3/HuaweiWatchGT3Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_4",
    displayName: "Huawei Watch GT 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 4-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt4/HuaweiWatchGT4Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_5",
    displayName: "Huawei Watch GT 5",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 5-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt5/HuaweiWatchGT5Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_5_pro",
    displayName: "Huawei Watch GT 5 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 5 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt5/HuaweiWatchGT5Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_6",
    displayName: "Huawei Watch GT 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 6-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt6/HuaweiWatchGT6Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_6_pro",
    displayName: "Huawei Watch GT 6 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 6 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt6/HuaweiWatchGT6Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_7",
    displayName: "Huawei Watch GT 7",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 7-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt7/HuaweiWatchGT7Coordinator.java`,
  },
  {
    id: "huawei_watch_gt_7_pro",
    displayName: "Huawei Watch GT 7 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt 7 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgt7/HuaweiWatchGT7ProCoordinator.java`,
  },
  {
    id: "huawei_watch_gt_cyber",
    displayName: "Huawei Watch GT Cyber",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt cyber-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgtcyber/HuaweiWatchGTCyberCoordinator.java`,
  },
  {
    id: "huawei_watch_gt_runner",
    displayName: "Huawei Watch GT Runner",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch gt runner-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgtrunner/HuaweiWatchGTRunnerCoordinator.java`,
  },
  {
    id: "huawei_watch_gt_runner_2",
    displayName: "Huawei Watch GT Runner 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "watch gt runner 2-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchgtrunner2/HuaweiWatchGTRunner2Coordinator.java`,
  },
  {
    id: "huawei_watch_fit",
    displayName: "Huawei Watch Fit",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit/HuaweiWatchFitCoordinator.java`,
  },
  {
    id: "huawei_watch_fit_2",
    displayName: "Huawei Watch Fit 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit 2-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit2/HuaweiWatchFit2Coordinator.java`,
  },
  {
    id: "huawei_watch_fit_3",
    displayName: "Huawei Watch Fit 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit 3-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit3/HuaweiWatchFit3Coordinator.java`,
  },
  {
    id: "huawei_watch_fit_4",
    displayName: "Huawei Watch Fit 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit 4-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit4pro/HuaweiWatchFit4ProCoordinator.java`,
  },
  {
    id: "huawei_watch_fit_4_pro",
    displayName: "Huawei Watch Fit 4 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit 4 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit4pro/HuaweiWatchFit4ProCoordinator.java`,
  },
  {
    id: "huawei_watch_fit_5",
    displayName: "Huawei Watch Fit 5",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit 5-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit5/HuaweiWatchFit5Coordinator.java`,
  },
  {
    id: "huawei_watch_fit_5_pro",
    displayName: "Huawei Watch Fit 5 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePrefix: "huawei watch fit 5 pro-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchfit5pro/HuaweiWatchFit5ProCoordinator.java`,
  },
  {
    id: "huawei_watch_ultimate",
    displayName: "Huawei Watch Ultimate",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "huawei watch ultimate-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchultimate/HuaweiWatchUltimateCoordinator.java`,
  },
  {
    id: "huawei_watch_ultimate_2",
    displayName: "Huawei Watch Ultimate 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePrefix: "watch ultimate 2-",
    sourceFile: `${HUAWEI_ROOT}/huaweiwatchultimate2/HuaweiWatchUltimate2Coordinator.java`,
  },
];

/** The 66 models with the per-model sync and Honor-protocol capabilities. */
export const HUAWEI_MODELS: readonly HuaweiModel[] = MODEL_SPECS.map((spec) => ({
  ...spec,
  sync: BLE_SYNC_MODEL_IDS.has(spec.id),
  newHonorProtocol: NEW_HONOR_PROTOCOL_MODEL_IDS.has(spec.id),
}));

/** Record kinds the BLE sync path can emit. No new record types. */
export type HuaweiRecordType = "steps" | "heart_rate" | "sleep_session";

const MODEL_BY_ID = new Map<HuaweiModelId, HuaweiModel>(
  HUAWEI_MODELS.map((model) => [model.id, model]),
);

/** Looks up a Huawei/Honor model by upstream id. */
export function getHuaweiModel(id: HuaweiModelId): HuaweiModel | undefined {
  return MODEL_BY_ID.get(id);
}

const MATCHERS: readonly { model: HuaweiModel; prefix: string }[] = HUAWEI_MODELS.map((model) => ({
  model,
  prefix: model.bleNamePrefix,
})).sort((left, right) => right.prefix.length - left.prefix.length);

/**
 * Matches an advertised BLE name to a registered Huawei/Honor model, or null.
 * Upstream uses a case-insensitive `prefix + ".*"` regex; this is the
 * equivalent case-insensitive `startsWith`. Longer prefixes are tried first so
 * `huawei watch gt 2-` wins over the generic `huawei watch gt-`.
 */
export function matchHuaweiDeviceName(name: string): HuaweiModel | null {
  const normalized = name.toLowerCase();
  for (const { model, prefix } of MATCHERS) {
    if (normalized.startsWith(prefix)) return model;
  }
  return null;
}
