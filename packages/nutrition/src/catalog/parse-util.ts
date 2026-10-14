/** Small, total helpers for reading untrusted upstream JSON. */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Trimmed non-empty text; numbers are accepted as their decimal string. */
export function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

/** A finite, non-negative number (numeric strings accepted), else `null`. */
export function nonNegativeNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Digits-only GTIN/EAN/UPC (8–14 digits), else `null`. Never throws. */
export function gtinOrNull(value: unknown): string | null {
  const digits = asText(value)?.replace(/[\s-]/g, "");
  return digits && /^\d{8,14}$/.test(digits) ? digits : null;
}

const MASS_IN_G: Readonly<Record<string, number>> = { g: 1, mg: 1e-3, µg: 1e-6, ug: 1e-6 };

/** Converts between mass units only; returns `null` for any other unit. */
export function scaleUnit(amount: number, from: string, to: "g" | "mg"): number | null {
  const factor = MASS_IN_G[from];
  if (factor === undefined) return null;
  return roundTo12(amount * (factor / MASS_IN_G[to]!));
}

/** Removes binary floating-point noise from unit conversions (e.g. 0.4 g → 400 mg). */
export function roundTo12(value: number): number {
  return Number(value.toPrecision(12));
}
