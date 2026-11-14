/**
 * The supported-devices page (`/devices`, Issue #445), generated at build time
 * from the direct-device allowlist and each model's support status
 * (`packages/health-record/src/device-support-status.ts`).
 *
 * The page lists every registered model with its status. Its headline names
 * brands, never a count: a count may lead only once it counts models tested
 * on a device alone.
 */
import {
  type DeviceSupportStatus,
  DEVICE_SUPPORT_STATUSES,
  directDeviceSupportList,
  type ExperimentalReason,
} from "../../../packages/health-record/src/device-support-status";
import type { DirectDeviceFamily } from "../../../packages/health-record/src/direct-device-models";

export const STATUS_LABELS: Readonly<Record<DeviceSupportStatus, string>> = {
  tested: "Tested on a device",
  works_in_testing: "Works in testing",
  experimental: "Experimental",
};

export const STATUS_DESCRIPTIONS: Readonly<Record<DeviceSupportStatus, string>> = {
  tested: "Records from this model have been synced to OpenValens on a real device.",
  works_in_testing:
    "The Bluetooth protocol it uses passes the automated tests in the OpenValens code. Nobody has tried this model on a real device yet.",
  experimental:
    "It may not work yet. The note says why: no records sync from it yet, Pebble sync is new, or Gadgetbridge, whose protocol work OpenValens builds on, marks it experimental.",
};

export const REASON_NOTES: Readonly<Record<ExperimentalReason, string>> = {
  no_records_yet: "No records sync from this model yet",
  upstream_experimental: "Experimental in Gadgetbridge",
  new_capture_path: "Pebble sync is new",
};

/**
 * Section heading per family, in page order (the best-known brands first).
 * Typed over every family, so a family added to the allowlist fails type checks
 * until it has a heading.
 */
export const FAMILY_LABELS: Readonly<Record<DirectDeviceFamily, string>> = {
  garmin: "Garmin",
  huawei: "Huawei and Honor",
  zepp_os: "Amazfit (Zepp OS)",
  huami_legacy: "Older Amazfit, Zepp and Mi Band",
  xiaomi: "Xiaomi, Mi and Redmi",
  pebble: "Pebble",
  fossil_hr: "Fossil and Skagen hybrids",
  casio: "Casio",
  bangle_js: "Bangle.js",
  colmi_ring: "Colmi and Yawell rings",
  gloryfit: "GloryFit watches (Haylou, IMIKI, Kieslect and others)",
  moyoung: "Moyoung watches",
  fitpro: "FitPro bands",
  ble_gatt: "Heart-rate straps, blood-pressure cuffs, thermometers and PineTime",
  ble_scale: "Smart scales",
};

const FAMILY_ORDER = Object.keys(FAMILY_LABELS) as DirectDeviceFamily[];

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slug(status: DeviceSupportStatus): string {
  return status.replaceAll("_", "-");
}

function statusBadge(status: DeviceSupportStatus): string {
  return `<span class="status status-${slug(status)}">${STATUS_LABELS[status]}</span>`;
}

type Counts = Record<DeviceSupportStatus, number>;

function countsOf(statuses: readonly DeviceSupportStatus[]): Counts {
  const counts: Counts = { tested: 0, works_in_testing: 0, experimental: 0 };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

function countsLine(counts: Counts): string {
  return DEVICE_SUPPORT_STATUSES.filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${STATUS_LABELS[status].toLowerCase()}`)
    .join(" · ");
}

/** The status legend with model counts (`__DEVICE_SUMMARY__`). */
export function renderDeviceSummary(): string {
  const list = directDeviceSupportList();
  const counts = countsOf(list.map((model) => model.support.status));
  const rows = DEVICE_SUPPORT_STATUSES.map(
    (status) =>
      `<div class="status-row"><dt>${statusBadge(status)} <span class="status-count">${counts[status]} ${counts[status] === 1 ? "model" : "models"}</span></dt><dd>${STATUS_DESCRIPTIONS[status]}</dd></div>`,
  );
  const families = FAMILY_ORDER.map((family) => {
    const size = list.filter((model) => model.family === family).length;
    return `<li><a href="#${family}">${escapeHtml(FAMILY_LABELS[family])}</a> <span class="status-count">${size}</span></li>`;
  });
  return [
    `<dl class="status-legend">`,
    ...rows,
    `</dl>`,
    `<nav aria-label="Device families"><ul class="family-nav">`,
    ...families,
    `</ul></nav>`,
  ].join("\n");
}

/** One section per family, models in name order (`__DEVICE_FAMILIES__`). */
export function renderDeviceFamilies(): string {
  const list = directDeviceSupportList();
  return FAMILY_ORDER.map((family) => {
    const models = list
      .filter((model) => model.family === family)
      .sort((a, b) => collator.compare(a.displayName, b.displayName));
    const items = models.map((model) => {
      const note =
        model.support.status === "experimental"
          ? `<span class="device-note">${REASON_NOTES[model.support.reason]}</span>`
          : "";
      return `<li><span class="device-name">${escapeHtml(model.displayName)}</span>${statusBadge(model.support.status)}${note}</li>`;
    });
    return [
      `<section class="device-family" id="${family}" aria-labelledby="${family}-title">`,
      `<h2 id="${family}-title">${escapeHtml(FAMILY_LABELS[family])}</h2>`,
      `<p class="meta">${models.length} ${models.length === 1 ? "model" : "models"}: ${countsLine(countsOf(models.map((model) => model.support.status)))}</p>`,
      `<ul class="device-list">`,
      ...items,
      `</ul>`,
      `</section>`,
    ].join("\n");
  }).join("\n");
}

/** Brand names that start a registered model's display name. */
export function registeredBrands(): Set<string> {
  return new Set(directDeviceSupportList().map((model) => model.displayName.split(" ")[0]!));
}
