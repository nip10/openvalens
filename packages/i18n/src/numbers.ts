/**
 * Reading numbers members type (#448).
 *
 * The decimal keypad on iOS and Android shows `,` in regions such as Portugal,
 * and some browsers pass a comma straight through `inputMode="decimal"`, so a
 * plain `Number("82,4")` is `NaN`. Every form parser that reads a typed
 * decimal goes through {@link parseDecimal} instead.
 */

/** Optional minus, digits with at most one `.` or `,`, or a bare fraction (`,5`). */
const DECIMAL = /^-?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
/** "2,000" or "1.250": one separator after 1–3 digits, then exactly 3 digits. */
const GROUP_SHAPED = /^-?[1-9]\d{0,2}[.,]\d{3}$/;

const decimalSeparators = new Map<string, string | null>();

function decimalSeparatorOf(locale: string): string | null {
  if (decimalSeparators.has(locale)) return decimalSeparators.get(locale) ?? null;
  let separator: string | null = null;
  try {
    separator =
      new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === "decimal")
        ?.value ?? null;
  } catch {
    separator = null;
  }
  decimalSeparators.set(locale, separator);
  return separator;
}

/**
 * Parses a typed decimal. `.` and `,` both work as the decimal separator, so
 * `"82,4"`, `"82.4"` and `" 82,4 "` are all 82.4. Returns `null` for blank or
 * invalid text; callers decide what blank means.
 *
 * Grouping separators are never accepted, and input is refused rather than
 * guessed: `"1,234.5"`, `"1.234,5"` and `"1.234.567"` are `null`, as are
 * exponents, hex and `Infinity`, which `Number()` would take.
 *
 * One separator followed by exactly three digits (`"2,000"`, `"1.250"`) is a
 * thousands group in some regions and a decimal in others. Without `locale` it
 * is refused. With a BCP 47 `locale` it is a decimal when the separator is
 * that locale's decimal separator (`"1,250"` in `pt-PT` is 1.25) and refused
 * otherwise (`"2,000"` in `en`).
 */
export function parseDecimal(raw: string, locale?: string): number | null {
  const text = raw.trim();
  if (!DECIMAL.test(text)) return null;
  if (GROUP_SHAPED.test(text)) {
    const separator = text.includes(",") ? "," : ".";
    if (!locale || decimalSeparatorOf(locale) !== separator) return null;
  }
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}
