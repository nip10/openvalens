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
 * Filter: catalog entries with `vendor == "garmin"` and
 * `category == "wearables"`. That yields 155 models, all of which carry the
 * `os_garmin` flag. The catalog also has 25 `bike-computers`, 5
 * `navigations`, and 3 `hr-bands` Garmin entries. Bike computers and GPS
 * navigators are not health wearables; the HRM entries (HRM 200/600/Pro
 * Plus) are chest straps, not wearables, so all three groups are excluded.
 *
 * IMPORTANT: `transportValidated` is false for every model. No Garmin model
 * has source-level transport validation in this codebase and no model has
 * hardware validation. This registry records the shared protocol family, not
 * a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Stable upstream YAML ids for the 155 health-relevant Garmin wearables. */
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
  | "garmin_vivosport";

/** Upstream `feature_*` support level. */
export type GarminFeatureLevel = "most" | "partial" | "unknown";

export type GarminModel = Readonly<{
  id: GarminModelId;
  displayName: string;
  category: "wearables";
  featureLevel: GarminFeatureLevel;
  experimental: boolean;
  /** Always false: no Garmin model is transport-validated. */
  transportValidated: false;
  /** Java regex source from the coordinator's `getSupportedDeviceName()`. */
  bleNamePattern: string;
  /** Upstream coordinator source file, relative to the app repo root. */
  sourceFile: string;
}>;

/** The 155 health-relevant Garmin wearables, in upstream catalog order. */
export const GARMIN_MODELS: readonly GarminModel[] = [
  {
    id: "garmin_cirqa",
    displayName: "Garmin CIRQA",
    category: "wearables",
    featureLevel: "partial",
    experimental: true,
    transportValidated: false,
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
    bleNamePattern: "^vívosport$",
    sourceFile: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/garmin/watches/vivosport/GarminVivosportCoordinator.java`,
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
