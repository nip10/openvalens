/**
 * Zepp OS device-model registry.
 *
 * Ported from Gadgetbridge's Zepp OS device coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Each model's `bleNames` is the
 * exact list returned by its coordinator's `getDeviceBluetoothNames()`; the
 * `sourceFiles` field names the coordinator(s) the names and flags came from.
 *
 * The shared matcher is `ZeppOsCoordinator.getSupportedDeviceName()`:
 *
 *   ^(name1|name2|...)([- ]+[A-Z0-9]{4})?$
 *
 * i.e. an exact BLE name, optionally followed by a separator and the last
 * four uppercase alphanumeric characters of the device's MAC address. Some
 * devices advertise only the suffixed name, some only the bare name, and some
 * advertise both; the matcher accepts either. Names are case-sensitive.
 *
 * Source (base matcher):
 * https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huami/zeppos/ZeppOsCoordinator.java
 *
 * Support flags come from the upstream `device_support.yml` catalog snapshot
 * (`zepp-os-models.json`, 36 `os_zepp` entries): `feature_high`/`feature_most`/
 * `feature_unknown` and the `experimental` flag.
 *
 * IMPORTANT: `transportValidated` is source-level validation only. Only the
 * Amazfit Helio Strap has been validated against the shared Zepp OS
 * transport/auth/history stack in this codebase. No model has hardware
 * validation, and the other 35 models are unvalidated. This registry does not
 * claim support; it only records which models the shared transport is
 * expected to reach.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Stable upstream YAML ids for the 36 `os_zepp` models. */
export type ZeppOsModelId =
  | "amazfit_active"
  | "amazfit_active_2"
  | "amazfit_active_3_premium"
  | "amazfit_active_edge"
  | "amazfit_active_max"
  | "amazfit_balance"
  | "amazfit_balance_2"
  | "amazfit_balance_2_xt"
  | "amazfit_balance_3"
  | "amazfit_balance_ultra"
  | "amazfit_band_7"
  | "amazfit_bip_5"
  | "amazfit_bip_5_unity"
  | "amazfit_bip_6"
  | "amazfit_bip_max"
  | "amazfit_cheetah"
  | "amazfit_cheetah_2_pro"
  | "amazfit_cheetah_2_ultra"
  | "amazfit_cheetah_pro"
  | "amazfit_falcon"
  | "amazfit_gtr_3"
  | "amazfit_gtr_3_pro"
  | "amazfit_gtr_4"
  | "amazfit_gtr_mini"
  | "amazfit_gts_3"
  | "amazfit_gts_4"
  | "amazfit_gts_4_mini"
  | "amazfit_gts_4_mini_new"
  | "amazfit_helio_ring"
  | "amazfit_helio_strap"
  | "amazfit_trex_2"
  | "amazfit_trex_3"
  | "amazfit_trex_3_pro"
  | "amazfit_trex_ultra"
  | "amazfit_trex_ultra_2"
  | "xiaomi_mi_band_7";

/** Upstream catalog category. */
export type ZeppOsModelCategory = "rings" | "wearables";

/** Upstream `feature_*` support level. */
export type ZeppOsFeatureLevel = "high" | "most" | "unknown";

export type ZeppOsModel = Readonly<{
  /** Upstream YAML id. */
  id: ZeppOsModelId;
  displayName: string;
  category: ZeppOsModelCategory;
  featureLevel: ZeppOsFeatureLevel;
  /** Upstream `experimental` flag. */
  experimental: boolean;
  /**
   * True only for the model whose transport/auth/history path has been
   * validated at source level in this codebase (Amazfit Helio Strap). This is
   * not a hardware-support claim.
   */
  transportValidated: boolean;
  /** Exact names from the coordinator's `getDeviceBluetoothNames()`. */
  bleNames: readonly string[];
  /** Upstream coordinator source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const ZEPP_OS_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/huami/zeppos";

/**
 * The 36 `os_zepp` models, in upstream catalog order. Models with several
 * coordinators (Active 2, Cheetah, T-Rex 3 Pro) list every coordinator's
 * names and source files.
 */
export const ZEPP_OS_MODELS: readonly ZeppOsModel[] = [
  {
    id: "amazfit_active",
    displayName: "Amazfit Active",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Active"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitActiveCoordinator.java`],
  },
  {
    id: "amazfit_active_2",
    displayName: "Amazfit Active 2",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    // Three coordinators (NFC, Round, Square). The Square coordinator lists
    // four spellings of the same square/NFC family.
    bleNames: [
      "Active 2 NFC (Round)",
      "Active 2 (Round)",
      "Active 2 (Square)",
      "Active 2 NFC (Square)",
      "Active 2 Square",
      "Active 2 NFC Square",
    ],
    sourceFiles: [
      `${ZEPP_OS_ROOT}/watches/AmazfitActive2NfcCoordinator.java`,
      `${ZEPP_OS_ROOT}/watches/AmazfitActive2RoundCoordinator.java`,
      `${ZEPP_OS_ROOT}/watches/AmazfitActive2SquareCoordinator.java`,
    ],
  },
  {
    id: "amazfit_active_3_premium",
    displayName: "Amazfit Active 3 Premium",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Active 3 Premium", "Active 3 Premium"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitActive3PremiumCoordinator.java`],
  },
  {
    id: "amazfit_active_edge",
    displayName: "Amazfit Active Edge",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit Active Edge"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitActiveEdgeCoordinator.java`],
  },
  {
    id: "amazfit_active_max",
    displayName: "Amazfit Active Max",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Active Max", "Active Max"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitActiveMaxCoordinator.java`],
  },
  {
    id: "amazfit_balance",
    displayName: "Amazfit Balance",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Balance"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBalanceCoordinator.java`],
  },
  {
    id: "amazfit_balance_2",
    displayName: "Amazfit Balance 2",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Balance 2"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBalance2Coordinator.java`],
  },
  {
    id: "amazfit_balance_2_xt",
    displayName: "Amazfit Balance 2 XT",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Balance 2 XT"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBalance2XTCoordinator.java`],
  },
  {
    id: "amazfit_balance_3",
    displayName: "Amazfit Balance 3",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Balance 3", "Balance 3"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBalance3Coordinator.java`],
  },
  {
    id: "amazfit_balance_ultra",
    displayName: "Amazfit Balance Ultra",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit Balance Ultra"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBalanceUltraCoordinator.java`],
  },
  {
    id: "amazfit_band_7",
    displayName: "Amazfit Band 7",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Band 7"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBand7Coordinator.java`],
  },
  {
    id: "amazfit_bip_5",
    displayName: "Amazfit Bip 5",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Bip 5"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBip5Coordinator.java`],
  },
  {
    id: "amazfit_bip_5_unity",
    displayName: "Amazfit Bip 5 Unity",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Bip 5 Unity"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBip5UnityCoordinator.java`],
  },
  {
    id: "amazfit_bip_6",
    displayName: "Amazfit Bip 6",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Bip 6"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBip6Coordinator.java`],
  },
  {
    id: "amazfit_bip_max",
    displayName: "Amazfit Bip Max",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    // Upstream lists both capitalisations.
    bleNames: ["Amazfit Bip Max", "Amazfit BIP Max"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitBipMaxCoordinator.java`],
  },
  {
    id: "amazfit_cheetah",
    displayName: "Amazfit Cheetah",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    // Round (R) and Square (S) coordinators share one catalog model.
    bleNames: ["Amazfit Cheetah R", "Amazfit Cheetah S"],
    sourceFiles: [
      `${ZEPP_OS_ROOT}/watches/AmazfitCheetahRoundCoordinator.java`,
      `${ZEPP_OS_ROOT}/watches/AmazfitCheetahSquareCoordinator.java`,
    ],
  },
  {
    id: "amazfit_cheetah_2_pro",
    displayName: "Amazfit Cheetah 2 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit Cheetah 2 Pro", "Cheetah 2 Pro"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitCheetah2ProCoordinator.java`],
  },
  {
    id: "amazfit_cheetah_2_ultra",
    displayName: "Amazfit Cheetah 2 Ultra",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit Cheetah 2 Ultra", "Cheetah 2 Ultra"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitCheetah2UltraCoordinator.java`],
  },
  {
    id: "amazfit_cheetah_pro",
    displayName: "Amazfit Cheetah Pro",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Cheetah Pro"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitCheetahProCoordinator.java`],
  },
  {
    id: "amazfit_falcon",
    displayName: "Amazfit Falcon",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit Falcon"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitFalconCoordinator.java`],
  },
  {
    id: "amazfit_gtr_3",
    displayName: "Amazfit GTR 3",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTR 3"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTR3Coordinator.java`],
  },
  {
    id: "amazfit_gtr_3_pro",
    displayName: "Amazfit GTR 3 Pro",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTR 3 Pro"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTR3ProCoordinator.java`],
  },
  {
    id: "amazfit_gtr_4",
    displayName: "Amazfit GTR 4",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTR 4", "Amazfit GTR 4 LE"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTR4Coordinator.java`],
  },
  {
    id: "amazfit_gtr_mini",
    displayName: "Amazfit GTR Mini",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTR Mini"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTRMiniCoordinator.java`],
  },
  {
    id: "amazfit_gts_3",
    displayName: "Amazfit GTS 3",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTS 3"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTS3Coordinator.java`],
  },
  {
    id: "amazfit_gts_4",
    displayName: "Amazfit GTS 4",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTS 4"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTS4Coordinator.java`],
  },
  {
    id: "amazfit_gts_4_mini",
    displayName: "Amazfit GTS 4 Mini",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTS 4 Mini"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTS4MiniCoordinator.java`],
  },
  {
    id: "amazfit_gts_4_mini_new",
    displayName: "Amazfit GTS 4 Mini New",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit GTS 4 mini New"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitGTS4MiniNewCoordinator.java`],
  },
  {
    id: "amazfit_helio_ring",
    displayName: "Amazfit Helio Ring",
    category: "rings",
    featureLevel: "most",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit Helio Ring"],
    sourceFiles: [`${ZEPP_OS_ROOT}/rings/AmazfitHelioRingCoordinator.java`],
  },
  {
    id: "amazfit_helio_strap",
    displayName: "Amazfit Helio Strap",
    category: "wearables",
    featureLevel: "most",
    experimental: true,
    // The only model whose transport/auth/history path is validated at source level.
    transportValidated: true,
    // Upstream notes this model advertises no MAC suffix.
    bleNames: ["Amazfit Helio Strap"],
    sourceFiles: [`${ZEPP_OS_ROOT}/straps/AmazfitHelioStrapCoordinator.java`],
  },
  {
    id: "amazfit_trex_2",
    displayName: "Amazfit T-Rex 2",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit T-Rex 2"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitTRex2Coordinator.java`],
  },
  {
    id: "amazfit_trex_3",
    displayName: "Amazfit T-Rex 3",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit T-Rex 3"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitTRex3Coordinator.java`],
  },
  {
    id: "amazfit_trex_3_pro",
    displayName: "Amazfit T-Rex 3 Pro",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    // 44 mm and 48 mm coordinators share one catalog model.
    bleNames: ["T-Rex 3 Pro (44mm)", "T-Rex 3 Pro (48mm)"],
    sourceFiles: [
      `${ZEPP_OS_ROOT}/watches/AmazfitTRex3Pro44mmCoordinator.java`,
      `${ZEPP_OS_ROOT}/watches/AmazfitTRex3Pro48mmCoordinator.java`,
    ],
  },
  {
    id: "amazfit_trex_ultra",
    displayName: "Amazfit T-Rex Ultra",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Amazfit T-Rex Ultra"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitTRexUltraCoordinator.java`],
  },
  {
    id: "amazfit_trex_ultra_2",
    displayName: "Amazfit T-Rex Ultra 2",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    bleNames: ["Amazfit T-Rex Ultra 2", "T-Rex Ultra 2"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/AmazfitTRexUltra2Coordinator.java`],
  },
  {
    id: "xiaomi_mi_band_7",
    displayName: "Xiaomi Smart Band 7",
    category: "wearables",
    featureLevel: "high",
    experimental: false,
    transportValidated: false,
    bleNames: ["Xiaomi Smart Band 7"],
    sourceFiles: [`${ZEPP_OS_ROOT}/watches/MiBand7Coordinator.java`],
  },
];

const MODEL_BY_ID = new Map<ZeppOsModelId, ZeppOsModel>(
  ZEPP_OS_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getZeppOsModel(id: ZeppOsModelId): ZeppOsModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * The shared `ZeppOsCoordinator` name pattern: exact name, optionally followed
 * by a separator and the last four uppercase alphanumeric MAC characters.
 */
const BLE_NAME_SUFFIX = "([- ]+[A-Z0-9]{4})?";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BLE_NAME_MATCHERS: readonly {
  model: ZeppOsModel;
  patterns: readonly RegExp[];
}[] = ZEPP_OS_MODELS.map((model) => ({
  model,
  patterns: model.bleNames.map((name) => new RegExp(`^${escapeRegExp(name)}${BLE_NAME_SUFFIX}$`)),
}));

/**
 * Matches an advertised BLE name to a registered Zepp OS model, or returns
 * null. Exact names and the optional ` XXXX`/`-XXXX` MAC suffix are accepted;
 * matching is case-sensitive, as upstream.
 */
export function matchDeviceName(name: string): ZeppOsModel | null {
  for (const { model, patterns } of BLE_NAME_MATCHERS) {
    for (const pattern of patterns) {
      if (pattern.test(name)) return model;
    }
  }
  return null;
}
