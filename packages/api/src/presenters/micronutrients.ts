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

export const MICRONUTRIENT_LABELS: Readonly<Record<MicronutrientKey, string>> = Object.freeze({
  calciumMg: "Calcium",
  ironMg: "Iron",
  magnesiumMg: "Magnesium",
  potassiumMg: "Potassium",
  zincMg: "Zinc",
  vitaminCMg: "Vitamin C",
  vitaminDUg: "Vitamin D",
  vitaminB12Ug: "Vitamin B12",
});

/** Official reference names (EFSA, NASEM), kept verbatim even where the copy lint would object. */
export const REFERENCE_TYPE_LABELS: Readonly<Record<MicronutrientReferenceType, string>> =
  Object.freeze({
    efsa_pri: "Population reference intake (PRI)",
    efsa_ai: "Adequate intake (AI)",
    efsa_ul: "Tolerable upper intake level (UL)",
    efsa_safe_level: "Safe level of intake",
    nasem_rda: "Recommended dietary allowance (RDA)",
    nasem_ai: "Adequate intake (AI)",
    nasem_ul: "Tolerable upper intake level (UL)",
  });

export const MICRONUTRIENT_COPY = Object.freeze({
  settingLabel: "Show a micronutrient summary",
  settingDescription:
    "Off by default. Shows eight vitamins and minerals from the foods you log, with how many foods reported each one. Many foods, especially from labels, don't report them, so totals are often incomplete. Turn it off at any time.",
  intro:
    "Vitamins and minerals from the foods you logged that day. Foods that don't report a value are counted as unknown, never as zero.",
  sourceLabel: "Reference values",
  sourceHelp:
    "EFSA is the usual choice in the EU, EEA and UK; NASEM in the United States. Pick the group that fits you; nothing is applied until you save.",
  sources: {
    efsa: "EFSA (European Food Safety Authority)",
    nasem: "NASEM (US National Academies)",
  },
  proposal: "Suggested from your profile",
  noReference: "No reference values chosen. Choose them in nutrition settings to see them here.",
  adultsOnly: "Reference values here are for adults only, so they are not shown.",
  hidden:
    "The micronutrient summary is hidden because of an answer in your nutrition settings. Logging is not affected.",
  off: "The micronutrient summary is off. Turn it on in nutrition settings.",
  intakeExplainer:
    "A PRI or RDA covers the needs of nearly all people in the group; your own needs may be lower. An adequate intake (AI) is used when there is too little evidence for that; it is not a cutoff for deficiency. An upper level is not a goal.",
  incomplete: "Not every food reported this, so the amount is at least this much.",
  notCompared: "Not compared: not every food reported this.",
  supplementsOnly: "Applies to supplements only, not food.",
  notAdvice:
    "General information from your own logs, not a diagnosis or medical advice. Ask a health professional before changing your diet or taking supplements.",
});

export function formatMicronutrientAmount(nutrient: MicronutrientKey, amount: number): string {
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${Number(amount.toFixed(digits))} ${MICRONUTRIENT_UNITS[nutrient]}`;
}

export function describeReference(
  nutrient: MicronutrientKey,
  reference: MicronutrientSummaryWire["rows"][number]["references"][number],
): string {
  const unit = MICRONUTRIENT_UNITS[nutrient];
  const value =
    reference.valueMax === null
      ? `${reference.value} ${unit}`
      : `${reference.value} to ${reference.valueMax} ${unit}`;
  const parts = [`${REFERENCE_TYPE_LABELS[reference.type]}: ${value} a day`];
  if (reference.appliesTo === "supplements") parts.push(MICRONUTRIENT_COPY.supplementsOnly);
  if (reference.note) parts.push(reference.note);
  return parts.join(". ");
}

export function coverageText(row: { knownEntries: number; totalEntries: number }): string {
  if (row.totalEntries === 0) return "Nothing logged";
  return `${row.knownEntries} of ${row.totalEntries} ${row.totalEntries === 1 ? "food" : "foods"} reported this`;
}
