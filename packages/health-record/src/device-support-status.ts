/**
 * Public support status of every direct-device model (Issue #445).
 *
 * The landing site's supported-devices page (`apps/site`, `/devices`) is
 * generated from {@link DIRECT_DEVICE_MODELS} and this module at build time.
 * It is kept apart from `direct-device-models.ts` on purpose: that file is the
 * registration allowlist the native lane edits, this one says how far each
 * model is proven. The native settings screen has its own, more detailed
 * per-family status (`apps/native/lib/direct-devices/support-status.ts`).
 *
 * The three statuses, from strongest to weakest:
 *
 *  - `tested`: someone synced records from this model to OpenValens on real
 *    hardware. Only the owner marks a model as tested (below).
 *  - `works_in_testing`: the family's protocol passes the automated tests in
 *    this repository, but nobody has tried this model on a real device yet.
 *    Every family has protocol tests, so this is the default.
 *  - `experimental`: the code or its comments say the model or its family is
 *    not proven, or no records sync from it yet. Each one carries a reason.
 *
 * Resolution order: an entry in {@link DEVICE_SUPPORT_EXCEPTIONS}, then
 * {@link EXPERIMENTAL_FAMILIES}, then Gadgetbridge's own `experimental` flag
 * (the protocol work is ported from Gadgetbridge, so a model it calls
 * experimental is not more proven here), then
 * {@link DEFAULT_DEVICE_SUPPORT_STATUS}.
 *
 * How the owner marks a model as tested on a device: add its `modelId` to
 * {@link DEVICE_SUPPORT_EXCEPTIONS} as `{ status: "tested" }`, with a comment
 * that says when, on which firmware, and which records synced. If the model
 * already has an `experimental` entry, replace it (TypeScript refuses a
 * duplicate key). The next site build shows it as "Tested on a device". Only
 * once models are tested may the site headline give a count, and then only of
 * tested models.
 */
import { isGadgetbridgeExperimental } from "./device-catalog";
import {
  DIRECT_DEVICE_MODELS,
  type DirectDeviceFamily,
  type DirectDeviceIdentity,
} from "./direct-device-models";

export const DEVICE_SUPPORT_STATUSES = ["tested", "works_in_testing", "experimental"] as const;
export type DeviceSupportStatus = (typeof DEVICE_SUPPORT_STATUSES)[number];

/** Why a model is experimental; the site turns each into a short note. */
export type ExperimentalReason =
  /** Registered for connection checks only, or no transport is implemented: no records sync. */
  | "no_records_yet"
  /** Gadgetbridge, whose protocol work OpenValens ports, marks the model experimental. */
  | "upstream_experimental"
  /** The family's capture path is new; the code gated it until it was made safe. */
  | "new_capture_path";

export type DeviceSupport =
  | Readonly<{ status: "tested" }>
  | Readonly<{ status: "works_in_testing" }>
  | Readonly<{ status: "experimental"; reason: ExperimentalReason }>;

export const DEFAULT_DEVICE_SUPPORT_STATUS = "works_in_testing" satisfies DeviceSupportStatus;

/**
 * Families the code marks as not yet proven as a whole. Pebble capture was
 * gated as unsafe (`fix(pebble): gate unsafe capture`) and only re-enabled
 * through the durable inbox for three models, with known limitations.
 */
export const EXPERIMENTAL_FAMILIES: Readonly<
  Partial<Record<DirectDeviceFamily, ExperimentalReason>>
> = { pebble: "new_capture_path" };

const NO_RECORDS = { status: "experimental", reason: "no_records_yet" } as const;

/**
 * Per-model exceptions, keyed by `modelId`. No model is `tested` yet: the
 * owner has not provided the hardware-tested list.
 *
 * The `no_records_yet` rows mirror the native registries, where these models
 * have no sync capability (`apps/native/lib/direct-devices/models/*`); a native
 * test fails if a model without a data path is missing here.
 */
export const DEVICE_SUPPORT_EXCEPTIONS: Readonly<Record<string, DeviceSupport>> = {
  // The one model with source-level transport validation in the native
  // registry (`transportValidated: true`), although Gadgetbridge flags it
  // experimental. Still not tried on hardware.
  amazfit_helio_strap: { status: "works_in_testing" },

  // Huawei/Honor watches that talk Bluetooth Classic: connection checks only.
  honor_magicwatch_2: NO_RECORDS,
  honor_watch_4: NO_RECORDS,
  honor_watch_4_pro: NO_RECORDS,
  honor_watch_5: NO_RECORDS,
  honor_watch_5_pro: NO_RECORDS,
  honor_watch_6: NO_RECORDS,
  honor_watch_gs_3: NO_RECORDS,
  honor_watch_gs_pro: NO_RECORDS,
  huawei_talk_band_b6: NO_RECORDS,
  huawei_watch_3: NO_RECORDS,
  huawei_watch_3_pro: NO_RECORDS,
  huawei_watch_4: NO_RECORDS,
  huawei_watch_4_pro: NO_RECORDS,
  huawei_watch_5: NO_RECORDS,
  huawei_watch_6: NO_RECORDS,
  huawei_watch_6_pro: NO_RECORDS,
  huawei_watch_d2: NO_RECORDS,
  huawei_watch_d3: NO_RECORDS,
  huawei_watch_gt_2: NO_RECORDS,
  huawei_watch_gt_2_pro: NO_RECORDS,
  huawei_watch_gt_3: NO_RECORDS,
  huawei_watch_gt_3_pro: NO_RECORDS,
  huawei_watch_gt_3_se: NO_RECORDS,
  huawei_watch_gt_4: NO_RECORDS,
  huawei_watch_gt_5: NO_RECORDS,
  huawei_watch_gt_5_pro: NO_RECORDS,
  huawei_watch_gt_6: NO_RECORDS,
  huawei_watch_gt_6_pro: NO_RECORDS,
  huawei_watch_gt_7: NO_RECORDS,
  huawei_watch_gt_7_pro: NO_RECORDS,
  huawei_watch_gt_cyber: NO_RECORDS,
  huawei_watch_gt_runner: NO_RECORDS,
  huawei_watch_gt_runner_2: NO_RECORDS,
  huawei_watch_fit_2: NO_RECORDS,
  huawei_watch_fit_3: NO_RECORDS,
  huawei_watch_fit_4: NO_RECORDS,
  huawei_watch_fit_4_pro: NO_RECORDS,
  huawei_watch_fit_5: NO_RECORDS,
  huawei_watch_fit_5_pro: NO_RECORDS,
  huawei_watch_ultimate: NO_RECORDS,
  huawei_watch_ultimate_2: NO_RECORDS,

  // Garmin navigators and chest straps: connection checks only.
  garmin_etrex_se: NO_RECORDS,
  garmin_gpsmap_66s: NO_RECORDS,
  garmin_gpsmap_66sr: NO_RECORDS,
  garmin_gpsmap_66i: NO_RECORDS,
  garmin_gpsmap_h1: NO_RECORDS,
  garmin_hrm_200: NO_RECORDS,
  garmin_hrm_600: NO_RECORDS,
  garmin_hrm_pro_plus: NO_RECORDS,
  garmin_inreach_mini_2: NO_RECORDS,

  // Smart scales without a weight capture path: connection checks only.
  chipsea_qn_scale: NO_RECORDS,
  ge_fit_plus: NO_RECORDS,
  viatom_f8: NO_RECORDS,

  // Casio watches without a step-history path: connection checks only.
  "casio_ecb-s100": NO_RECORDS,
  "casio_gb-5600b": NO_RECORDS,
  "casio_gb-x6900b": NO_RECORDS,
  "casio_gb-6900b": NO_RECORDS,
  "casio_stb-1000": NO_RECORDS,
  "casio_gw-b5600": NO_RECORDS,
  "casio_gmw-b5000": NO_RECORDS,

  // Pebble models on Bluetooth Classic, which is not implemented, or without
  // built-in health data.
  pebble_classic: NO_RECORDS,
  pebble_steel: NO_RECORDS,
  pebble_time: NO_RECORDS,
  pebble_time_steel: NO_RECORDS,
  pebble_time_round: NO_RECORDS,
};

/** The public support status of one registered model. */
export function deviceSupport(identity: DirectDeviceIdentity): DeviceSupport {
  if (Object.hasOwn(DEVICE_SUPPORT_EXCEPTIONS, identity.modelId)) {
    return DEVICE_SUPPORT_EXCEPTIONS[identity.modelId]!;
  }
  const familyReason = EXPERIMENTAL_FAMILIES[identity.family];
  if (familyReason) return { status: "experimental", reason: familyReason };
  if (isGadgetbridgeExperimental(identity.modelId)) {
    return { status: "experimental", reason: "upstream_experimental" };
  }
  return { status: DEFAULT_DEVICE_SUPPORT_STATUS };
}

/** Every registered model with its status, in allowlist order. */
export function directDeviceSupportList() {
  return DIRECT_DEVICE_MODELS.map((model) => ({ ...model, support: deviceSupport(model) }));
}
