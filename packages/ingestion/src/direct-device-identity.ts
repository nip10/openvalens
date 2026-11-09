import {
  findDirectDeviceModel,
  isDirectDeviceIdentity,
  type DirectDeviceFamily,
  type DirectDeviceIdentity,
} from "@openvalens/health-record/direct-device-models";

export type DirectDeviceBindingIdentity = {
  directDeviceFamily: string | null;
  directDeviceModelId: string | null;
};

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
  if (!(["zepp_os", "xiaomi", "huawei", "garmin"] as string[]).includes(binding.directDeviceFamily))
    throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  const identity = {
    family: binding.directDeviceFamily as DirectDeviceFamily,
    modelId: binding.directDeviceModelId,
  } as DirectDeviceIdentity;
  if (!findDirectDeviceModel(identity)) throw new DirectDeviceIdentityError("IDENTITY_REQUIRED");
  return identity;
}

/** Validate an optional legacy envelope assertion against the owned confirmed binding. */
export function assertDirectDeviceIdentity(
  binding: DirectDeviceBindingIdentity,
  asserted?: unknown,
  options: { requireStepsSupport?: boolean } = {},
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
  if (options.requireStepsSupport && !["zepp_os", "xiaomi"].includes(confirmed.family))
    throw new DirectDeviceIdentityError("HISTORY_UNSUPPORTED");
  return confirmed;
}
