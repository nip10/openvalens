import type { NutrientBasis, NutrientValues } from "../nutrients";

/**
 * Source-specific records an adapter produces from one upstream item, in the
 * shape of the matching mirror table. Records of different sources are never
 * converted into each other.
 */

type CatalogRecordBase = {
  brand: string | null;
  /** Normalized digits-only GTIN/EAN/UPC, or `null`. */
  barcode: string | null;
} & NutrientBasis &
  NutrientValues;

export type FdcFoodRecord = CatalogRecordBase & {
  source: "fdc";
  fdcId: string;
  dataType: string;
  name: string;
};

export type OffProductRecord = CatalogRecordBase & {
  source: "off";
  code: string;
  lastModifiedAt: Date;
  /** OFF products may have no name; it is never invented. */
  name: string | null;
};

export type CatalogRecord = FdcFoodRecord | OffProductRecord;

/** Release (import batch) metadata supplied by the operator for one artifact. */
export type CatalogReleaseManifest = {
  source: CatalogRecord["source"];
  /** e.g. `foundation`, `sr_legacy`, `branded` (FDC) or `products` (OFF). */
  dataset: string;
  /** Upstream release id or dump date. */
  version: string;
  /** Upstream artifact file name. */
  artifact: string;
  /** Lowercase hex SHA-256 of the artifact as downloaded. */
  artifactSha256: string;
  /** Where the artifact was downloaded from. */
  sourceUrl: string;
};

/**
 * Adapter seam (#57): turns one raw upstream item into a record, or `null`
 * when the item cannot be mirrored faithfully (it is then counted as
 * rejected). Adapters are pure: no I/O, no logging of item contents.
 */
export type CatalogRecordAdapter<R extends CatalogRecord = CatalogRecord> = {
  source: R["source"];
  parse(raw: unknown): R | null;
};
