/**
 * Pain entry labels (Issue #442) without the body-map artwork: region names,
 * pain types and the rating text. Quick logging (#440) and the one-liners
 * use these in the app shell, so they must not pull in the figure's path
 * data. `presenters/pain` and `presenters/body-map` re-export them, and a
 * test keeps the region names equal to the map's own labels.
 *
 * A pain entry is a record of what the member rated. Nothing here changes
 * with the value: a 9 reads the same way as a 2, number aside.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
  PAIN_RATING_MAX,
  PAIN_TYPES,
  type PainJointRegion,
  type PainType,
} from "@openvalens/pain/model";

/** The pain-only joint spots, drawn on the pain layer only. */
export const PAIN_JOINT_LABELS: Readonly<Record<PainJointRegion, MessageDescriptor>> =
  Object.freeze({
    "joint.neck": msg`Neck`,
    "joint.jaw_left": msg`Left jaw`,
    "joint.jaw_right": msg`Right jaw`,
    "joint.elbow_left": msg`Left elbow`,
    "joint.elbow_right": msg`Right elbow`,
    "joint.wrist_hand_left": msg`Left wrist and hand`,
    "joint.wrist_hand_right": msg`Right wrist and hand`,
    "joint.hip_left": msg`Left hip`,
    "joint.hip_right": msg`Right hip`,
    "joint.knee_left": msg`Left knee`,
    "joint.knee_right": msg`Right knee`,
    "joint.ankle_foot_left": msg`Left ankle and foot`,
    "joint.ankle_foot_right": msg`Right ankle and foot`,
  });

/** The body-map regions' names, the same messages the map's regions use. */
const PAIN_MAP_REGION_LABELS: Readonly<Record<string, MessageDescriptor>> = Object.freeze({
  "front.head": msg`Head (front)`,
  "front.shoulder_right": msg`Right shoulder (front)`,
  "front.shoulder_left": msg`Left shoulder (front)`,
  "front.chest_right": msg`Right chest (front)`,
  "front.chest_left": msg`Left chest (front)`,
  "front.biceps_right": msg`Right upper arm (front)`,
  "front.biceps_left": msg`Left upper arm (front)`,
  "front.forearm_right": msg`Right forearm (front)`,
  "front.forearm_left": msg`Left forearm (front)`,
  "front.abs_right": msg`Right abdomen (front)`,
  "front.abs_left": msg`Left abdomen (front)`,
  "front.obliques_right": msg`Right side (front)`,
  "front.obliques_left": msg`Left side (front)`,
  "front.pelvis": msg`Hips (front)`,
  "front.thigh_right": msg`Right thigh (front)`,
  "front.thigh_left": msg`Left thigh (front)`,
  "front.shin_right": msg`Right lower leg (front)`,
  "front.shin_left": msg`Left lower leg (front)`,
  "back.head": msg`Head (back)`,
  "back.traps": msg`Upper back and neck (back)`,
  "back.shoulder_left": msg`Left shoulder (back)`,
  "back.shoulder_right": msg`Right shoulder (back)`,
  "back.upper_back_left": msg`Left upper back (back)`,
  "back.upper_back_right": msg`Right upper back (back)`,
  "back.triceps_left": msg`Left upper arm (back)`,
  "back.triceps_right": msg`Right upper arm (back)`,
  "back.forearm_left": msg`Left forearm (back)`,
  "back.forearm_right": msg`Right forearm (back)`,
  "back.lower_back_left": msg`Left lower back (back)`,
  "back.lower_back_right": msg`Right lower back (back)`,
  "back.glutes_left": msg`Left glute (back)`,
  "back.glutes_right": msg`Right glute (back)`,
  "back.hamstrings_left": msg`Left back of thigh (back)`,
  "back.hamstrings_right": msg`Right back of thigh (back)`,
  "back.calf_left": msg`Left calf (back)`,
  "back.calf_right": msg`Right calf (back)`,
});

/** Every region a pain entry may name: the map regions and the joint spots. */
export const PAIN_REGION_LABELS: Readonly<Record<string, MessageDescriptor>> = Object.freeze({
  ...PAIN_MAP_REGION_LABELS,
  ...PAIN_JOINT_LABELS,
});

/** The localized region name, or null for a region this app does not know. */
export function painRegionEntryLabel(id: string): MessageDescriptor | null {
  return Object.hasOwn(PAIN_REGION_LABELS, id) ? PAIN_REGION_LABELS[id]! : null;
}

export const PAIN_TYPE_LABELS: Readonly<Record<PainType, MessageDescriptor>> = Object.freeze({
  ache: msg({ message: "Ache", context: "pain type" }),
  sharp: msg({ message: "Sharp", context: "pain type" }),
  burning: msg({ message: "Burning", context: "pain type" }),
  throbbing: msg({ message: "Throbbing", context: "pain type" }),
  stiffness: msg({ message: "Stiffness", context: "pain type" }),
  tingling: msg({ message: "Tingling", context: "pain type" }),
});

export const PAIN_TYPE_OPTIONS: readonly PainType[] = PAIN_TYPES;

export function painTypeLabel(type: string | null | undefined): MessageDescriptor | null {
  return type && Object.hasOwn(PAIN_TYPE_LABELS, type) ? PAIN_TYPE_LABELS[type as PainType] : null;
}

/** "4 of 10". */
export function painRatingText(rating: number, i18n: I18n): string {
  const max = PAIN_RATING_MAX;
  return i18n._(msg`${rating} of ${max}`);
}

/** "4 of 10 · Ache". */
export function painEntrySummary(entry: { rating: number; type: string | null }, i18n: I18n) {
  const rating = painRatingText(entry.rating, i18n);
  const type = painTypeLabel(entry.type);
  return type ? `${rating} · ${i18n._(type)}` : rating;
}
