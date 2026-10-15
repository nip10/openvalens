import type { Database } from "@openvalens/db";
import {
  nutritionCatalogFdcFood,
  nutritionCatalogOffOverlay,
  nutritionCatalogOffProduct,
  nutritionCatalogRelease,
} from "@openvalens/db/schema/food-catalog";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { NutritionError } from "../errors";
import {
  NUTRIENT_KEYS,
  nutrientsOf,
  type NutrientBasis,
  type NutrientKey,
  type NutrientValues,
} from "../nutrients";
import {
  normalizeBarcode,
  normalizeName,
  sourceQualifiedId,
  type ExternalSnapshotInput,
} from "../snapshot";
import { fdcAdapter } from "./fdc";
import { offAdapter } from "./off";
import type {
  CatalogRecord,
  CatalogRecordAdapter,
  CatalogReleaseManifest,
  FdcFoodRecord,
  OffProductRecord,
} from "./record";
import {
  CATALOG_SOURCE_TERMS,
  CATALOG_SOURCES,
  isCatalogSource,
  type CatalogSource,
} from "./sources";

/**
 * Public food catalogs (Issue #72): read, import and OFF-overlay operations
 * over the instance-wide FDC and Open Food Facts mirrors.
 *
 * Catalog rows are reference data, not tenant data, so these methods take no
 * `NutritionScope`; callers still gate them behind an authenticated,
 * permissioned procedure (#69). Each source stays in its own table and every
 * result carries its source, version, release and attribution; sources are
 * only combined at query time. Search strings and barcodes are never logged.
 */

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Tx;

export type CatalogRelease = typeof nutritionCatalogRelease.$inferSelect;

export type CatalogAttribution = {
  source: CatalogSource;
  sourceName: string;
  homepage: string;
  /** SPDX id of the dataset license. */
  license: "CC0-1.0" | "ODbL-1.0";
  licenseUrl: string;
  /** Exact notice to show with this food (search result, product view, export). */
  notice: string;
};

export type CatalogFood = {
  /** Source-qualified id, e.g. `fdc:123456` or `off:3017620422003`. */
  id: string;
  source: CatalogSource;
  /** FDC id or OFF product code. */
  sourceFoodId: string;
  /**
   * Version of this record: the FDC release, or OFF's last-modified time (ISO),
   * suffixed `+overlay.<ids>` when OFF overlay rows were applied.
   */
  sourceVersion: string;
  /** FDC data type (`Foundation`, `Branded`, ...); `null` for OFF. */
  dataType: string | null;
  /** `null` only for OFF products that have no name upstream. */
  name: string | null;
  brand: string | null;
  barcode: string | null;
  basis: NutrientBasis;
  /** Per-basis values; `null` = not provided by the source. */
  nutrients: NutrientValues;
  release: Pick<
    CatalogRelease,
    "id" | "dataset" | "version" | "artifact" | "artifactSha256" | "sourceUrl" | "importedAt"
  >;
  attribution: CatalogAttribution;
  /** OFF only: overlay rows applied on top of the unmodified mirror row. */
  overlay: { ids: number[] } | null;
};

export type CatalogSearchInput = {
  query: string;
  /** Defaults to every source. Results are grouped by source in this order. */
  sources?: readonly CatalogSource[];
  /** Maximum results per source (1–50, default 20). */
  limit?: number;
};

export type CatalogImportResult = {
  releaseId: number;
  /** `false` when this exact artifact was already imported (no rows touched). */
  imported: boolean;
  recordCount: number;
  rejectedCount: number;
};

/** Validated OFF overlay changes. `null` nutrient = mark unknown. */
export type OffOverlayChanges = {
  name?: string;
  brand?: string | null;
  nutrients?: Partial<NutrientValues>;
};

export type OffOverlayInput = {
  code: string;
  kind: "transformation" | "correction";
  changes: OffOverlayChanges;
  /** Why the change was made (published with the ODbL overlay); no personal data. */
  reason: string;
};

const SEARCH_MIN = 2;
const SEARCH_MAX = 100;
const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 50;
const BATCH_DEFAULT = 500;

const ADAPTERS: Readonly<Record<CatalogSource, CatalogRecordAdapter>> = {
  fdc: fdcAdapter,
  off: offAdapter,
};

export function catalogAttribution(source: CatalogSource): CatalogAttribution {
  const terms = CATALOG_SOURCE_TERMS[source];
  return {
    source,
    sourceName: terms.name,
    homepage: terms.homepage,
    license: terms.license,
    licenseUrl: terms.licenseUrl,
    notice: terms.notice,
  };
}

/** Parses `fdc:123` / `off:301...`; throws `INVALID_INPUT` for anything else. */
export function parseCatalogFoodId(id: string): { source: CatalogSource; sourceFoodId: string } {
  const match = /^(fdc|off):([0-9]{1,24})$/.exec(id.trim());
  if (!match || !isCatalogSource(match[1]))
    throw new NutritionError("INVALID_INPUT", "Catalog food id must be fdc:<id> or off:<code>");
  if (match[1] === "fdc" && match[2]!.length > 12)
    throw new NutritionError("INVALID_INPUT", "Catalog food id must be fdc:<id> or off:<code>");
  return { source: match[1], sourceFoodId: match[2]! };
}

/**
 * The `ExternalSnapshotInput` for logging a catalog food (#74 `logEntry` with
 * `food: { kind: "external", snapshot }`). Copies source, version and the
 * attribution notice into the tenant snapshot; later catalog refreshes never
 * touch it. Throws `INVALID_INPUT` for an OFF product with no name — the
 * caller must let the user supply one (as a `manual` food) instead.
 */
export function catalogFoodToSnapshotInput(food: CatalogFood): ExternalSnapshotInput {
  if (food.name === null)
    throw new NutritionError("INVALID_INPUT", "Catalog food has no name to log");
  return {
    source: food.source,
    sourceFoodId: food.sourceFoodId,
    sourceVersion: food.sourceVersion,
    attribution: `${food.attribution.notice} Dataset: ${food.release.dataset} ${food.release.version}.`,
    name: food.name,
    brand: food.brand,
    barcode: food.barcode,
    ...food.basis,
    nutrients: food.nutrients,
  };
}

/** Validates overlay changes; throws `INVALID_INPUT`. */
export function normalizeOffOverlayChanges(raw: unknown): OffOverlayChanges {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new NutritionError("INVALID_INPUT", "Overlay changes must be an object");
  const input = raw as Record<string, unknown>;
  const unknownKey = Object.keys(input).find(
    (key) => !["name", "brand", "nutrients"].includes(key),
  );
  if (unknownKey !== undefined)
    throw new NutritionError("INVALID_INPUT", "Overlay changes support name, brand and nutrients");
  const changes: OffOverlayChanges = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string")
      throw new NutritionError("INVALID_INPUT", "Overlay name must be text");
    changes.name = normalizeName(input.name);
  }
  if (input.brand !== undefined) {
    if (input.brand !== null && typeof input.brand !== "string")
      throw new NutritionError("INVALID_INPUT", "Overlay brand must be text or null");
    changes.brand = input.brand?.trim() || null;
  }
  if (input.nutrients !== undefined) {
    if (typeof input.nutrients !== "object" || input.nutrients === null)
      throw new NutritionError("INVALID_INPUT", "Overlay nutrients must be an object");
    const nutrients: Partial<NutrientValues> = {};
    for (const [key, value] of Object.entries(input.nutrients)) {
      if (!(NUTRIENT_KEYS as readonly string[]).includes(key))
        throw new NutritionError("INVALID_INPUT", "Overlay nutrient key is not supported");
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
        throw new NutritionError(
          "INVALID_INPUT",
          `Overlay nutrient ${key} must be non-negative or null`,
        );
      nutrients[key as NutrientKey] = value as number | null;
    }
    changes.nutrients = nutrients;
  }
  if (Object.keys(changes).length === 0)
    throw new NutritionError("INVALID_INPUT", "Overlay changes are empty");
  return changes;
}

function assertManifest(manifest: CatalogReleaseManifest): void {
  if (!isCatalogSource(manifest.source))
    throw new NutritionError("INVALID_INPUT", "Unsupported catalog source");
  for (const key of ["dataset", "version", "artifact", "sourceUrl"] as const)
    if (typeof manifest[key] !== "string" || !manifest[key].trim())
      throw new NutritionError("INVALID_INPUT", `Release ${key} is required`);
  if (!/^[0-9a-f]{64}$/.test(manifest.artifactSha256))
    throw new NutritionError("INVALID_INPUT", "Release artifact SHA-256 must be lowercase hex");
}

function releaseAttribution(manifest: CatalogReleaseManifest): string {
  const terms = CATALOG_SOURCE_TERMS[manifest.source];
  return `${terms.notice} Dataset: ${manifest.dataset} ${manifest.version} (${manifest.artifact}).`;
}

function basisOf(row: NutrientBasis): NutrientBasis {
  return {
    nutrientBasisAmount: row.nutrientBasisAmount,
    nutrientBasisUnit: row.nutrientBasisUnit,
    servingSizeAmount: row.servingSizeAmount,
    servingSizeUnit: row.servingSizeUnit,
    servingLabel: row.servingLabel,
  };
}

function releaseInfo(release: CatalogRelease): CatalogFood["release"] {
  return {
    id: release.id,
    dataset: release.dataset,
    version: release.version,
    artifact: release.artifact,
    artifactSha256: release.artifactSha256,
    sourceUrl: release.sourceUrl,
    importedAt: release.importedAt,
  };
}

type FdcRow = typeof nutritionCatalogFdcFood.$inferSelect;
type OffRow = typeof nutritionCatalogOffProduct.$inferSelect;
type OverlayRow = typeof nutritionCatalogOffOverlay.$inferSelect;

function fdcFood(row: FdcRow, release: CatalogRelease): CatalogFood {
  return {
    id: sourceQualifiedId("fdc", row.fdcId),
    source: "fdc",
    sourceFoodId: row.fdcId,
    sourceVersion: row.sourceVersion,
    dataType: row.dataType,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    basis: basisOf(row),
    nutrients: nutrientsOf(row),
    release: releaseInfo(release),
    attribution: catalogAttribution("fdc"),
    overlay: null,
  };
}

/** Mirror row plus active overlay rows (in id order); the mirror row itself is never changed. */
function offFood(
  row: OffRow,
  release: CatalogRelease,
  overlays: readonly OverlayRow[],
): CatalogFood {
  let name = row.name;
  let brand = row.brand;
  const nutrients = nutrientsOf(row);
  for (const overlay of overlays) {
    const changes = overlay.changes as OffOverlayChanges;
    if (changes.name !== undefined) name = changes.name;
    if (changes.brand !== undefined) brand = changes.brand;
    for (const [key, value] of Object.entries(changes.nutrients ?? {}))
      nutrients[key as NutrientKey] = value ?? null;
  }
  const ids = overlays.map((overlay) => overlay.id);
  const modified = row.lastModifiedAt.toISOString();
  return {
    id: sourceQualifiedId("off", row.code),
    source: "off",
    sourceFoodId: row.code,
    sourceVersion: ids.length ? `${modified}+overlay.${ids.join(".")}` : modified,
    dataType: null,
    name,
    brand,
    barcode: row.barcode,
    basis: basisOf(row),
    nutrients,
    release: releaseInfo(release),
    attribution: catalogAttribution("off"),
    overlay: ids.length ? { ids } : null,
  };
}

/** `ILIKE` pattern matching `text` literally anywhere. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** `excluded.<column>` for every listed key, for `ON CONFLICT DO UPDATE`. */
function excludedSet<K extends string>(
  table: Record<K, AnyPgColumn>,
  keys: readonly K[],
): Record<K, SQL> {
  return Object.fromEntries(
    keys.map((key) => [key, sql`excluded.${sql.identifier(table[key].name)}`]),
  ) as Record<K, SQL>;
}

const RECORD_COLUMNS = [
  "name",
  "brand",
  "barcode",
  "nutrientBasisAmount",
  "nutrientBasisUnit",
  "servingSizeAmount",
  "servingSizeUnit",
  "servingLabel",
  ...NUTRIENT_KEYS,
] as const;

async function upsertFdc(tx: Tx, releaseId: number, version: string, records: FdcFoodRecord[]) {
  if (!records.length) return;
  await tx
    .insert(nutritionCatalogFdcFood)
    .values(
      records.map(({ source: _source, ...record }) => ({
        ...record,
        releaseId,
        sourceVersion: version,
      })),
    )
    .onConflictDoUpdate({
      target: nutritionCatalogFdcFood.fdcId,
      set: {
        ...excludedSet(nutritionCatalogFdcFood, [
          ...RECORD_COLUMNS,
          "dataType",
          "releaseId",
          "sourceVersion",
        ]),
        updatedAt: sql`now()`,
      },
    });
}

async function upsertOff(tx: Tx, releaseId: number, records: OffProductRecord[]) {
  if (!records.length) return;
  await tx
    .insert(nutritionCatalogOffProduct)
    .values(records.map(({ source: _source, ...record }) => ({ ...record, releaseId })))
    .onConflictDoUpdate({
      target: nutritionCatalogOffProduct.code,
      set: {
        ...excludedSet(nutritionCatalogOffProduct, [
          ...RECORD_COLUMNS,
          "lastModifiedAt",
          "releaseId",
        ]),
        updatedAt: sql`now()`,
      },
      // An older dump never overwrites a newer product revision.
      setWhere: sql`excluded.last_modified_at >= ${nutritionCatalogOffProduct.lastModifiedAt}`,
    });
}

function recordKey(record: CatalogRecord): string {
  return record.source === "fdc" ? record.fdcId : record.code;
}

export function createFoodCatalog(db: Database) {
  const releasesById = async (executor: Executor, ids: number[]) => {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<number, CatalogRelease>();
    const rows = await executor
      .select()
      .from(nutritionCatalogRelease)
      .where(inArray(nutritionCatalogRelease.id, unique));
    return new Map(rows.map((row) => [row.id, row]));
  };

  const activeOverlays = async (codes: string[]) => {
    const byCode = new Map<string, OverlayRow[]>();
    if (!codes.length) return byCode;
    const rows = await db
      .select()
      .from(nutritionCatalogOffOverlay)
      .where(
        and(
          inArray(nutritionCatalogOffOverlay.code, codes),
          isNull(nutritionCatalogOffOverlay.retractedAt),
        ),
      )
      .orderBy(asc(nutritionCatalogOffOverlay.id));
    for (const row of rows) byCode.set(row.code, [...(byCode.get(row.code) ?? []), row]);
    return byCode;
  };

  const toFdcFoods = async (rows: FdcRow[]) => {
    const releases = await releasesById(
      db,
      rows.map((row) => row.releaseId),
    );
    return rows.map((row) => fdcFood(row, releases.get(row.releaseId)!));
  };

  const toOffFoods = async (rows: OffRow[]) => {
    const releases = await releasesById(
      db,
      rows.map((row) => row.releaseId),
    );
    const overlays = await activeOverlays(rows.map((row) => row.code));
    return rows.map((row) =>
      offFood(row, releases.get(row.releaseId)!, overlays.get(row.code) ?? []),
    );
  };

  const findFdc = (where: SQL | undefined, limit: number) =>
    db
      .select()
      .from(nutritionCatalogFdcFood)
      .where(where)
      .orderBy(asc(nutritionCatalogFdcFood.name), asc(nutritionCatalogFdcFood.fdcId))
      .limit(limit);

  const findOff = (where: SQL | undefined, limit: number) =>
    db
      .select()
      .from(nutritionCatalogOffProduct)
      .where(where)
      .orderBy(asc(nutritionCatalogOffProduct.name), asc(nutritionCatalogOffProduct.code))
      .limit(limit);

  return {
    /** Food by source-qualified id; `null` when the catalog has no such record. */
    async getFood(id: string): Promise<CatalogFood | null> {
      const { source, sourceFoodId } = parseCatalogFoodId(id);
      if (source === "fdc") {
        const [food] = await toFdcFoods(
          await findFdc(eq(nutritionCatalogFdcFood.fdcId, sourceFoodId), 1),
        );
        return food ?? null;
      }
      const [food] = await toOffFoods(
        await findOff(eq(nutritionCatalogOffProduct.code, sourceFoodId), 1),
      );
      return food ?? null;
    },

    /**
     * Every catalog record with this normalized barcode, each kept as its own
     * attributed result (FDC first, then OFF). `[]` is a miss; a malformed
     * barcode throws `INVALID_INPUT` before any query.
     */
    async lookupBarcode(raw: string): Promise<CatalogFood[]> {
      const barcode = normalizeBarcode(raw);
      const fdc = await toFdcFoods(await findFdc(eq(nutritionCatalogFdcFood.barcode, barcode), 10));
      const off = await toOffFoods(
        await findOff(eq(nutritionCatalogOffProduct.barcode, barcode), 10),
      );
      return [...fdc, ...off];
    },

    /**
     * Case-insensitive substring match on name or brand, per source, grouped
     * by source. No relevance or completeness guarantee.
     */
    async searchFoods(input: CatalogSearchInput): Promise<CatalogFood[]> {
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (query.length < SEARCH_MIN || query.length > SEARCH_MAX)
        throw new NutritionError(
          "INVALID_INPUT",
          `Search text must be ${SEARCH_MIN} to ${SEARCH_MAX} characters`,
        );
      const limit = input.limit ?? LIMIT_DEFAULT;
      if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX)
        throw new NutritionError("INVALID_INPUT", `Limit must be 1 to ${LIMIT_MAX}`);
      const sources = input.sources ?? CATALOG_SOURCES;
      if (!sources.every(isCatalogSource))
        throw new NutritionError("INVALID_INPUT", "Unsupported catalog source");
      const pattern = containsPattern(query);

      const results: CatalogFood[] = [];
      for (const source of new Set(sources)) {
        if (source === "fdc")
          results.push(
            ...(await toFdcFoods(
              await findFdc(
                or(
                  ilike(nutritionCatalogFdcFood.name, pattern),
                  ilike(nutritionCatalogFdcFood.brand, pattern),
                ),
                limit,
              ),
            )),
          );
        else
          results.push(
            ...(await toOffFoods(
              await findOff(
                and(
                  isNotNull(nutritionCatalogOffProduct.name),
                  or(
                    ilike(nutritionCatalogOffProduct.name, pattern),
                    ilike(nutritionCatalogOffProduct.brand, pattern),
                  ),
                ),
                limit,
              ),
            )),
          );
      }
      return results;
    },

    /** Imported releases, newest first, for About/Settings attribution. */
    async listReleases(): Promise<CatalogRelease[]> {
      return db
        .select()
        .from(nutritionCatalogRelease)
        .orderBy(desc(nutritionCatalogRelease.importedAt), desc(nutritionCatalogRelease.id));
    },

    /**
     * Imports one upstream artifact atomically: records the release (artifact,
     * SHA-256, license, attribution) and upserts the parsed records into that
     * source's mirror table only. Re-importing the same artifact is a no-op.
     * Items the adapter rejects are counted, never logged.
     */
    async importRelease(
      manifest: CatalogReleaseManifest,
      items: Iterable<unknown> | AsyncIterable<unknown>,
      options: { adapter?: CatalogRecordAdapter; batchSize?: number } = {},
    ): Promise<CatalogImportResult> {
      assertManifest(manifest);
      const adapter = options.adapter ?? ADAPTERS[manifest.source];
      if (adapter.source !== manifest.source)
        throw new NutritionError("INVALID_INPUT", "Adapter source does not match the release");
      const batchSize = options.batchSize ?? BATCH_DEFAULT;
      const terms = CATALOG_SOURCE_TERMS[manifest.source];

      return db.transaction(async (tx) => {
        const [release] = await tx
          .insert(nutritionCatalogRelease)
          .values({
            source: manifest.source,
            dataset: manifest.dataset.trim(),
            version: manifest.version.trim(),
            artifact: manifest.artifact.trim(),
            artifactSha256: manifest.artifactSha256,
            sourceUrl: manifest.sourceUrl.trim(),
            license: terms.license,
            attribution: releaseAttribution(manifest),
          })
          .onConflictDoNothing()
          .returning();
        if (!release) {
          const [existing] = await tx
            .select()
            .from(nutritionCatalogRelease)
            .where(
              and(
                eq(nutritionCatalogRelease.source, manifest.source),
                eq(nutritionCatalogRelease.dataset, manifest.dataset.trim()),
                eq(nutritionCatalogRelease.version, manifest.version.trim()),
                eq(nutritionCatalogRelease.artifactSha256, manifest.artifactSha256),
              ),
            );
          if (!existing) throw new Error("Release upsert did not return a row");
          return {
            releaseId: existing.id,
            imported: false,
            recordCount: existing.recordCount,
            rejectedCount: existing.rejectedCount,
          };
        }

        let recordCount = 0;
        let rejectedCount = 0;
        // Keyed by source id so a duplicate inside one batch keeps the last item.
        let batch = new Map<string, CatalogRecord>();
        const flush = async () => {
          const records = [...batch.values()];
          batch = new Map();
          if (manifest.source === "fdc")
            await upsertFdc(tx, release.id, release.version, records as FdcFoodRecord[]);
          else await upsertOff(tx, release.id, records as OffProductRecord[]);
        };

        for await (const item of items) {
          const record = adapter.parse(item);
          if (!record) {
            rejectedCount += 1;
            continue;
          }
          // Never file a record under another source's release.
          if (record.source !== manifest.source)
            throw new NutritionError("INVALID_INPUT", "Record source does not match the release");
          recordCount += 1;
          batch.set(recordKey(record), record);
          if (batch.size >= batchSize) await flush();
        }
        await flush();

        await tx
          .update(nutritionCatalogRelease)
          .set({ recordCount, rejectedCount })
          .where(eq(nutritionCatalogRelease.id, release.id));
        return { releaseId: release.id, imported: true, recordCount, rejectedCount };
      });
    },

    /**
     * Records an OFF transformation or correction in the overlay table; the
     * mirror row is untouched. Operator tooling only — never expose this to
     * tenant requests (overlay rows are instance-wide and published under ODbL).
     */
    async addOffOverlay(input: OffOverlayInput): Promise<{ id: number }> {
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!/^[0-9]{1,24}$/.test(code))
        throw new NutritionError("INVALID_INPUT", "Open Food Facts code must be digits");
      if (input.kind !== "transformation" && input.kind !== "correction")
        throw new NutritionError(
          "INVALID_INPUT",
          "Overlay kind must be transformation or correction",
        );
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (!reason) throw new NutritionError("INVALID_INPUT", "Overlay reason is required");
      const changes = normalizeOffOverlayChanges(input.changes);
      const [product] = await db
        .select({ code: nutritionCatalogOffProduct.code })
        .from(nutritionCatalogOffProduct)
        .where(eq(nutritionCatalogOffProduct.code, code));
      if (!product) throw new NutritionError("NOT_FOUND", "Open Food Facts product not found");
      const [row] = await db
        .insert(nutritionCatalogOffOverlay)
        .values({ code, kind: input.kind, changes, reason })
        .returning({ id: nutritionCatalogOffOverlay.id });
      return { id: row!.id };
    },

    /** Stops applying an overlay row; the row is kept for the published history. */
    async retractOffOverlay(id: number): Promise<void> {
      const [row] = await db
        .update(nutritionCatalogOffOverlay)
        .set({ retractedAt: new Date() })
        .where(
          and(
            eq(nutritionCatalogOffOverlay.id, id),
            isNull(nutritionCatalogOffOverlay.retractedAt),
          ),
        )
        .returning({ id: nutritionCatalogOffOverlay.id });
      if (!row) throw new NutritionError("NOT_FOUND", "Overlay row not found");
    },
  };
}

export type FoodCatalog = ReturnType<typeof createFoodCatalog>;
