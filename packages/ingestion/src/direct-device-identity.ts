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
 * publish weight and optional body-composition measurements.
 */
export type DirectDeviceRecordType =
  | "steps"
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
  if (recordType === "steps") return family === "zepp_os" || family === "xiaomi";
  if (recordType === "weight_measurement") return family === "ble_scale";
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
