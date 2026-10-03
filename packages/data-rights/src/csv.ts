/**
 * RFC 4180 CSV for export files. Columns are the union of row keys in first-
 * seen order. Dates become ISO strings, objects become JSON. Text cells that a
 * spreadsheet would evaluate as a formula (leading = + - @ tab or CR) are
 * prefixed with an apostrophe (OWASP CSV injection guidance); numbers are
 * left alone so negative values stay numeric.
 */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const lines = [columns.map(escapeCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => formatCell(row[column])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return escapeCell(value.toISOString());
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value);
  if (typeof value === "object") return escapeCell(JSON.stringify(value));
  const text = String(value);
  return escapeCell(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text);
}

function escapeCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
