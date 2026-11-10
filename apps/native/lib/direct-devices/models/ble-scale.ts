/**
 * Bluetooth smart-scale model registry (weight and body composition).
 *
 * Ported from Gadgetbridge's scale coordinators and device supports at
 * revision 8976702fc3d00e6008c91fe994668cb4027f7bc2. Every scale in this
 * family is a GATT connection device (`BONDING_STYLE_NONE`); none of them is
 * advertisement-based. Upstream resolves a named model with a full-string Java
 * `Matcher.matches()` regex against the advertised name, case-insensitively.
 *
 * Source files at the pin:
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/miscale/MiCompositionScaleDeviceSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/miscale/MiSmartScaleDeviceSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/onebyone/OneByoneScaleDeviceSupport.java
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/qnscale/QnScaleDeviceSupport.kt
 * - app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/{miscale,onebyone,qnscale}/
 *
 * Only three models have a capture implementation in this codebase:
 * `xiaomi_body_composition_scale_2`, `xiaomi_smart_scale_2` and
 * `lefu_health_scale`. The Chipsea QN, GE Fit Plus and Viatom F8 models are
 * registered so they are discoverable and can be bound, but their `records`
 * list is empty: connection checks only, no measurement capture yet. This is
 * deliberate and is surfaced verbatim by the settings screen.
 *
 * IMPORTANT: `transportValidated` is false for every model. Nothing in this
 * family has been validated against hardware or against a real device in this
 * codebase. This registry records which models the parsers are expected to
 * reach; it is not a support claim.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Record kinds this family can emit. */
export type BleScaleRecordType = "weight_measurement";

/** Stable upstream YAML ids for the six registered smart-scale models. */
export type BleScaleModelId =
  | "xiaomi_smart_scale_2"
  | "xiaomi_body_composition_scale_2"
  | "lefu_health_scale"
  | "chipsea_qn_scale"
  | "ge_fit_plus"
  | "viatom_f8";

export type BleScaleModel = Readonly<{
  /** Upstream YAML id. */
  id: BleScaleModelId;
  displayName: string;
  /**
   * Always false: no model in this family has source-level or hardware
   * validation in this codebase.
   */
  transportValidated: false;
  /**
   * Full-string advertised-name patterns, matched case-insensitively like
   * upstream `Matcher.matches()` with `Pattern.CASE_INSENSITIVE`.
   */
  bleNamePatterns: readonly RegExp[];
  /**
   * Services the upstream support subscribes to or writes. Empty for models
   * whose capture path is not implemented, so connection verification is
   * skipped rather than guessed.
   */
  serviceUuids: readonly string[];
  /** Record kinds the model's capture path can emit. Empty when unimplemented. */
  records: readonly BleScaleRecordType[];
  /** Upstream source files, relative to the app repo root. */
  sourceFiles: readonly string[];
}>;

const MISCALE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/miscale";
const ONEBYONE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/onebyone";
const QNSCALE_ROOT =
  "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/qnscale";

/** Bluetooth SIG Body Composition service (MIBFS). */
export const BODY_COMPOSITION_SERVICE_UUID = "0000181b-0000-1000-8000-00805f9b34fb";
/** Bluetooth SIG Weight Scale service (Mi Smart Scale 2). */
export const WEIGHT_SCALE_SERVICE_UUID = "0000181d-0000-1000-8000-00805f9b34fb";
/** Xiaomi vendor service used by both Mi scales. */
export const MI_SCALE_VENDOR_SERVICE_UUID = "00001530-0000-3512-2118-0009af100700";
/** 1byone/LeFu "Health Scale" vendor service. */
export const LEFU_SCALE_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";

/**
 * The six models, in upstream catalog order. Only the first three carry a
 * capture record type; the rest are discoverable but capture nothing.
 */
export const BLE_SCALE_MODELS: readonly BleScaleModel[] = [
  {
    id: "xiaomi_smart_scale_2",
    displayName: "Xiaomi Smart Scale 2",
    transportValidated: false,
    bleNamePatterns: [/^MI SCALE2$/i],
    serviceUuids: [WEIGHT_SCALE_SERVICE_UUID, MI_SCALE_VENDOR_SERVICE_UUID],
    records: ["weight_measurement"],
    sourceFiles: [`${MISCALE_ROOT}/MiSmartScaleDeviceSupport.java`],
  },
  {
    id: "xiaomi_body_composition_scale_2",
    displayName: "Xiaomi Body Composition Scale 2",
    transportValidated: false,
    bleNamePatterns: [/^(?:MIBCS|MIBFS)$/i],
    serviceUuids: [BODY_COMPOSITION_SERVICE_UUID, MI_SCALE_VENDOR_SERVICE_UUID],
    records: ["weight_measurement"],
    sourceFiles: [`${MISCALE_ROOT}/MiCompositionScaleDeviceSupport.java`],
  },
  {
    id: "lefu_health_scale",
    displayName: "Lefu Health Scale",
    transportValidated: false,
    bleNamePatterns: [/^Health Scale$/i],
    serviceUuids: [LEFU_SCALE_SERVICE_UUID],
    records: ["weight_measurement"],
    sourceFiles: [`${ONEBYONE_ROOT}/OneByoneScaleDeviceSupport.java`],
  },
  {
    id: "chipsea_qn_scale",
    displayName: "Chipsea QN Scale",
    transportValidated: false,
    bleNamePatterns: [/^QN-Scale.*$/i],
    // Capture is not implemented this round; no service is claimed.
    serviceUuids: [],
    records: [],
    sourceFiles: [`${QNSCALE_ROOT}/QnScaleDeviceSupport.kt`],
  },
  {
    id: "ge_fit_plus",
    displayName: "GE Fit Plus",
    transportValidated: false,
    bleNamePatterns: [/^Fit Plus$/i],
    // Capture is not implemented this round; no service is claimed.
    serviceUuids: [],
    records: [],
    sourceFiles: [],
  },
  {
    id: "viatom_f8",
    displayName: "Viatom F8",
    transportValidated: false,
    bleNamePatterns: [/^F8$/i],
    // Capture is not implemented this round; no service is claimed.
    serviceUuids: [],
    records: [],
    sourceFiles: [],
  },
];

const MODEL_BY_ID = new Map<BleScaleModelId, BleScaleModel>(
  BLE_SCALE_MODELS.map((model) => [model.id, model]),
);

/** Looks up a model by upstream id. */
export function getBleScaleModel(id: BleScaleModelId): BleScaleModel | undefined {
  return MODEL_BY_ID.get(id);
}

/**
 * Matches an advertised BLE name to a registered smart-scale model.
 *
 * Matching is name-only: upstream has no UUID fallback for this family (the
 * generic weight-scale coordinator is deliberately not ported). Patterns are
 * full-string and case-insensitive. Returns null when nothing matches.
 */
export function matchBleScaleDevice(name: string | null | undefined): BleScaleModel | null {
  if (!name) return null;
  for (const model of BLE_SCALE_MODELS) {
    if (model.bleNamePatterns.some((pattern) => pattern.test(name))) return model;
  }
  return null;
}
