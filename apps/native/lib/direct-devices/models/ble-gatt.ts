/**
 * Bluetooth GATT sensor-model registry (heart rate, blood pressure,
 * thermometers).
 *
 * Ported from Gadgetbridge's generic GATT coordinators and profile parsers at
 * revision 8976702fc3d00e6008c91fe994668cb4027f7bc2. Upstream resolves a named
 * model with a full-string Java `Matcher.matches()` regex against the
 * advertised name. When no named coordinator matches, `GenericCoordinator`
 * (last resort) matches the advertised service UUID: 0x180D heart rate,
 * 0x1810 blood pressure, 0x1809 health thermometer. Bonding is not required
 * for any of these devices (`pair_free` in the upstream catalog).
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/btle/profiles/heartrate/HeartRateProfile.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/btle/profiles/bloodpressure/BloodPressureProfile.kt
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/btle/profiles/thermometer/TemperatureProfile.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/generic/
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/{polar,coospo,beurer,sanitas,femometer}/
 *
 * Capability is connection plus live notification capture only. There is no
 * step history and no history backfill for this family.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the generic GATT profile is
 * expected to reach; it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Bluetooth SIG service UUIDs used for generic (UUID-only) recognition. */
export const HEART_RATE_SERVICE_UUID = "0000180d-0000-1000-8000-00805f9b34fb";
export const BLOOD_PRESSURE_SERVICE_UUID = "00001810-0000-1000-8000-00805f9b34fb";
export const HEALTH_THERMOMETER_SERVICE_UUID = "00001809-0000-1000-8000-00805f9b34fb";

const BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";

/**
 * Expands a 16- or 32-bit Bluetooth SIG UUID to its 128-bit form so scan
 * results (which may be short) compare with the constants above.
 */
export function normalizeServiceUuid(uuid: string): string {
  const lower = uuid.trim().toLowerCase().replace(/^0x/, "");
  if (lower.length === 4) return `0000${lower}${BASE_UUID_SUFFIX}`;
  if (lower.length === 8) return `${lower}${BASE_UUID_SUFFIX}`;
  return lower;
}

/** Record kinds this family can emit. Steps are deliberately absent. */
export type BleGattRecordType = "heart_rate" | "body_temperature" | "blood_pressure";

/** Stable upstream YAML ids for the 13 supported generic GATT models. */
export type BleGattModelId =
  | "generic_heart_rate_sensor"
  | "polar_h10"
  | "polar_h9"
  | "coospo_h6"
  | "coospo_h9z"
  | "coospo_hw807"
  | "coospo_hw9"
  | "generic_blood_pressure_monitor"
  | "beurer_bm59"
  | "beurer_bm69"
  | "sanitas_sbm67"
  | "generic_health_thermometer"
  | "femometer_vinca_2";

export type BleGattModelCategory = "hr-bands" | "blood-monitors" | "thermometers";

export type BleGattModel = Readonly<{
  /** Upstream YAML id. */
  id: BleGattModelId;
  displayName: string;
  category: BleGattModelCategory;
  /** True only for the UUID-only fallback models. */
  generic: boolean;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns. Empty for generic models, which are
   * matched by service UUID only.
   */
  bleNamePatterns: readonly RegExp[];
  /** Advertised measurement service UUIDs for this model. */
  serviceUuids: readonly string[];
  /** Record kinds the model's GATT profile can emit. */
  records: readonly BleGattRecordType[];
  /** Upstream coordinator source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const HR = HEART_RATE_SERVICE_UUID;
const BP = BLOOD_PRESSURE_SERVICE_UUID;
const TEMP = HEALTH_THERMOMETER_SERVICE_UUID;

const GENERIC_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/generic";
const POLAR_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/polar";
const COOSPO_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/coospo";
const BEURER_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/beurer";
const SANITAS_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/sanitas";
const FEMOMETER_ROOT = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/femometer";

/**
 * The 13 models, generic fallbacks first. Name patterns are case-sensitive,
 * matching upstream `Matcher.matches()`; prefix models keep their `^` anchor
 * but no `$` (upstream uses an anchored prefix for Beurer).
 */
export const BLE_GATT_MODELS: readonly BleGattModel[] = [
  {
    id: "generic_heart_rate_sensor",
    displayName: "Generic Heart Rate Sensor",
    category: "hr-bands",
    generic: true,
    transportValidated: false,
    bleNamePatterns: [],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${GENERIC_ROOT}/GenericHeartRateSensorCoordinator.java`],
  },
  {
    id: "polar_h10",
    displayName: "Polar H10",
    category: "hr-bands",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^Polar H10.*/],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${POLAR_ROOT}/PolarH10Coordinator.java`],
  },
  {
    id: "polar_h9",
    displayName: "Polar H9",
    category: "hr-bands",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^Polar H9( \w+)?$/],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${POLAR_ROOT}/PolarH9Coordinator.java`],
  },
  {
    id: "coospo_h6",
    displayName: "Coospo H6",
    category: "hr-bands",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^H6M [0-9]{5}$/],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${COOSPO_ROOT}/CoospoH6Coordinator.java`],
  },
  {
    id: "coospo_h9z",
    displayName: "Coospo H9Z",
    category: "hr-bands",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^H9Z [0-9]{5}$/],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${COOSPO_ROOT}/CoospoH9ZCoordinator.java`],
  },
  {
    id: "coospo_hw807",
    displayName: "Coospo HW807",
    category: "hr-bands",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^(COOSPO )?HW807$/],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${COOSPO_ROOT}/CoospoHW807Coordinator.java`],
  },
  {
    id: "coospo_hw9",
    displayName: "Coospo HW9",
    category: "hr-bands",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^HW9 [0-9]{5}$/],
    serviceUuids: [HR],
    records: ["heart_rate"],
    sourceFiles: [`${COOSPO_ROOT}/CoospoHW9Coordinator.java`],
  },
  {
    id: "generic_blood_pressure_monitor",
    displayName: "Generic Blood Pressure Monitor",
    category: "blood-monitors",
    generic: true,
    transportValidated: false,
    bleNamePatterns: [],
    serviceUuids: [BP],
    records: ["blood_pressure"],
    sourceFiles: [`${GENERIC_ROOT}/GenericBloodPressureMonitorCoordinator.java`],
  },
  {
    id: "beurer_bm59",
    displayName: "Beurer BM59",
    category: "blood-monitors",
    generic: false,
    transportValidated: false,
    // Upstream matches the `BM59` prefix, not the full advertised name.
    bleNamePatterns: [/^BM59/],
    serviceUuids: [BP],
    records: ["blood_pressure"],
    sourceFiles: [`${BEURER_ROOT}/BeurerBm59Coordinator.java`],
  },
  {
    id: "beurer_bm69",
    displayName: "Beurer BM69",
    category: "blood-monitors",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^BM69/],
    serviceUuids: [BP],
    records: ["blood_pressure"],
    sourceFiles: [`${BEURER_ROOT}/BeurerBm69Coordinator.java`],
  },
  {
    id: "sanitas_sbm67",
    displayName: "Sanitas SBM67",
    category: "blood-monitors",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^BPM Smart$/, /^SBM67$/],
    serviceUuids: [BP],
    records: ["blood_pressure"],
    sourceFiles: [`${SANITAS_ROOT}/SanitasSbm67Coordinator.java`],
  },
  {
    id: "generic_health_thermometer",
    displayName: "Generic Health Thermometer",
    category: "thermometers",
    generic: true,
    transportValidated: false,
    bleNamePatterns: [],
    serviceUuids: [TEMP],
    records: ["body_temperature"],
    sourceFiles: [`${GENERIC_ROOT}/GenericThermometerCoordinator.java`],
  },
  {
    id: "femometer_vinca_2",
    displayName: "Femometer Vinca 2",
    category: "thermometers",
    generic: false,
    transportValidated: false,
    bleNamePatterns: [/^BM-Vinca2$/],
    serviceUuids: [TEMP],
    records: ["body_temperature"],
    sourceFiles: [`${FEMOMETER_ROOT}/FemometerVinca2Coordinator.java`],
  },
];

const MODEL_BY_ID = new Map<BleGattModelId, BleGattModel>(
  BLE_GATT_MODELS.map((model) => [model.id, model]),
);

const NAMED_MODELS = BLE_GATT_MODELS.filter((model) => !model.generic);
const GENERIC_MODELS = BLE_GATT_MODELS.filter((model) => model.generic);

/** Looks up a model by upstream id. */
export function getBleGattModel(id: BleGattModelId): BleGattModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name and/or advertised service UUIDs to a
 * registered generic GATT model.
 *
 * Named models are tried first with their full-string (or anchored-prefix)
 * regex. Generic models are considered only when no named model matched, and
 * only by advertised service UUID, mirroring upstream's last-resort
 * `GenericCoordinator`. Returns null when nothing matches.
 */
export function matchBleGattDevice(
  name: string | null | undefined,
  serviceUuids: readonly string[] | null | undefined,
): BleGattModel | null {
  if (name) {
    for (const model of NAMED_MODELS) {
      if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
    }
  }
  const advertised = new Set((serviceUuids ?? []).map(normalizeServiceUuid));
  if (advertised.size === 0) return null;
  for (const model of GENERIC_MODELS) {
    if (model.serviceUuids.some((uuid) => advertised.has(uuid))) return model;
  }
  return null;
}
