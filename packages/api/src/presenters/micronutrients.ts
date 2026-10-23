import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { MICRONUTRIENT_UNITS, type MicronutrientKey } from "@openvalens/nutrition/micronutrients";
import {
  MICRONUTRIENT_POPULATIONS,
  MICRONUTRIENT_REFERENCE_DATASET,
  type MicronutrientReferenceType,
} from "@openvalens/nutrition/micronutrient-references";

import type { MicronutrientSummaryWire } from "../contracts/nutrition-micronutrients";

/**
 * Client-safe copy for the micronutrient summary (Issue #78), shared by web
 * and native. The pure summary function is re-exported so a cached day can
 * be summarized on the device with the same dataset version.
 */
export { MICRONUTRIENT_POPULATIONS, MICRONUTRIENT_REFERENCE_DATASET, MICRONUTRIENT_UNITS };
export { summarizeMicronutrients } from "@openvalens/nutrition/micronutrient-summary";

export const MICRONUTRIENT_LABELS: Readonly<Record<MicronutrientKey, MessageDescriptor>> =
  Object.freeze({
    calciumMg: msg`Calcium`,
    ironMg: msg`Iron`,
    magnesiumMg: msg`Magnesium`,
    potassiumMg: msg`Potassium`,
    zincMg: msg`Zinc`,
    vitaminCMg: msg`Vitamin C`,
    vitaminDUg: msg`Vitamin D`,
    vitaminB12Ug: msg`Vitamin B12`,
  });

/** Official reference names (EFSA, NASEM), kept verbatim even where the copy lint would object. */
export const REFERENCE_TYPE_LABELS: Readonly<
  Record<MicronutrientReferenceType, MessageDescriptor>
> = Object.freeze({
  efsa_pri: msg({ message: "Population reference intake (PRI)", comment: "safety" }),
  efsa_ai: msg({ message: "Adequate intake (AI)", comment: "safety" }),
  efsa_ul: msg({ message: "Tolerable upper intake level (UL)", comment: "safety" }),
  efsa_safe_level: msg({ message: "Safe level of intake", comment: "safety" }),
  nasem_rda: msg({ message: "Recommended dietary allowance (RDA)", comment: "safety" }),
  nasem_ai: msg({ message: "Adequate intake (AI)", comment: "safety" }),
  nasem_ul: msg({ message: "Tolerable upper intake level (UL)", comment: "safety" }),
});

export const MICRONUTRIENT_COPY = Object.freeze({
  settingLabel: msg`Show a micronutrient summary`,
  settingDescription: msg({
    message:
      "Off by default. Shows eight vitamins and minerals from the foods you log, with how many foods reported each one. Many foods, especially from labels, don't report them, so totals are often incomplete. Turn it off at any time.",
    comment: "safety",
  }),
  intro: msg`Vitamins and minerals from the foods you logged that day. Foods that don't report a value are counted as unknown, never as zero.`,
  sourceLabel: msg`Reference values`,
  sourceHelp: msg`EFSA is the usual choice in the EU, EEA and UK; NASEM in the United States. Pick the group that fits you; nothing is applied until you save.`,
  sources: {
    efsa: msg`EFSA (European Food Safety Authority)`,
    nasem: msg`NASEM (US National Academies)`,
  },
  proposal: msg`Suggested from your profile`,
  noReference: msg`No reference values chosen. Choose them in nutrition settings to see them here.`,
  adultsOnly: msg`Reference values here are for adults only, so they are not shown.`,
  hidden: msg`The micronutrient summary is hidden because of an answer in your nutrition settings. Logging is not affected.`,
  off: msg`The micronutrient summary is off. Turn it on in nutrition settings.`,
  intakeExplainer: msg({
    message:
      "A PRI or RDA covers the needs of nearly all people in the group; your own needs may be lower. An adequate intake (AI) is used when there is too little evidence for that; it is not a cutoff for deficiency. An upper level is not a goal.",
    comment: "safety",
  }),
  incomplete: msg`Not every food reported this, so the amount is at least this much.`,
  notCompared: msg`Not compared: not every food reported this.`,
  supplementsOnly: msg({ message: "Applies to supplements only, not food.", comment: "safety" }),
  notAdvice: msg({
    message:
      "General information from your own logs, not a diagnosis or medical advice. Ask a health professional before changing your diet or taking supplements.",
    comment: "safety",
  }),
});

export function formatMicronutrientAmount(nutrient: MicronutrientKey, amount: number): string {
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${Number(amount.toFixed(digits))} ${MICRONUTRIENT_UNITS[nutrient]}`;
}

export function describeReference(
  nutrient: MicronutrientKey,
  reference: MicronutrientSummaryWire["rows"][number]["references"][number],
  i18n: I18n,
): string {
  const unit = MICRONUTRIENT_UNITS[nutrient];
  const type = i18n._(REFERENCE_TYPE_LABELS[reference.type]);
  const amount = reference.value;
  const max = reference.valueMax;
  const parts = [
    max === null
      ? i18n._(msg({ message: `${type}: ${amount} ${unit} a day`, comment: "safety" }))
      : i18n._(msg({ message: `${type}: ${amount} to ${max} ${unit} a day`, comment: "safety" })),
  ];
  if (reference.appliesTo === "supplements") parts.push(i18n._(MICRONUTRIENT_COPY.supplementsOnly));
  if (reference.note) parts.push(reference.note);
  return parts.join(". ");
}

export function coverageText(row: {
  knownEntries: number;
  totalEntries: number;
}): MessageDescriptor {
  if (row.totalEntries === 0) return msg`Nothing logged`;
  const known = row.knownEntries;
  return msg`${known} of ${plural(row.totalEntries, { one: "# food", other: "# foods" })} reported this`;
}
