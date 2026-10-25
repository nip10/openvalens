// Source: anchovy/apps/web/src/lib/export/render-pdf.ts (verbatim port).
// PDF ("HTML export") renderer for the legacy export pipeline. Mirrors the
// source's per-domain section ordering, system font stack, page-break-inside
// CSS, "No records" / "No data" empty states, depth-capped stable JSON
// serialization, HTML escaping, and filename pattern `health-export-YYYY-MM-DD.html`.
//
// The attachment ships with `content-type: text/html`; the spec explicitly
// forbids introducing a PDF library.
import type { ExportDomain } from "./domains";
import type { ExportPayload } from "./types";

export type PdfExportRenderResult = {
  fileName: string;
  html: string;
  contentTypeHint: "text/html";
};

const DOMAIN_LABELS: Record<ExportDomain, string> = {
  blood: "Blood",
  body: "Body",
  medications: "Medications",
  supplements: "Supplements",
  workouts: "Workouts",
  goals: "Goals",
  familyHistory: "Family History",
  calendar: "Calendar",
  insights: "Insights",
  imaging: "Imaging",
  cardiac: "Cardiac",
  dexa: "DEXA",
  weight: "Weight",
  audit: "Audit",
};

const MAX_STABLE_JSON_DEPTH = 20;

export function renderPdfExport(payload: ExportPayload): PdfExportRenderResult {
  const html = renderDocument(payload);

  return {
    fileName: `health-export-${getExportDate(payload.generatedAt)}.html`,
    html,
    contentTypeHint: "text/html",
  };
}

function renderDocument(payload: ExportPayload): string {
  const sectionOrder = [...payload.selectedDomains];
  const selectedDomainLabels = sectionOrder.map((domain) => DOMAIN_LABELS[domain]).join(", ");

  const sections = sectionOrder
    .map((domain) => {
      const data = payload.data[domain];
      const summary = summarizeDomainData(data);
      return [
        `<section class="domain-section">`,
        `<h2>${escapeHtml(DOMAIN_LABELS[domain])}</h2>`,
        `<p class="section-summary">${escapeHtml(summary)}</p>`,
        renderDomainContent(data),
        `</section>`,
      ].join("");
    })
    .join("");

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<title>OpenValens Export Report</title>",
    "<style>",
    "*{box-sizing:border-box}",
    "body{margin:0;padding:24px;font-family:Helvetica,Arial,sans-serif;color:#111827;line-height:1.4}",
    "h1,h2,h3{margin:0 0 8px}",
    "h1{font-size:22px}",
    "h2{font-size:18px;margin-top:18px}",
    "p{margin:0 0 10px}",
    "table{border-collapse:collapse;width:100%;margin:8px 0 16px}",
    "th,td{border:1px solid #d1d5db;padding:6px 8px;vertical-align:top;text-align:left;font-size:12px}",
    "th{background:#f3f4f6;font-weight:700}",
    "ol,ul{margin:8px 0 12px;padding-left:20px}",
    "li{font-size:12px;margin:2px 0}",
    ".report-header{margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e5e7eb}",
    ".meta{font-size:12px;color:#4b5563}",
    ".section-summary{font-size:12px;color:#374151}",
    ".domain-section{page-break-inside:avoid}",
    ".empty{font-style:italic;color:#6b7280}",
    "</style>",
    "</head>",
    "<body>",
    `<header class="report-header"><h1>Health Data Export</h1><p class="meta"><strong>Generated at:</strong> ${escapeHtml(payload.generatedAt)}</p><p class="meta"><strong>Selected domains:</strong> ${escapeHtml(selectedDomainLabels)}</p></header>`,
    sections,
    "</body>",
    "</html>",
  ].join("");
}

function renderDomainContent(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '<p class="empty">No records.</p>';
    }

    if (value.every((item) => isPlainObject(item))) {
      return renderObjectTable(value as Array<Record<string, unknown>>);
    }

    return `<ul>${value
      .map((item) => `<li>${escapeHtml(normalizeDisplayValue(item))}</li>`)
      .join("")}</ul>`;
  }

  if (isPlainObject(value)) {
    return renderObjectTable([value]);
  }

  if (value === null || value === undefined) {
    return '<p class="empty">No data.</p>';
  }

  return `<p>${escapeHtml(normalizeDisplayValue(value))}</p>`;
}

function renderObjectTable(rows: Array<Record<string, unknown>>): string {
  const columnSet = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      columnSet.add(key);
    }
  }

  const columns = Array.from(columnSet).sort(compareLexical);

  if (columns.length === 0) {
    return '<p class="empty">No data.</p>';
  }

  const header = columns.map((key) => `<th>${escapeHtml(key)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${escapeHtml(normalizeDisplayValue(row[column]))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function summarizeDomainData(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 1 ? "1 record" : `${value.length} records`;
  }

  if (isPlainObject(value)) {
    const nonEmptyFieldCount = Object.values(value).filter((item) => !isEmptyValue(item)).length;
    if (nonEmptyFieldCount === 0) {
      return "0 populated fields";
    }
    return nonEmptyFieldCount === 1
      ? "1 populated field"
      : `${nonEmptyFieldCount} populated fields`;
  }

  if (value === null || value === undefined) {
    return "No data";
  }

  return "Scalar value";
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (isPlainObject(value)) {
    return Object.keys(value).length === 0;
  }

  return false;
}

function normalizeDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  return stableSerialize(value);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(toStableJsonValue(value, new WeakSet<object>(), 0)) ?? "";
}

function toStableJsonValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (depth >= MAX_STABLE_JSON_DEPTH) {
    return "[MaxDepth]";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const normalized = value.map((item) => toStableJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return normalized;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const keys = Object.keys(value).sort(compareLexical);
    const normalized: Record<string, unknown> = {};

    for (const key of keys) {
      normalized[key] = toStableJsonValue(value[key], seen, depth + 1);
    }

    seen.delete(value);
    return normalized;
  }

  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareLexical(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getExportDate(generatedAt: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(generatedAt);
  return match?.[1] ?? "1970-01-01";
}
