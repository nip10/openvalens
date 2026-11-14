/**
 * Garmin health-wearable registry.
 *
 * Ported from Gadgetbridge's Garmin coordinators at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. Garmin discovery is not
 * name-first: `GarminCoordinator.supports()` reads the BLE
 * manufacturer-specific data for `BluetoothCompanyIdentifiers.GARMIN_INTERNATIONAL_INC`
 * (company id 0x0087), interprets the first two bytes as a big-endian
 * product/part number, and resolves it through `GarminProductNumbers` /
 * `FitDevice` to a `DeviceType`. Only when that data is absent does it fall
 * back to `AbstractDeviceCoordinator.supports()`, which applies the
 * coordinator's `getSupportedDeviceName()` regex with Java
 * `Matcher.matches()` (full-string match). The patterns are effectively exact
 * advertised names, sometimes with an optional size suffix or a `UAT-*` alias;
 * there is no prefix matching. This registry records that fallback name
 * pattern per model; it does not carry the product-number table.
 *
 * Filter: catalog entries with `vendor == "garmin"`. That yields 190 models:
 * 157 wearables (all `os_garmin`), 24 `bike-computers`, 6 `navigations` and 3
 * `hr-bands`. The earlier 155-model cut excluded the non-wearables; the
 * server-side identity lane now registers every catalog entry, so this
 * registry matches it exactly. Bike computers, GPS navigators and chest straps
 * are registered for connection checks only (`sync: false`): the health FIT
 * files this family downloads (MONITORING, SLEEP) only exist on wearables.
 *
 * Quatix 7 / 7X are catalog-only at the pin: they have no coordinator and no
 * advertised-name fallback, so they are recognised by product number
 * (`GarminProductNumbers`); their name patterns follow the Quatix 6 style.
 *
 * IMPORTANT: `transportValidated` is false for every model. No Garmin model
 * has source-level transport validation in this codebase and no model has
 * hardware validation. This registry records the shared protocol family, not
 * a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Stable upstream YAML ids for the 190 catalog Garmin entries. */
export type GarminModelId =
  | "garmin_cirqa"
  | "garmin_d2_air"
  | "garmin_d2_air_x10"
  | "garmin_d2_air_x15"
  | "garmin_d2_mach_1"
  | "garmin_d2_mach_1_pro"
  | "garmin_d2_mach_2"
  | "garmin_d2_mach_2_pro"
  | "garmin_enduro"
  | "garmin_enduro_3"
  | "garmin_enduro_4"
  | "garmin_enduro_2"
  | "garmin_epix"
  | "garmin_epix_pro"
  | "garmin_epix_gen2"
  | "garmin_descent_g1"
  | "garmin_descent_g2"
  | "garmin_descent_mk3"
  | "garmin_descent_mk3i"
  | "garmin_fenix_2"
  | "garmin_fenix_3_chronos"
  | "garmin_fenix_5"
  | "garmin_fenix_5_plus"
  | "garmin_fenix_5s"
  | "garmin_fenix_5s_plus"
  | "garmin_fenix_5x"
  | "garmin_fenix_5x_plus"
  | "garmin_fenix_6"
  | "garmin_fenix_6s"
  | "garmin_fenix_6_pro"
  | "garmin_fenix_6_sapphire"
  | "garmin_fenix_6s_pro"
  | "garmin_fenix_6s_pro_solar"
  | "garmin_fenix_6x"
  | "garmin_fenix_6x_pro"
  | "garmin_fenix_6s_sapphire"
  | "garmin_fenix_6x_pro_solar"
  | "garmin_fenix_6x_sapphire"
  | "garmin_fenix_6_sport"
  | "garmin_fenix_6s_sport"
  | "garmin_fenix_7"
  | "garmin_fenix_7s"
  | "garmin_fenix_7s_pro"
  | "garmin_fenix_7s_pro_solar"
  | "garmin_fenix_7x"
  | "garmin_fenix_7x_pro"
  | "garmin_fenix_7x_pro_solar"
  | "garmin_fenix_7_pro"
  | "garmin_fenix_7_pro_solar"
  | "garmin_fenix_8"
  | "garmin_fenix_8_solar"
  | "garmin_fenix_8_pro"
  | "garmin_fenix_9"
  | "garmin_fenix_9_pro"
  | "garmin_fenix_9_pro_solar"
  | "garmin_fenix_e"
  | "garmin_forerunner_25"
  | "garmin_forerunner_30"
  | "garmin_forerunner_220"
  | "garmin_forerunner_225"
  | "garmin_forerunner_35"
  | "garmin_forerunner_45"
  | "garmin_forerunner_45_plus"
  | "garmin_forerunner_55"
  | "garmin_forerunner_70"
  | "garmin_forerunner_165"
  | "garmin_forerunner_165_music"
  | "garmin_forerunner_170"
  | "garmin_forerunner_170_music"
  | "garmin_forerunner_230"
  | "garmin_forerunner_235"
  | "garmin_forerunner_245"
  | "garmin_forerunner_245_music"
  | "garmin_forerunner_255"
  | "garmin_forerunner_255_music"
  | "garmin_forerunner_255s"
  | "garmin_forerunner_255s_music"
  | "garmin_forerunner_265"
  | "garmin_forerunner_265s"
  | "garmin_forerunner_570"
  | "garmin_forerunner_620"
  | "garmin_forerunner_630"
  | "garmin_forerunner_645"
  | "garmin_forerunner_645_music"
  | "garmin_forerunner_735xt"
  | "garmin_forerunner_745"
  | "garmin_forerunner_920"
  | "garmin_forerunner_935"
  | "garmin_forerunner_945"
  | "garmin_forerunner_945_lte"
  | "garmin_forerunner_955"
  | "garmin_forerunner_965"
  | "garmin_forerunner_970"
  | "garmin_instinct"
  | "garmin_instinct_2"
  | "garmin_instinct_2_solar"
  | "garmin_instinct_2_soltac"
  | "garmin_instinct_2s"
  | "garmin_instinct_2s_solar"
  | "garmin_instinct_2s_surf"
  | "garmin_instinct_2x"
  | "garmin_instinct_2x_solar"
  | "garmin_instinct_2x_tactical"
  | "garmin_instinct_3"
  | "garmin_instinct_3_tactical"
  | "garmin_instinct_3_solar"
  | "garmin_instinct_3_solar_tactical"
  | "garmin_instinct_crossover"
  | "garmin_instinct_tactical"
  | "garmin_instinct_e"
  | "garmin_lily"
  | "garmin_lily_2"
  | "garmin_lily_2_active"
  | "garmin_instinct_solar"
  | "garmin_instinct_solar_tactical"
  | "garmin_quatix_6"
  | "garmin_quatix_6x"
  | "garmin_quatix_8"
  | "garmin_tactix_7"
  | "garmin_tactix_8"
  | "garmin_tactix_8_solar"
  | "garmin_swim_2"
  | "garmin_venu"
  | "garmin_venu_sq"
  | "garmin_venu_sq_music"
  | "garmin_venu_sq_2"
  | "garmin_venu_sq_2_music"
  | "garmin_venu_2"
  | "garmin_venu_2s"
  | "garmin_venu_2_plus"
  | "garmin_venu_3"
  | "garmin_venu_3s"
  | "garmin_venu_4"
  | "garmin_venu_x1"
  | "garmin_vivoactive"
  | "garmin_vivoactive_3"
  | "garmin_vivoactive_3t"
  | "garmin_vivoactive_3_music"
  | "garmin_vivoactive_4"
  | "garmin_vivoactive_4s"
  | "garmin_vivoactive_5"
  | "garmin_vivoactive_6"
  | "garmin_vivoactive_hr"
  | "garmin_vivosmart"
  | "garmin_vivosmart_hr"
  | "garmin_vivosmart_hr_plus"
  | "garmin_vivosmart_3"
  | "garmin_vivosmart_4"
  | "garmin_vivosmart_5"
  | "garmin_vivomove"
  | "garmin_vivomove_hr"
  | "garmin_vivomove_sport"
  | "garmin_vivomove_style"
  | "garmin_vivomove_trend"
  | "garmin_vivosport"
  | "garmin_edge_25"
  | "garmin_edge_130"
  | "garmin_edge_130_plus"
  | "garmin_edge_510"
  | "garmin_edge_520"
  | "garmin_edge_520_plus"
  | "garmin_edge_530"
  | "garmin_edge_540"
  | "garmin_edge_550"
  | "garmin_edge_810"
  | "garmin_edge_820"
  | "garmin_edge_830"
  | "garmin_edge_840"
  | "garmin_edge_850"
  | "garmin_edge_1000"
  | "garmin_edge_1030"
  | "garmin_edge_1030_plus"
  | "garmin_edge_1040"
  | "garmin_edge_1050"
  | "garmin_edge_explore"
  | "garmin_edge_explore_2"
  | "garmin_edge_explore_820"
  | "garmin_edge_explore_1000"
  | "garmin_edge_mtb"
  | "garmin_etrex_se"
  | "garmin_gpsmap_66s"
  | "garmin_gpsmap_66sr"
  | "garmin_gpsmap_66i"
  | "garmin_gpsmap_h1"
  | "garmin_hrm_200"
  | "garmin_hrm_600"
  | "garmin_hrm_pro_plus"
  | "garmin_inreach_mini_2"
  | "garmin_quatix_7"
  | "garmin_quatix_7x";

/** Upstream `feature_*` support level. */
export type GarminFeatureLevel = "most" | "partial" | "unknown";

export type GarminModelCategory = "wearables" | "bike-computers" | "navigations" | "hr-bands";

export type GarminModel = Readonly<{
  id: GarminModelId;
  displayName: string;
  category: GarminModelCategory;
  featureLevel: GarminFeatureLevel;
  experimental: boolean;
  /** Always false: no Garmin model is transport-validated. */
  transportValidated: false;
  /**
   * True for health wearables, which carry the MONITORING/SLEEP FIT files this
   * family syncs. Bike computers, GPS navigators and chest straps are
   * registered for connection checks only.
   */
  sync: boolean;
  /** Java regex source from the coordinator's `getSupportedDeviceName()`. */
  bleNamePattern: string;
  /** Upstream coordinator source file, relative to the app repo root. */
  sourceFile: string;
}>;

/** The 190 catalog Garmin entries, in upstream catalog order. */
export const GARMIN_MODELS: readonly GarminModel[] = [
  {
    id: "garmin_cirqa",
    displayName: "Garmin CIRQA",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^CIRQA Smart Band$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/cirqa/GarminCirqaCoordinator.java`,
  },
  {
    id: "garmin_d2_air",
    displayName: "Garmin D2 Air",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Air( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2AirCoordinator.java`,
  },
  {
    id: "garmin_d2_air_x10",
    displayName: "Garmin D2 Air X10",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Air X10( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2AirX10Coordinator.java`,
  },
  {
    id: "garmin_d2_air_x15",
    displayName: "Garmin D2 Air X15",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Air X15( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2AirX15Coordinator.java`,
  },
  {
    id: "garmin_d2_mach_1",
    displayName: "Garmin D2 Mach 1",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Mach 1( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2Mach1Coordinator.java`,
  },
  {
    id: "garmin_d2_mach_1_pro",
    displayName: "Garmin D2 Mach 1 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Mach 1 Pro( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2Mach1ProCoordinator.java`,
  },
  {
    id: "garmin_d2_mach_2",
    displayName: "Garmin D2 Mach 2",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Mach 2( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2Mach2Coordinator.java`,
  },
  {
    id: "garmin_d2_mach_2_pro",
    displayName: "Garmin D2 Mach 2 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^D2 Mach 2 Pro( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/d2/GarminD2Mach2ProCoordinator.java`,
  },
  {
    id: "garmin_enduro",
    displayName: "Garmin Enduro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Enduro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/enduro/GarminEnduroCoordinator.java`,
  },
  {
    id: "garmin_enduro_3",
    displayName: "Garmin Enduro 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Enduro 3$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/enduro/GarminEnduro3Coordinator.java`,
  },
  {
    id: "garmin_enduro_4",
    displayName: "Garmin Enduro 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Enduro 4$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/enduro/GarminEnduro4Coordinator.java`,
  },
  {
    id: "garmin_enduro_2",
    displayName: "Garmin Enduro 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Enduro 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/enduro/GarminEnduro2Coordinator.java`,
  },
  {
    id: "garmin_epix",
    displayName: "Garmin Epix",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^EPIX$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/epix/GarminEpixCoordinator.java`,
  },
  {
    id: "garmin_epix_pro",
    displayName: "Garmin Epix Pro",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^EPIX PRO - \\d+mm$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/epix/GarminEpixProCoordinator.java`,
  },
  {
    id: "garmin_epix_gen2",
    displayName: "Garmin Epix (Gen 2)",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^epix( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/epix/GarminEpixGen2Coordinator.java`,
  },
  {
    id: "garmin_descent_g1",
    displayName: "Garmin Descent G1",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Descent G1$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/descent/GarminDescentG1Coordinator.java`,
  },
  {
    id: "garmin_descent_g2",
    displayName: "Garmin Descent G2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Descent G2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/descent/GarminDescentG2Coordinator.java`,
  },
  {
    id: "garmin_descent_mk3",
    displayName: "Garmin Descent Mk3",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Descent Mk3( [\\d+]+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/descent/GarminDescentMk3Coordinator.java`,
  },
  {
    id: "garmin_descent_mk3i",
    displayName: "Garmin Descent Mk3i",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Descent Mk3i( \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/descent/GarminDescentMk3iCoordinator.java`,
  },
  {
    id: "garmin_fenix_2",
    displayName: "Garmin Fenix 2",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix2Coordinator.java`,
  },
  {
    id: "garmin_fenix_3_chronos",
    displayName: "Garmin Fenix 3 Chronos",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix (3 )?Chronos$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix3ChronosCoordinator.java`,
  },
  {
    id: "garmin_fenix_5",
    displayName: "Garmin Fenix 5",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 5$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix5Coordinator.java`,
  },
  {
    id: "garmin_fenix_5_plus",
    displayName: "Garmin Fenix 5 Plus",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 5 Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix5PlusCoordinator.java`,
  },
  {
    id: "garmin_fenix_5s",
    displayName: "Garmin Fenix 5S",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 5s$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix5SCoordinator.java`,
  },
  {
    id: "garmin_fenix_5s_plus",
    displayName: "Garmin Fenix 5S Plus",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 5s Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix5SPlusCoordinator.java`,
  },
  {
    id: "garmin_fenix_5x",
    displayName: "Garmin Fenix 5X",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 5X$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix5XCoordinator.java`,
  },
  {
    id: "garmin_fenix_5x_plus",
    displayName: "Garmin Fenix 5X Plus",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 5X Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix5XPlusCoordinator.java`,
  },
  {
    id: "garmin_fenix_6",
    displayName: "Garmin Fenix 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6Coordinator.java`,
  },
  {
    id: "garmin_fenix_6s",
    displayName: "Garmin Fenix 6S",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6S$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SCoordinator.java`,
  },
  {
    id: "garmin_fenix_6_pro",
    displayName: "Garmin Fenix 6 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6 Pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6ProCoordinator.java`,
  },
  {
    id: "garmin_fenix_6_sapphire",
    displayName: "Garmin Fenix 6 Sapphire",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6 Sapphire$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SapphireCoordinator.java`,
  },
  {
    id: "garmin_fenix_6s_pro",
    displayName: "Garmin Fenix 6S Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6S Pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SProCoordinator.java`,
  },
  {
    id: "garmin_fenix_6s_pro_solar",
    displayName: "Garmin Fenix 6S Pro Solar",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6S Pro Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SProSolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_6x",
    displayName: "Garmin Fenix 6X",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6X$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6XCoordinator.java`,
  },
  {
    id: "garmin_fenix_6x_pro",
    displayName: "Garmin Fenix 6X Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6X Pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6XProCoordinator.java`,
  },
  {
    id: "garmin_fenix_6s_sapphire",
    displayName: "Garmin Fenix 6S Sapphire",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6S Sapphire$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SSapphireCoordinator.java`,
  },
  {
    id: "garmin_fenix_6x_pro_solar",
    displayName: "Garmin Fenix 6X Pro Solar",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6X Pro Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6XProSolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_6x_sapphire",
    displayName: "Garmin Fenix 6X Sapphire",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6X Sapphire$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6XSapphireCoordinator.java`,
  },
  {
    id: "garmin_fenix_6_sport",
    displayName: "Garmin Fenix 6 Sport",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6 Sport$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SportCoordinator.java`,
  },
  {
    id: "garmin_fenix_6s_sport",
    displayName: "Garmin Fenix 6S Sport",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 6S Sport$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix6SSportCoordinator.java`,
  },
  {
    id: "garmin_fenix_7",
    displayName: "Garmin Fenix 7",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7Coordinator.java`,
  },
  {
    id: "garmin_fenix_7s",
    displayName: "Garmin Fenix 7S",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7S$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7SCoordinator.java`,
  },
  {
    id: "garmin_fenix_7s_pro",
    displayName: "Garmin Fenix 7S Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7S Pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7SProCoordinator.java`,
  },
  {
    id: "garmin_fenix_7s_pro_solar",
    displayName: "Garmin Fenix 7S Pro Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7S Pro Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7SProSolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_7x",
    displayName: "Garmin Fenix 7X",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7X$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7XCoordinator.java`,
  },
  {
    id: "garmin_fenix_7x_pro",
    displayName: "Garmin Fenix 7X Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7X Pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7XProCoordinator.java`,
  },
  {
    id: "garmin_fenix_7x_pro_solar",
    displayName: "Garmin Fenix 7X Pro Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7X Pro Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7XProSolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_7_pro",
    displayName: "Garmin Fenix 7 Pro",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7 Pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7ProCoordinator.java`,
  },
  {
    id: "garmin_fenix_7_pro_solar",
    displayName: "Garmin Fenix 7 Pro Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 7 Pro Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix7ProSolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_8",
    displayName: "Garmin Fenix 8",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 8( - [\\d+]+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix8Coordinator.java`,
  },
  {
    id: "garmin_fenix_8_solar",
    displayName: "Garmin Fenix 8 Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 8 Solar( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix8SolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_8_pro",
    displayName: "Garmin Fenix 8 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 8 Pro( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix8ProCoordinator.java`,
  },
  {
    id: "garmin_fenix_9",
    displayName: "Garmin Fenix 9",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 9$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix9Coordinator.java`,
  },
  {
    id: "garmin_fenix_9_pro",
    displayName: "Garmin Fenix 9 Pro",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 9 pro$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix9ProCoordinator.java`,
  },
  {
    id: "garmin_fenix_9_pro_solar",
    displayName: "Garmin Fenix 9 Pro Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix 9 pro solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenix9ProSolarCoordinator.java`,
  },
  {
    id: "garmin_fenix_e",
    displayName: "Garmin Fenix E",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^fenix E$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/fenix/GarminFenixECoordinator.java`,
  },
  {
    id: "garmin_forerunner_25",
    displayName: "Garmin Forerunner 25",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 25$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner25Coordinator.java`,
  },
  {
    id: "garmin_forerunner_30",
    displayName: "Garmin Forerunner 30",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 30$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner30Coordinator.java`,
  },
  {
    id: "garmin_forerunner_220",
    displayName: "Garmin Forerunner 220",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 220$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner220Coordinator.java`,
  },
  {
    id: "garmin_forerunner_225",
    displayName: "Garmin Forerunner 225",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 225$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner225Coordinator.java`,
  },
  {
    id: "garmin_forerunner_35",
    displayName: "Garmin Forerunner 35",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 35$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner35Coordinator.java`,
  },
  {
    id: "garmin_forerunner_45",
    displayName: "Garmin Forerunner 45",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 45$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner45Coordinator.java`,
  },
  {
    id: "garmin_forerunner_45_plus",
    displayName: "Garmin Forerunner 45 Plus",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 45 Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner45PlusCoordinator.java`,
  },
  {
    id: "garmin_forerunner_55",
    displayName: "Garmin Forerunner 55",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 55$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner55Coordinator.java`,
  },
  {
    id: "garmin_forerunner_70",
    displayName: "Garmin Forerunner 70",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 70$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner70Coordinator.java`,
  },
  {
    id: "garmin_forerunner_165",
    displayName: "Garmin Forerunner 165",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 165$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner165Coordinator.java`,
  },
  {
    id: "garmin_forerunner_165_music",
    displayName: "Garmin Forerunner 165 Music",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 165 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner165MusicCoordinator.java`,
  },
  {
    id: "garmin_forerunner_170",
    displayName: "Garmin Forerunner 170",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 170$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner170Coordinator.java`,
  },
  {
    id: "garmin_forerunner_170_music",
    displayName: "Garmin Forerunner 170 Music",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 170 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner170MusicCoordinator.java`,
  },
  {
    id: "garmin_forerunner_230",
    displayName: "Garmin Forerunner 230",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 230$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner230Coordinator.java`,
  },
  {
    id: "garmin_forerunner_235",
    displayName: "Garmin Forerunner 235",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 235$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner235Coordinator.java`,
  },
  {
    id: "garmin_forerunner_245",
    displayName: "Garmin Forerunner 245",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 245$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner245Coordinator.java`,
  },
  {
    id: "garmin_forerunner_245_music",
    displayName: "Garmin Forerunner 245 Music",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 245 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner245MusicCoordinator.java`,
  },
  {
    id: "garmin_forerunner_255",
    displayName: "Garmin Forerunner 255",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 255$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner255Coordinator.java`,
  },
  {
    id: "garmin_forerunner_255_music",
    displayName: "Garmin Forerunner 255 Music",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 255 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner255MusicCoordinator.java`,
  },
  {
    id: "garmin_forerunner_255s",
    displayName: "Garmin Forerunner 255S",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 255S$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner255SCoordinator.java`,
  },
  {
    id: "garmin_forerunner_255s_music",
    displayName: "Garmin Forerunner 255S Music",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 255S Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner255SMusicCoordinator.java`,
  },
  {
    id: "garmin_forerunner_265",
    displayName: "Garmin Forerunner 265",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 265$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner265Coordinator.java`,
  },
  {
    id: "garmin_forerunner_265s",
    displayName: "Garmin Forerunner 265S",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^(Garmin )?Forerunner 265[sS]$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner265SCoordinator.java`,
  },
  {
    id: "garmin_forerunner_570",
    displayName: "Garmin Forerunner 570",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 570",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner570Coordinator.java`,
  },
  {
    id: "garmin_forerunner_620",
    displayName: "Garmin Forerunner 620",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 620$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner620Coordinator.java`,
  },
  {
    id: "garmin_forerunner_630",
    displayName: "Garmin Forerunner 630",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 630$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner630Coordinator.java`,
  },
  {
    id: "garmin_forerunner_645",
    displayName: "Garmin Forerunner 645",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 645$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner645Coordinator.java`,
  },
  {
    id: "garmin_forerunner_645_music",
    displayName: "Garmin Forerunner 645 Music",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 645 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner645MusicCoordinator.java`,
  },
  {
    id: "garmin_forerunner_735xt",
    displayName: "Garmin Forerunner 735XT",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 735XT$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner735XTCoordinator.java`,
  },
  {
    id: "garmin_forerunner_745",
    displayName: "Garmin Forerunner 745",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 745$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner745Coordinator.java`,
  },
  {
    id: "garmin_forerunner_920",
    displayName: "Garmin Forerunner 920",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 920$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner920Coordinator.java`,
  },
  {
    id: "garmin_forerunner_935",
    displayName: "Garmin Forerunner 935",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 935$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner935Coordinator.java`,
  },
  {
    id: "garmin_forerunner_945",
    displayName: "Garmin Forerunner 945",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 945$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner945Coordinator.java`,
  },
  {
    id: "garmin_forerunner_945_lte",
    displayName: "Garmin Forerunner 945 LTE",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 945 LTE$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner945LTECoordinator.java`,
  },
  {
    id: "garmin_forerunner_955",
    displayName: "Garmin Forerunner 955",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 955$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner955Coordinator.java`,
  },
  {
    id: "garmin_forerunner_965",
    displayName: "Garmin Forerunner 965",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 965|UAT-4315$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner965Coordinator.java`,
  },
  {
    id: "garmin_forerunner_970",
    displayName: "Garmin Forerunner 970",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Forerunner 970$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/forerunner/GarminForerunner970Coordinator.java`,
  },
  {
    id: "garmin_instinct",
    displayName: "Garmin Instinct",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinctCoordinator.java`,
  },
  {
    id: "garmin_instinct_2",
    displayName: "Garmin Instinct 2",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2Coordinator.java`,
  },
  {
    id: "garmin_instinct_2_solar",
    displayName: "Garmin Instinct 2 Solar",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2 Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2SolarCoordinator.java`,
  },
  {
    id: "garmin_instinct_2_soltac",
    displayName: "Garmin Instinct 2 SolTac",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2 SolTac$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2SolTacCoordinator.java`,
  },
  {
    id: "garmin_instinct_2s",
    displayName: "Garmin Instinct 2S",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2S$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2SCoordinator.java`,
  },
  {
    id: "garmin_instinct_2s_solar",
    displayName: "Garmin Instinct 2S Solar",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2S Solar$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2SSolarCoordinator.java`,
  },
  {
    id: "garmin_instinct_2s_surf",
    displayName: "Garmin Instinct 2S Surf",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2S Surf$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2SSurfCoordinator.java`,
  },
  {
    id: "garmin_instinct_2x",
    displayName: "Garmin Instinct 2X",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2X$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2XCoordinator.java`,
  },
  {
    id: "garmin_instinct_2x_solar",
    displayName: "Garmin Instinct 2X Solar",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2X Sol(ar)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2XSolarCoordinator.java`,
  },
  {
    id: "garmin_instinct_2x_tactical",
    displayName: "Garmin Instinct 2X Tactical",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 2X Tactical$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct2XTacticalCoordinator.java`,
  },
  {
    id: "garmin_instinct_3",
    displayName: "Garmin Instinct 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 3 - \\d+mm$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct3Coordinator.java`,
  },
  {
    id: "garmin_instinct_3_tactical",
    displayName: "Garmin Instinct 3 Tactical",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 3 - \\d+mm Tac$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct3TacticalCoordinator.java`,
  },
  {
    id: "garmin_instinct_3_solar",
    displayName: "Garmin Instinct 3 Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 3 Solar( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct3SolarCoordinator.java`,
  },
  {
    id: "garmin_instinct_3_solar_tactical",
    displayName: "Garmin Instinct 3 Solar Tactical",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct 3 (SolTac|(Solar (Tac|Tactical|Tactical Edition)))$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinct3SolarTacticalCoordinator.java`,
  },
  {
    id: "garmin_instinct_crossover",
    displayName: "Garmin Instinct Crossover",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct Crossover$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinctCrossoverCoordinator.java`,
  },
  {
    id: "garmin_instinct_tactical",
    displayName: "Garmin Instinct Tactical",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct Tactical$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinctTacticalCoordinator.java`,
  },
  {
    id: "garmin_instinct_e",
    displayName: "Garmin Instinct E",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct E - \\d+mm$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinctECoordinator.java`,
  },
  {
    id: "garmin_lily",
    displayName: "Garmin Lily",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Lily$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/lily/GarminLilyCoordinator.java`,
  },
  {
    id: "garmin_lily_2",
    displayName: "Garmin Lily 2",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Lily 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/lily/GarminLily2Coordinator.java`,
  },
  {
    id: "garmin_lily_2_active",
    displayName: "Garmin Lily 2 Active",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Lily 2 Active$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/lily/GarminLily2ActiveCoordinator.java`,
  },
  {
    id: "garmin_instinct_solar",
    displayName: "Garmin Instinct Solar",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct (Solar|Dual Power)$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinctSolarCoordinator.java`,
  },
  {
    id: "garmin_instinct_solar_tactical",
    displayName: "Garmin Instinct Solar Tactical",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Instinct Solar Tac$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/instinct/GarminInstinctSolarTacticalCoordinator.java`,
  },
  {
    id: "garmin_quatix_6",
    displayName: "Garmin Quatix 6",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^quatix 6$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/quatix/GarminQuatix6Coordinator.java`,
  },
  {
    id: "garmin_quatix_6x",
    displayName: "Garmin Quatix 6X",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^quatix 6X$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/quatix/GarminQuatix6XCoordinator.java`,
  },
  {
    id: "garmin_quatix_8",
    displayName: "Garmin Quatix 8",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^quatix 8( - [\\d+]+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/quatix/GarminQuatix8Coordinator.java`,
  },
  {
    id: "garmin_tactix_7",
    displayName: "Garmin Tactix 7",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^tactix 7$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/tactix/GarminTactix7Coordinator.java`,
  },
  {
    id: "garmin_tactix_8",
    displayName: "Garmin Tactix 8",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^tactix 8( - [\\d+]+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/tactix/GarminTactix8Coordinator.java`,
  },
  {
    id: "garmin_tactix_8_solar",
    displayName: "Garmin Tactix 8 Solar",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^tactix 8 Solar( - \\d+mm)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/tactix/GarminTactix8SolarCoordinator.java`,
  },
  {
    id: "garmin_swim_2",
    displayName: "Garmin Swim 2",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Swim 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/swim/GarminSwim2Coordinator.java`,
  },
  {
    id: "garmin_venu",
    displayName: "Garmin Venu",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenuCoordinator.java`,
  },
  {
    id: "garmin_venu_sq",
    displayName: "Garmin Venu Sq",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu Sq$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenuSqCoordinator.java`,
  },
  {
    id: "garmin_venu_sq_music",
    displayName: "Garmin Venu Sq Music",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu Sq Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenuSqMusicCoordinator.java`,
  },
  {
    id: "garmin_venu_sq_2",
    displayName: "Garmin Venu Sq 2",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu Sq 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenuSq2Coordinator.java`,
  },
  {
    id: "garmin_venu_sq_2_music",
    displayName: "Garmin Venu Sq 2 Music",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu Sq 2 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenuSq2MusicCoordinator.java`,
  },
  {
    id: "garmin_venu_2",
    displayName: "Garmin Venu 2",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenu2Coordinator.java`,
  },
  {
    id: "garmin_venu_2s",
    displayName: "Garmin Venu 2S",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu 2S$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenu2SCoordinator.java`,
  },
  {
    id: "garmin_venu_2_plus",
    displayName: "Garmin Venu 2 Plus",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu 2 Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenu2PlusCoordinator.java`,
  },
  {
    id: "garmin_venu_3",
    displayName: "Garmin Venu 3",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu 3$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenu3Coordinator.java`,
  },
  {
    id: "garmin_venu_3s",
    displayName: "Garmin Venu 3S",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu 3S|UAT-4261$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenu3SCoordinator.java`,
  },
  {
    id: "garmin_venu_4",
    displayName: "Garmin Venu 4",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu 4 (- )?\\d+mm$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenu4Coordinator.java`,
  },
  {
    id: "garmin_venu_x1",
    displayName: "Garmin Venu X1",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^Venu X1$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/venu/GarminVenuX1Coordinator.java`,
  },
  {
    id: "garmin_vivoactive",
    displayName: "Garmin Vívoactive",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActiveCoordinator.java`,
  },
  {
    id: "garmin_vivoactive_3",
    displayName: "Garmin Vívoactive 3",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive *3$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive3Coordinator.java`,
  },
  {
    id: "garmin_vivoactive_3t",
    displayName: "Garmin Vívoactive 3T",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive 3T$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive3TCoordinator.java`,
  },
  {
    id: "garmin_vivoactive_3_music",
    displayName: "Garmin Vívoactive 3 Music",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive 3 Music$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive3MusicCoordinator.java`,
  },
  {
    id: "garmin_vivoactive_4",
    displayName: "Garmin Vívoactive 4",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive 4$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive4Coordinator.java`,
  },
  {
    id: "garmin_vivoactive_4s",
    displayName: "Garmin Vívoactive 4S",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive 4S$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive4SCoordinator.java`,
  },
  {
    id: "garmin_vivoactive_5",
    displayName: "Garmin Vívoactive 5",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive 5$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive5Coordinator.java`,
  },
  {
    id: "garmin_vivoactive_6",
    displayName: "Garmin Vívoactive 6",
    category: "wearables",
    featureLevel: "most",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive 6$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActive6Coordinator.java`,
  },
  {
    id: "garmin_vivoactive_hr",
    displayName: "Garmin Vívoactive HR",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívoactive HR$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivoactive/GarminVivoActiveHrCoordinator.java`,
  },
  {
    id: "garmin_vivosmart",
    displayName: "Garmin Vívosmart",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosmart$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosmart/GarminVivosmartCoordinator.java`,
  },
  {
    id: "garmin_vivosmart_hr",
    displayName: "Garmin Vívosmart HR",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosmart HR$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosmart/GarminVivosmartHrCoordinator.java`,
  },
  {
    id: "garmin_vivosmart_hr_plus",
    displayName: "Garmin Vívosmart HR+",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosmart HR\\+$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosmart/GarminVivosmartHrPlusCoordinator.java`,
  },
  {
    id: "garmin_vivosmart_3",
    displayName: "Garmin Vívosmart 3",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosmart 3$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosmart/GarminVivosmart3Coordinator.java`,
  },
  {
    id: "garmin_vivosmart_4",
    displayName: "Garmin Vívosmart 4",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosmart 4$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosmart/GarminVivosmart4Coordinator.java`,
  },
  {
    id: "garmin_vivosmart_5",
    displayName: "Garmin Vívosmart 5",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosmart 5$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosmart/GarminVivosmart5Coordinator.java`,
  },
  {
    id: "garmin_vivomove",
    displayName: "Garmin Vívomove",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívomove$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivomove/GarminVivomoveCoordinator.java`,
  },
  {
    id: "garmin_vivomove_hr",
    displayName: "Garmin Vívomove HR",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívomove HR$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivomove/GarminVivomoveHrCoordinator.java`,
  },
  {
    id: "garmin_vivomove_sport",
    displayName: "Garmin Vívomove Sport",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívomove Sport$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivomove/GarminVivomoveSportCoordinator.java`,
  },
  {
    id: "garmin_vivomove_style",
    displayName: "Garmin Vívomove Style",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívomove Style$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivomove/GarminVivomoveStyleCoordinator.java`,
  },
  {
    id: "garmin_vivomove_trend",
    displayName: "Garmin Vívomove Trend",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívomove Trend$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivomove/GarminVivomoveTrendCoordinator.java`,
  },
  {
    id: "garmin_vivosport",
    displayName: "Garmin Vívosport",
    category: "wearables",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^vívosport$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosport/GarminVivosportCoordinator.java`,
  },
  {
    id: "garmin_edge_25",
    displayName: "Garmin Edge 25",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 2x$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge25Coordinator.java`,
  },
  {
    id: "garmin_edge_130",
    displayName: "Garmin Edge 130",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 130$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge130Coordinator.java`,
  },
  {
    id: "garmin_edge_130_plus",
    displayName: "Garmin Edge 130 Plus",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 130 Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge130PlusCoordinator.java`,
  },
  {
    id: "garmin_edge_510",
    displayName: "Garmin Edge 510",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 510$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge510Coordinator.java`,
  },
  {
    id: "garmin_edge_520",
    displayName: "Garmin Edge 520",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 520$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge520Coordinator.java`,
  },
  {
    id: "garmin_edge_520_plus",
    displayName: "Garmin Edge 520 Plus",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 520 Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge520PlusCoordinator.java`,
  },
  {
    id: "garmin_edge_530",
    displayName: "Garmin Edge 530",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 530$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge530Coordinator.java`,
  },
  {
    id: "garmin_edge_540",
    displayName: "Garmin Edge 540",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 540$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge540Coordinator.java`,
  },
  {
    id: "garmin_edge_550",
    displayName: "Garmin Edge 550",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 550$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge550Coordinator.java`,
  },
  {
    id: "garmin_edge_810",
    displayName: "Garmin Edge 810",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 810$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge810Coordinator.java`,
  },
  {
    id: "garmin_edge_820",
    displayName: "Garmin Edge 820",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 820$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge820Coordinator.java`,
  },
  {
    id: "garmin_edge_830",
    displayName: "Garmin Edge 830",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 830$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge830Coordinator.java`,
  },
  {
    id: "garmin_edge_840",
    displayName: "Garmin Edge 840",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 840$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge840Coordinator.java`,
  },
  {
    id: "garmin_edge_850",
    displayName: "Garmin Edge 850",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 850$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge850Coordinator.java`,
  },
  {
    id: "garmin_edge_1000",
    displayName: "Garmin Edge 1000",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 1000$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge1000Coordinator.java`,
  },
  {
    id: "garmin_edge_1030",
    displayName: "Garmin Edge 1030",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 1030$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge1030Coordinator.java`,
  },
  {
    id: "garmin_edge_1030_plus",
    displayName: "Garmin Edge 1030 Plus",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 1030 Plus$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge1030PlusCoordinator.java`,
  },
  {
    id: "garmin_edge_1040",
    displayName: "Garmin Edge 1040",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 1040$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge1040Coordinator.java`,
  },
  {
    id: "garmin_edge_1050",
    displayName: "Garmin Edge 1050",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge 1050$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdge1050Coordinator.java`,
  },
  {
    id: "garmin_edge_explore",
    displayName: "Garmin Edge Explore",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge Explore$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdgeExploreCoordinator.java`,
  },
  {
    id: "garmin_edge_explore_2",
    displayName: "Garmin Edge Explore 2",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge Explore 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdgeExplore2Coordinator.java`,
  },
  {
    id: "garmin_edge_explore_820",
    displayName: "Garmin Edge Explore 820",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge Explore 820$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdgeExplore820Coordinator.java`,
  },
  {
    id: "garmin_edge_explore_1000",
    displayName: "Garmin Edge Explore 1000",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge Explore 1000$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdgeExplore1000Coordinator.java`,
  },
  {
    id: "garmin_edge_mtb",
    displayName: "Garmin Edge MTB",
    category: "bike-computers",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^Edge MTB$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/bike/GarminEdgeMtbCoordinator.java`,
  },
  {
    id: "garmin_etrex_se",
    displayName: "Garmin eTrex SE",
    category: "bike-computers",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^eTrex SE$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/gps/GarminETrexSeCoordinator.java`,
  },
  {
    id: "garmin_gpsmap_66s",
    displayName: "Garmin GPSMAP 66s",
    category: "navigations",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^GPSMAP 66S( #\\d+)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/gps/GarminGpsmap66sCoordinator.java`,
  },
  {
    id: "garmin_gpsmap_66sr",
    displayName: "Garmin GPSMAP 66sr",
    category: "navigations",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^GPSMAP 66SR( #\\d+)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/gps/GarminGpsmap66srCoordinator.java`,
  },
  {
    id: "garmin_gpsmap_66i",
    displayName: "Garmin GPSMAP 66i",
    category: "navigations",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^GPSMAP 66I( #\\d+)?$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/gps/GarminGpsmap66iCoordinator.java`,
  },
  {
    id: "garmin_gpsmap_h1",
    displayName: "Garmin GPSMAP H1",
    category: "navigations",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^GPSMAP H1$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/gps/GarminGpsmapH1Coordinator.java`,
  },
  {
    id: "garmin_hrm_200",
    displayName: "Garmin HRM 200",
    category: "hr-bands",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^HRM 200$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/hrm/GarminHrm200Coordinator.kt`,
  },
  {
    id: "garmin_hrm_600",
    displayName: "Garmin HRM 600",
    category: "hr-bands",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^HRM600:[0-9]+$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/hrm/GarminHrm600Coordinator.kt`,
  },
  {
    id: "garmin_hrm_pro_plus",
    displayName: "Garmin HRM Pro Plus",
    category: "hr-bands",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^HRMPro[+]:\\d+$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/hrm/GarminHrmProPlusCoordinator.java`,
  },
  {
    id: "garmin_inreach_mini_2",
    displayName: "Garmin inReach Mini 2",
    category: "navigations",
    featureLevel: "partial",
    experimental: false,
    transportValidated: false,
    sync: false,
    bleNamePattern: "^inReach Mini 2$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/gps/GarminInReachMini2.java`,
  },
  {
    id: "garmin_quatix_7",
    displayName: "Garmin Quatix 7",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^quatix 7$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/GarminProductNumbers.java`,
  },
  {
    id: "garmin_quatix_7x",
    displayName: "Garmin Quatix 7X",
    category: "wearables",
    featureLevel: "unknown",
    experimental: true,
    transportValidated: false,
    sync: true,
    bleNamePattern: "^quatix 7X$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/GarminProductNumbers.java`,
  },
];

const MODEL_BY_ID = new Map<GarminModelId, GarminModel>(
  GARMIN_MODELS.map((model) => [model.id, model]),
);

/** Looks up a Garmin model by upstream id. */
export function getGarminModel(id: GarminModelId): GarminModel | undefined {
  return MODEL_BY_ID.get(id);
}

const MATCHERS: readonly { model: GarminModel; pattern: RegExp }[] = GARMIN_MODELS.map((model) => ({
  model,
  // Java `Matcher.matches()` is a full-string match; wrap the upstream
  // pattern so JavaScript `RegExp.test()` has the same semantics.
  pattern: new RegExp(`^(?:${model.bleNamePattern})$`),
}));

/**
 * Matches an advertised BLE name to a registered Garmin model, or null.
 * This is the upstream name fallback only; real Garmin discovery prefers
 * the manufacturer-data product number (company id 0x0087).
 */
export function matchGarminDeviceName(name: string): GarminModel | null {
  for (const { model, pattern } of MATCHERS) {
    if (pattern.test(name)) return model;
  }
  return null;
}

/**
 * Edge bike computers: the 24 coordinators that extend upstream's
 * `GarminBikeComputerCoordinator` (`devices/garmin/bike/`). Upstream serves
 * files over Bluetooth Classic RFCOMM for any Garmin device whose BLE
 * directory lists no FIT file (`GarminSupport.onDirectoryWithoutFitFiles`,
 * "e.g. Edge 520 Plus"). We enable that path, Android only, for this
 * Edge-class family, which is otherwise registered for connection checks only.
 * The eTrex SE (catalogued as a bike computer, but its coordinator extends
 * `GarminCoordinator`) is not included. Not hardware-validated.
 */
export const GARMIN_RFCOMM_MODEL_IDS: ReadonlySet<GarminModelId> = new Set<GarminModelId>([
  "garmin_edge_25",
  "garmin_edge_130",
  "garmin_edge_130_plus",
  "garmin_edge_510",
  "garmin_edge_520",
  "garmin_edge_520_plus",
  "garmin_edge_530",
  "garmin_edge_540",
  "garmin_edge_550",
  "garmin_edge_810",
  "garmin_edge_820",
  "garmin_edge_830",
  "garmin_edge_840",
  "garmin_edge_850",
  "garmin_edge_1000",
  "garmin_edge_1030",
  "garmin_edge_1030_plus",
  "garmin_edge_1040",
  "garmin_edge_1050",
  "garmin_edge_explore",
  "garmin_edge_explore_2",
  "garmin_edge_explore_820",
  "garmin_edge_explore_1000",
  "garmin_edge_mtb",
]);

/** True for an Edge model whose files may come over RFCOMM on Android. */
export function garminUsesRfcommFileTransfer(id: string): boolean {
  return GARMIN_RFCOMM_MODEL_IDS.has(id as GarminModelId);
}
