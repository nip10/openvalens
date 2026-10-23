/**
 * Clinical export presentation shared by web and mobile. Pure TypeScript; the
 * only import is the closed domain enum, so this module is safe for the app
 * bundle. Copy follows docs/mobile/tone-of-voice.md (sentence case, no
 * marketing language).
 */
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import {
  DEFAULT_EXPORT_DOMAINS,
  EXPORT_DOMAINS,
  type ExportDomain,
} from "@openvalens/clinical-export/domains";

export type { ExportDomain } from "@openvalens/clinical-export/domains";

/** Sentence-case label for every domain in the closed export enum. */
const EXPORT_DOMAIN_LABELS: Record<ExportDomain, MessageDescriptor> = {
  blood: msg`Blood`,
  body: msg`Body`,
  medications: msg`Medications`,
  supplements: msg`Supplements`,
  workouts: msg`Workouts`,
  goals: msg`Goals`,
  familyHistory: msg`Family history`,
  calendar: msg`Calendar`,
  insights: msg`Insights`,
  imaging: msg`Imaging`,
  cardiac: msg`Cardiac`,
  dexa: msg`DEXA`,
  weight: msg`Weight`,
  audit: msg`Audit`,
};

export type ExportDomainOption = {
  domain: ExportDomain;
  label: MessageDescriptor;
  defaultSelected: boolean;
};

/** A rendered export ready to hand to a platform download or share surface. */
export type ExportArtifact = {
  fileName: string;
  content: string;
  mime: string;
};

/** Sentence-case label for a domain in the closed export enum. */
export function formatExportDomainLabel(domain: ExportDomain): MessageDescriptor {
  return EXPORT_DOMAIN_LABELS[domain];
}

/**
 * Human-readable byte size using base 1024. Whole bytes below 1 KiB, then one
 * decimal place. Non-finite or negative input renders the em-dash placeholder.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex] ?? "TB"}`;
}

/**
 * UTF-8 byte length without relying on TextEncoder or Blob, which Hermes does
 * not provide. Iterating the string yields code points, so surrogate pairs
 * count as their four UTF-8 bytes.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * Bundle artifact for `exports.clinicalBundle`. The filename is derived from
 * the generation timestamp so web and mobile produce the same name.
 */
export function exportBundleArtifact(bundle: {
  generation: { generatedAt: string };
}): ExportArtifact {
  return {
    fileName: `health-export-bundle-${bundle.generation.generatedAt.slice(0, 10)}.json`,
    content: JSON.stringify(bundle, null, 2),
    mime: "application/json",
  };
}

/** CSV artifacts for `exports.legacyDownload`, one file per rendered domain. */
export function exportCsvArtifacts(
  files: readonly { fileName: string; content: string }[],
): ExportArtifact[] {
  return files.map((file) => ({
    fileName: file.fileName,
    content: file.content,
    mime: "text/csv",
  }));
}

/** HTML artifact for `exports.legacyPdfDownload`. */
export function exportPdfArtifact(file: { fileName: string; content: string }): ExportArtifact {
  return { fileName: file.fileName, content: file.content, mime: "text/html" };
}

/**
 * The closed, canonically ordered export-domain list for the export pickers.
 * Each option carries its sentence-case label and whether it is selected by
 * default (the anchor's canonical defaults).
 */
export function pickExportDomains(): ExportDomainOption[] {
  const defaults = new Set<ExportDomain>(DEFAULT_EXPORT_DOMAINS);
  return EXPORT_DOMAINS.map((domain) => ({
    domain,
    label: formatExportDomainLabel(domain),
    defaultSelected: defaults.has(domain),
  }));
}
