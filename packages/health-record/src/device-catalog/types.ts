/**
 * Types for the imported upstream Gadgetbridge device catalog.
 *
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** Coarse upstream implementation-status label from `device_support.yml`. */
export type GadgetbridgeFeatureLevel = "high" | "most" | "partial" | "poor" | "unknown";

/** One `device_support` entry, normalized for lookup. */
export type GadgetbridgeDevice = Readonly<{
  /** Stable upstream YAML id, e.g. `amazfit_helio_strap`. */
  id: string;
  /** Upstream category directory, e.g. `wearables`, `rings`, `scales`. */
  category: string;
  /** Upstream vendor page key before `vendor_mappings` is applied. */
  vendor: string;
  /** Vendor page key after `vendor_mappings` is applied. */
  resolvedVendor: string;
  /** Raw upstream flag list, sorted, exactly as published. */
  flags: readonly string[];
  featureLevel: GadgetbridgeFeatureLevel;
  /** `pair_*` flag without its prefix, e.g. `free`, `huami`, `unknown`. */
  pairMode: string;
  /** `os_*` flag without its prefix, e.g. `zepp`, `garmin`, `xiaomi_protobuf`. */
  os: string | null;
  /** Upstream `experimental` flag. */
  experimental: boolean;
  /** Documentation links declared by the upstream entry. */
  links: Readonly<Record<string, string>>;
}>;

/** Provenance for the committed snapshot; mirrors `DATA-LICENSES.md`. */
export type GadgetbridgeCatalogMeta = Readonly<{
  /** File name inside the upstream website repository. */
  source: string;
  /** Upstream repository URL. */
  repository: string;
  /** Exact pinned URL the snapshot was taken from. */
  sourceUrl: string;
  /** Pinned upstream commit SHA. Never a branch name. */
  revision: string;
  /** ISO-8601 UTC timestamp of the fetch that produced this snapshot. */
  retrievedAt: string;
  /** SHA-256 of the verbatim source bytes. */
  sha256: string;
  /** SPDX identifier. */
  license: string;
  /** Attribution string shown with derived UI. */
  attribution: string;
  /** Number of `device_support` entries in the snapshot. */
  deviceCount: number;
}>;

export type GadgetbridgeCatalog = Readonly<{
  meta: GadgetbridgeCatalogMeta;
  devices: Readonly<Record<string, GadgetbridgeDevice>>;
}>;
