/**
 * Clinical records presentation shared by web and mobile (Issue #24).
 * Pure TypeScript, no imports — safe for the app bundle. Formatting for
 * cardiac exams, imaging studies, and family history rows.
 */

export type CardiacExamLike = {
  id: number;
  date: string;
  facility: string | null;
  indication: string | null;
  conclusion: string | null;
};

export type ImagingStudyLike = {
  id: number;
  date: string;
  type: string;
  bodyPart: string | null;
  facility: string | null;
  conclusion: string | null;
};

export type FamilyHistoryEntryLike = {
  id: number;
  relation: string;
  condition: string;
  onsetYear: number | null;
  notes: string | null;
};

/** "Echo" / "Stress" / "Other" — sentence case, falls back to raw value. */
export function cardiacExamTypeLabel(value: string | null | undefined): string {
  if (!value) return "Exam";
  return value
    .split(/[_\s-]+/)
    .map((word) => (word.length === 0 ? "" : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

/** "MRI" / "X-ray" / "Ultrasound" — sentence case. */
export function imagingTypeLabel(value: string): string {
  if (!value) return "Imaging";
  const tokens = value.split(/[_\s-]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "Imaging";
  const first = tokens[0]!.toLowerCase();
  if (first === "mri" || first === "ct") {
    const rest = tokens
      .slice(1)
      .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
    return rest ? `${tokens[0]!.toUpperCase()} ${rest}` : tokens[0]!.toUpperCase();
  }
  if (first === "x" && tokens[1]?.toLowerCase() === "ray") {
    const rest = tokens
      .slice(2)
      .map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
    return rest ? `X-ray ${rest}` : "X-ray";
  }
  return tokens.map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

/** "Mother", "Father", "Sibling" — sentence case. */
export function familyRelationLabel(value: string): string {
  if (!value) return "Relation";
  return value
    .split(/[_\s-]+/)
    .map((word) => (word.length === 0 ? "" : word[0]?.toUpperCase() + word.slice(1)))
    .join(" ");
}

/** "—" for null, otherwise the year as a 4-digit string. */
export function formatYear(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return String(Math.trunc(value));
}

/** "—" for empty, otherwise the trimmed value, capped at N chars with ellipsis. */
export function summaryText(value: string | null | undefined, max = 140): string {
  if (!value) return "—";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "—";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
