import {
  DIRECT_DEVICE_FAMILIES,
  findDirectDeviceModel,
  isDirectDeviceIdentity,
  type DirectDeviceFamily,
  type DirectDeviceIdentity,
} from "@openvalens/health-record/direct-device-models";

export type DirectDeviceBindingIdentity = {
  directDeviceFamily: string | null;
  directDeviceModelId: string | null;
};

/**
 * Record types a direct-device binding can publish. Steps are watch-family
 * history; the GATT sensor metrics come from BLE peripherals; smart scales
 * publish weight and optional body-composition measurements; smart rings
 * publish arbitrary-interval steps and sleep sessions; Bangle.js watches
 * publish 10-minute activity buckets plus heart rate; GloryFit-protocol
 * watches publish hourly steps, 10-minute heart-rate blocks and sleep
 * sessions with stages. Legacy Huami devices (pre-Zepp-OS Amazfit/Mi Band)
 * publish per-minute activity samples, i.e. exact-minute steps and heart
 * rate, plus sleep derived from activity kinds 9/11; authentication uses a
 * user-entered 16-byte pre-shared key. Moyoung watches publish heart-rate
 * history and sleep sessions; their steps arrive as a single daily total, which
 * the exact-minute `steps` record type cannot represent, so steps are
 * deliberately not mapped in v1. FitPro bands and watches publish 15-minute
 * step buckets, sleep sessions built from stage-start records and realtime
 * heart rate; the realtime stream reports overlapping offsets, so consecutive
 * samples may share a timestamp and the ingest contract tolerates that. FitPro
 * pairing needs no authentication. Huawei/Honor devices publish per-minute step
 * samples with feature bitmaps (steps and heart rate inline) and sleep sessions
 * derived from 0x0D records. This capability is family-level: only the
 * BLE-transport Huawei models can sync history, while the BT-Classic (BR) models
 * stay connection-only and are refused by the native registry before a batch is
 * ever created. Garmin devices publish FIT files pulled over GFDI: FIT
 * monitoring samples are per-minute, so exact-minute `steps` and `heart_rate`
 * are mapped, and sleep sessions come from the same FIT files. As with Huawei,
 * the capability is family-level: only BLE-transport Garmin models can sync
 * history; any Bluetooth-Classic/RFCOMM model stays connection-only and is
 * gated by the native registry before a batch is ever created.
 */
export type DirectDeviceRecordType =
  | "steps"
  | "steps_interval"
  | "sleep_session"
  | "heart_rate"
  | "body_temperature"
  | "blood_pressure"
  | "weight_measurement";

export class DirectDeviceIdentityError extends Error {
  constructor(
    public readonly reason: "IDENTITY_REQUIRED" | "IDENTITY_MISMATCH" | "HISTORY_UNSUPPORTED",
  ) {
    super(reason);
    this.name = "DirectDeviceIdentityError";
  }
}

/** Resolve a persisted binding only when its stored family/model pair is catalog-valid. */
export function confirmedDirectDeviceIdentity(
  binding: DirectDeviceBindingIdentity,
): DirectDeviceIdentity {
  if (!binding.directDeviceFamily || !binding.directDeviceModelId)
    throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  if (!(DIRECT_DEVICE_FAMILIES as readonly string[]).includes(binding.directDeviceFamily))
    throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  const identity = {
    family: binding.directDeviceFamily as DirectDeviceFamily,
    modelId: binding.directDeviceModelId,
  } as DirectDeviceIdentity;
  if (!findDirectDeviceModel(identity)) throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  return identity;
}

/** Whether a device family can publish a given record type. */
export function directDeviceFamilySupportsRecordType(
  family: DirectDeviceFamily,
  recordType: DirectDeviceRecordType,
): boolean {
  if (recordType === "steps")
    return (
      family === "zepp_os" ||
      family === "xiaomi" ||
      family === "huami_legacy" ||
      family === "huawei" ||
      family === "garmin"
    );
  if (recordType === "steps_interval")
    return (
      family === "colmi_ring" ||
      family === "bangle_js" ||
      family === "gloryfit" ||
      family === "fitpro"
    );
  if (recordType === "sleep_session")
    return (
      family === "colmi_ring" ||
      family === "gloryfit" ||
      family === "fitpro" ||
      family === "huami_legacy" ||
      family === "moyoung" ||
      family === "huawei" ||
      family === "garmin"
    );
  if (recordType === "weight_measurement") return family === "ble_scale";
  if (recordType === "heart_rate")
    return (
      family === "ble_gatt" ||
      family === "colmi_ring" ||
      family === "bangle_js" ||
      family === "gloryfit" ||
      family === "fitpro" ||
      family === "huami_legacy" ||
      family === "moyoung" ||
      family === "huawei" ||
      family === "garmin"
    );
  return family === "ble_gatt";
}

/** Validate an optional legacy envelope assertion against the owned confirmed binding. */
export function assertDirectDeviceIdentity(
  binding: DirectDeviceBindingIdentity,
  asserted?: unknown,
  options: { recordType?: DirectDeviceRecordType } = {},
): DirectDeviceIdentity {
  const confirmed = confirmedDirectDeviceIdentity(binding);
  if (asserted === undefined || asserted === null)
    throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  if (
    !isDirectDeviceIdentity(asserted) ||
    asserted.family !== confirmed.family ||
    asserted.modelId !== confirmed.modelId
  )
    throw new DirectDeviceIdentityError("IDENTITY_MISMATCH");
  if (
    options.recordType &&
    !directDeviceFamilySupportsRecordType(confirmed.family, options.recordType)
  )
    throw new DirectDeviceIdentityError("HISTORY_UNSUPPORTED");
  return confirmed;
}
