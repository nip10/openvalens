/**
 * Xiaomi protobuf device-model registry.
 *
 * Ported from Gadgetbridge's Xiaomi coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Unlike the Zepp OS coordinators,
 * the Xiaomi watch coordinators do not return a list of exact BLE names; each
 * overrides `getSupportedDeviceName()` with its own anchored Java regex. The
 * `bleNamePattern` field is that regex source, normalized to `^...$` where
 * upstream relies on full-match semantics.
 *
 * Source (base coordinator):
 * https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/xiaomi/XiaomiCoordinator.java
 *
 * Support flags come from the upstream `device_support.yml` catalog snapshot
 * (`zepp-os-models.json`, 34 `os_xiaomi_protobuf` entries).
 *
 * IMPORTANT: `transportValidated` is false for every model. No Xiaomi model
 * has source-level transport validation in this codebase and no model has
 * hardware validation. This registry records the shared protocol family, not
 * a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Stable upstream YAML ids for the 34 `os_xiaomi_protobuf` models. */
export type XiaomiModelId =
  | "xiaomi_mi_band_10"
  | "xiaomi_mi_band_10_pro"
  | "xiaomi_mi_band_11"
  | "xiaomi_mi_band_11_active"
  | "xiaomi_mi_band_4c"
  | "xiaomi_mi_band_7_pro"
  | "xiaomi_mi_band_8"
  | "xiaomi_mi_band_8_active"
  | "xiaomi_mi_band_8_pro"
  | "xiaomi_mi_band_9"
  | "xiaomi_mi_band_9_active"
  | "xiaomi_mi_band_9_pro"
  | "xiaomi_mi_watch_color_sport"
  | "xiaomi_mi_watch_lite"
  | "xiaomi_redmi_smart_band_2"
  | "xiaomi_redmi_smart_band_3"
  | "xiaomi_redmi_smart_band_pro"
  | "xiaomi_redmi_watch_2"
  | "xiaomi_redmi_watch_2_lite"
  | "xiaomi_redmi_watch_3"
  | "xiaomi_redmi_watch_3_active"
  | "xiaomi_redmi_watch_4"
  | "xiaomi_redmi_watch_5"
  | "xiaomi_redmi_watch_5_active"
  | "xiaomi_redmi_watch_5_lite"
  | "xiaomi_redmi_watch_6"
  | "xiaomi_redmi_watch_move"
  | "xiaomi_watch_5"
  | "xiaomi_watch_s1"
  | "xiaomi_watch_s1_active"
  | "xiaomi_watch_s1_pro"
  | "xiaomi_watch_s3"
  | "xiaomi_watch_s4"
  | "xiaomi_watch_s5";

/** Upstream `feature_*` support level. */
export type XiaomiFeatureLevel = "high" | "most" | "partial" | "unknown";

export type XiaomiModel = Readonly<{
  id: XiaomiModelId;
  displayName: string;
  category: "wearables";
  featureLevel: XiaomiFeatureLevel;
  experimental: boolean;
  /** Always false: no Xiaomi model is transport-validated. */
  transportValidated: false;
  /** Anchored Java regex source from the coordinator's `getSupportedDeviceName()`. */
  bleNamePattern: string;
  /** Upstream coordinator source file, relative to the app repo root. */
  sourceFile: string;
}>;

const XIAOMI_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/xiaomi";

/** The 34 `os_xiaomi_protobuf` models, in upstream catalog order. */
export const XIAOMI_MODELS: readonly XiaomiModel[] = [
  {
    id: "xiaomi_mi_band_10",
    displayName: "Xiaomi Smart Band 10",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 10 [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand10Coordinator.java`,
  },
  {
    id: "xiaomi_mi_band_10_pro",
    displayName: "Xiaomi Smart Band 10 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 10 Pro [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand10ProCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_11",
    displayName: "Xiaomi Smart Band 11",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 11 [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand11Coordinator.java`,
  },
  {
    id: "xiaomi_mi_band_11_active",
    displayName: "Xiaomi Smart Band 11 Active",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi( Smart)? Band 11 Active [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand11ActiveCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_4c",
    displayName: "Mi Smart Band 4C",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Mi Smart Band 4C_[0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand4CCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_7_pro",
    displayName: "Xiaomi Smart Band 7 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    // Upstream compiles `HuamiConst.XIAOMI_SMART_BAND7_PRO_NAME + ".*"` without
    // anchors; full-match semantics make it equivalent to this anchored form.
    bleNamePattern: "^Xiaomi Smart Band 7 Pro.*$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand7ProCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_8",
    displayName: "Xiaomi Smart Band 8",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 8 [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand8Coordinator.java`,
  },
  {
    id: "xiaomi_mi_band_8_active",
    displayName: "Xiaomi Smart Band 8 Active",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi( Smart)? Band 8 Active [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand8ActiveCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_8_pro",
    displayName: "Xiaomi Smart Band 8 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 8 Pro [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand8ProCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_9",
    displayName: "Xiaomi Smart Band 9",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 9 [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand9Coordinator.java`,
  },
  {
    id: "xiaomi_mi_band_9_active",
    displayName: "Xiaomi Smart Band 9 Active",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi( Smart)? Band 9 Active [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand9ActiveCoordinator.java`,
  },
  {
    id: "xiaomi_mi_band_9_pro",
    displayName: "Xiaomi Smart Band 9 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Smart Band 9 Pro [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiBand9ProCoordinator.java`,
  },
  {
    id: "xiaomi_mi_watch_color_sport",
    displayName: "Mi Watch Color Sport",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Mi ColorS [0-9A-Z]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiWatchColorSportCoordinator.java`,
  },
  {
    id: "xiaomi_mi_watch_lite",
    displayName: "Mi Watch Lite",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Mi Watch Lite_[A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/MiWatchLiteCoordinator.java`,
  },
  {
    id: "xiaomi_redmi_smart_band_2",
    displayName: "Redmi Smart Band 2",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Smart Band 2 [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiSmartBand2Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_smart_band_3",
    displayName: "Redmi Smart Band 3",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Smart Band 3 [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiSmartBand3Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_smart_band_pro",
    displayName: "Redmi Smart Band Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Band Pro [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiSmartBandProCoordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_2",
    displayName: "Redmi Watch 2",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 2 [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch2Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_2_lite",
    displayName: "Redmi Watch 2 Lite",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 2 Lite [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch2LiteCoordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_3",
    displayName: "Redmi Watch 3",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 3 [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch3Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_3_active",
    displayName: "Redmi Watch 3 Active",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 3 Active [A-Z0-9]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch3ActiveCoordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_4",
    displayName: "Redmi Watch 4",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 4 [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch4Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_5",
    displayName: "Redmi Watch 5",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 5 [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch5Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_5_active",
    displayName: "Redmi Watch 5 Active",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 5 Active [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch5ActiveCoordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_5_lite",
    displayName: "Redmi Watch 5 Lite",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 5 Lite [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch5LiteCoordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_6",
    displayName: "Redmi Watch 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Redmi Watch 6( NFC)? [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatch6Coordinator.java`,
  },
  {
    id: "xiaomi_redmi_watch_move",
    displayName: "Redmi Watch Move",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Move$",
    sourceFile: `${XIAOMI_ROOT}/watches/RedmiWatchMoveCoordinator.java`,
  },
  {
    id: "xiaomi_watch_5",
    displayName: "Xiaomi Watch 5",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    // Upstream excludes the Pro/Lite siblings with a negative lookahead.
    bleNamePattern: "^Xiaomi Watch 5(?! (Pro|Lite))( .*)?$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatch5Coordinator.java`,
  },
  {
    id: "xiaomi_watch_s1",
    displayName: "Xiaomi Watch S1",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Watch S1 [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatchS1Coordinator.java`,
  },
  {
    id: "xiaomi_watch_s1_active",
    displayName: "Xiaomi Watch S1 Active",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^XiaomiWatchS1Active [0-9A-Z]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatchS1ActiveCoordinator.java`,
  },
  {
    id: "xiaomi_watch_s1_pro",
    displayName: "Xiaomi Watch S1 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    // Some units advertise an `L61...`/`l61...` name instead.
    bleNamePattern: "^(Xiaomi Watch S1 Pro [0-9A-F]{4}|[Ll]61.*[0-9A-F]{4})$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatchS1ProCoordinator.java`,
  },
  {
    id: "xiaomi_watch_s3",
    displayName: "Xiaomi Watch S3",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Watch S3( eSIM)? [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatchS3Coordinator.java`,
  },
  {
    id: "xiaomi_watch_s4",
    displayName: "Xiaomi Watch S4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Watch S4( eSIM)? [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatchS4Coordinator.java`,
  },
  {
    id: "xiaomi_watch_s5",
    displayName: "Xiaomi Watch S5",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNamePattern: "^Xiaomi Watch S5 [0-9]+mm [0-9A-F]{4}$",
    sourceFile: `${XIAOMI_ROOT}/watches/XiaomiWatchS5Coordinator.java`,
  },
];

const MODEL_BY_ID = new Map<XiaomiModelId, XiaomiModel>(
  XIAOMI_MODELS.map((model) => [model.id, model]),
);

/** Looks up a Xiaomi model by upstream id. */
export function getXiaomiModel(id: XiaomiModelId): XiaomiModel | undefined {
  return MODEL_BY_ID.get(id);
}

const MATCHERS: readonly { model: XiaomiModel; pattern: RegExp }[] = XIAOMI_MODELS.map((model) => ({
  model,
  pattern: new RegExp(model.bleNamePattern),
}));

/**
 * Matches an advertised BLE name to a registered Xiaomi protobuf model, or
 * returns null. Each coordinator's regex is used as-is (anchored, case
 * sensitive).
 */
export function matchXiaomiDeviceName(name: string): XiaomiModel | null {
  for (const { model, pattern } of MATCHERS) {
    if (pattern.test(name)) return model;
  }
  return null;
}
