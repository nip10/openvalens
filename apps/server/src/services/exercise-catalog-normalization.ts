import { createHash } from "node:crypto";
const canonicalExerciseLicense = (
  value: string | null,
): "CC0-1.0" | "CC-BY-SA-3.0" | "CC-BY-SA-4.0" | null =>
  value === "CC0-1.0" || value === "CC-BY-SA-3.0" || value === "CC-BY-SA-4.0" ? value : null;

export type NormalizedTranslation = {
  languageCode: string;
  name: string;
  instructions: string | null;
  licenseCode: string;
  licenseUrl: string;
  author: string | null;
  sourceUrl: string;
  rawAttribution: string | null;
};
export type NormalizedExercise = {
  externalId: string;
  name: string;
  category: string | null;
  licenseCode: string | null;
  licenseUrl: string | null;
  author: string | null;
  rawAttribution: string | null;
  sourceLicenseMetadata: string;
  sourceRecordUrl: string;
  snapshotVersion: string;
  snapshotAt: Date;
  canonicalNameLanguage: string;
  translations: NormalizedTranslation[];
  muscles: Array<{
    externalMuscleId: string | null;
    name: string;
    role: "primary" | "secondary";
    location: "front" | "back" | null;
  }>;
  equipment: Array<{ externalEquipmentId: string | null; name: string }>;
  media: Array<{
    sourceExternalMediaId: string;
    kind: "image" | "video";
    licenseCode: string;
    licenseUrl: string;
    author: string | null;
    rawAttribution: string | null;
    sourceMediaUrl: string | null;
  }>;
};
export type NormalizationResult = {
  snapshotVersion: string;
  snapshotAt: Date;
  artifactSha256: string;
  accepted: NormalizedExercise[];
  rejectedRecords: number;
  rejectedTranslations: number;
  rejectedMedia: number;
  rejectedReasonCounts: Record<string, number>;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const LICENSE_URLS: Readonly<Record<string, string>> = Object.freeze({
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
});
const nonempty = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const positiveId = (value: unknown): string | null => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  return Number.isSafeInteger(n) && n > 0 ? String(n) : null;
};

function licenseInfo(
  value: unknown,
  lookup: Record<string, unknown>,
): { code: string; url: string; raw: string } | null {
  const direct = object(value);
  let license = direct;
  if (!direct) {
    const id = positiveId(value);
    if (!id) return null;
    const candidates = Object.entries(lookup).filter(
      ([key, entry]) => key === id || positiveId(object(entry)?.id) === id,
    );
    if (candidates.length !== 1) return null;
    license = object(candidates[0]?.[1]);
  }
  if (!license) return null;
  const code = canonicalExerciseLicense(
    nonempty(license.short_name) ?? nonempty(license.code) ?? nonempty(license.name),
  );
  const url = nonempty(license.url) ?? nonempty(license.license_url);
  if (!code || !url || LICENSE_URLS[code] !== url) return null;
  return { code, url, raw: JSON.stringify({ id: license.id ?? null, code, url }) };
}

function languageCode(value: unknown, lookup: Record<string, unknown>): string | null {
  const entry = object(value);
  let code =
    nonempty(entry?.languageCode) ??
    nonempty(entry?.language_code) ??
    nonempty(entry?.short_name) ??
    nonempty(entry?.code);
  if (!code) {
    const id = positiveId(entry?.id ?? value);
    if (!id) return null;
    const candidates = Object.entries(lookup).filter(
      ([key, item]) => key === id || positiveId(object(item)?.id) === id,
    );
    if (candidates.length !== 1) return null;
    const found = object(candidates[0]?.[1]);
    code = nonempty(found?.short_name) ?? nonempty(found?.code) ?? nonempty(found?.languageCode);
  }
  return code && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code)
    ? code.replaceAll("_", "-").toLowerCase()
    : null;
}

/** Accepts only the declared offline bundle contract; never sanitizes or treats HTML as safe. */
export function normalizeWgerSnapshot(input: unknown, bytes: Uint8Array): NormalizationResult {
  const bundle = object(input);
  const version = nonempty(bundle?.snapshotVersion);
  if (
    !bundle ||
    bundle.source !== "wger" ||
    bundle.complete !== true ||
    !version ||
    version.length > 128 ||
    /[\r\n]/.test(version)
  )
    throw new Error("Expected a complete wger snapshot bundle with a bounded snapshotVersion.");
  const snapshotAt = new Date(String(bundle.snapshotAt ?? ""));
  if (!Number.isFinite(snapshotAt.getTime())) throw new Error("Snapshot timestamp is invalid.");
  const lookups = object(bundle.lookups) ?? {};
  const licenses = object(lookups.licenses) ?? {};
  const languages = object(lookups.languages) ?? {};
  const results = object(bundle.results);
  const items = Array.isArray(bundle.results)
    ? bundle.results
    : Array.isArray(results?.results)
      ? results.results
      : null;
  if (!items || items.length > 100_000)
    throw new Error("Unsupported result shape or item limit exceeded.");
  if (results && nonempty(results.next))
    throw new Error("Snapshot is paginated/truncated; provide a complete bundle.");
  const reasons: Record<string, number> = {};
  const reject = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };
  const accepted: NormalizedExercise[] = [];
  const seenIds = new Set<string>();
  let rejectedTranslations = 0;
  let rejectedMedia = 0;
  for (const raw of items) {
    const row = object(raw);
    const id = positiveId(row?.id);
    if (!row || !id) {
      reject("invalid_external_id_or_record");
      continue;
    }
    if (seenIds.has(id)) {
      reject("duplicate_external_id");
      continue;
    }
    seenIds.add(id);
    const exerciseRow = row;
    const translationRows =
      Array.isArray(row.translations) && row.translations.length <= 100 ? row.translations : null;
    if (!translationRows) {
      reject("unsupported_translations_shape");
      continue;
    }
    const translations: NormalizedTranslation[] = [];
    for (const value of translationRows) {
      const t = object(value);
      const lang = languageCode(t?.language ?? t?.languageCode ?? t?.language_code, languages);
      const lic = licenseInfo(t?.license, licenses);
      const name = nonempty(t?.name);
      const sourceUrl = nonempty(t?.sourceUrl);
      const author = nonempty(t?.author);
      const instructions = nonempty(t?.description) ?? nonempty(t?.instructions);
      if (
        !t ||
        !lang ||
        !lic ||
        !name ||
        name.length > 200 ||
        !sourceUrl ||
        (lic.code !== "CC0-1.0" && !author) ||
        (instructions && instructions.length > 10_000)
      ) {
        rejectedTranslations++;
        continue;
      }
      translations.push({
        languageCode: lang,
        name,
        instructions,
        licenseCode: lic.code,
        licenseUrl: lic.url,
        author,
        sourceUrl,
        rawAttribution: nonempty(t.attribution),
      });
    }
    const canonical =
      translations.find((t) => t.languageCode === "en") ??
      translations.find((t) => t.languageCode.startsWith("en-"));
    if (!canonical) {
      reject("missing_licensed_english_name");
      continue;
    }
    function mapNamed(key: "equipment"): NormalizedExercise["equipment"];
    function mapNamed(
      key: "muscles" | "muscles_secondary",
      role: "primary" | "secondary",
    ): NormalizedExercise["muscles"];
    function mapNamed(
      key: "muscles" | "muscles_secondary" | "equipment",
      role?: "primary" | "secondary",
    ): NormalizedExercise["muscles"] | NormalizedExercise["equipment"] {
      const list = exerciseRow[key];
      if (list === undefined || list === null) return [];
      if (!Array.isArray(list)) throw new Error(`Unsupported ${key} shape in exerciseinfo record.`);
      if (key === "equipment")
        return list.flatMap((value) => {
          const child = object(value);
          const name = nonempty(child?.name_en) ?? nonempty(child?.name);
          return child && name ? [{ externalEquipmentId: positiveId(child.id), name }] : [];
        });
      return list.flatMap((value) => {
        const child = object(value);
        const name = nonempty(child?.name_en) ?? nonempty(child?.name);
        if (!child || !name) return [];
        return [
          {
            externalMuscleId: positiveId(child.id),
            name,
            role: role!,
            location:
              typeof child.is_front === "boolean"
                ? child.is_front
                  ? ("front" as const)
                  : ("back" as const)
                : null,
          },
        ];
      });
    }
    const media: NormalizedExercise["media"] = [];
    const imageRows = row.images;
    if (imageRows !== undefined && imageRows !== null && !Array.isArray(imageRows))
      throw new Error("Unsupported images shape in exerciseinfo record.");
    for (const value of Array.isArray(imageRows) ? imageRows : []) {
      const image = object(value);
      const mediaId = positiveId(image?.id);
      const lic = licenseInfo(image?.license, licenses);
      const author = nonempty(image?.author);
      const attribution = nonempty(image?.attribution);
      const sourceMediaUrl = nonempty(image?.image);
      if (
        !image ||
        !mediaId ||
        !lic ||
        !sourceMediaUrl ||
        (lic.code !== "CC0-1.0" && (!author || !attribution))
      ) {
        rejectedMedia++;
        continue;
      }
      media.push({
        sourceExternalMediaId: mediaId,
        kind: "image",
        licenseCode: lic.code,
        licenseUrl: lic.url,
        author,
        rawAttribution: attribution,
        sourceMediaUrl,
      });
    }
    if (
      new Set(translations.map((translation) => translation.languageCode)).size !==
      translations.length
    ) {
      reject("ambiguous_translation_language");
      continue;
    }
    const hasDeclaredBaseLicense = row.baseLicense !== undefined;
    const baseLicense = hasDeclaredBaseLicense ? licenseInfo(row.baseLicense, licenses) : null;
    const baseAuthor = nonempty(row.baseAuthor) ?? nonempty(row.author);
    accepted.push({
      externalId: id,
      name: canonical.name,
      category: nonempty(object(row.category)?.name),
      licenseCode: hasDeclaredBaseLicense ? (baseLicense?.code ?? null) : canonical.licenseCode,
      licenseUrl: hasDeclaredBaseLicense ? (baseLicense?.url ?? null) : canonical.licenseUrl,
      author: hasDeclaredBaseLicense ? baseAuthor : canonical.author,
      rawAttribution: hasDeclaredBaseLicense
        ? nonempty(row.baseAttribution)
        : canonical.rawAttribution,
      sourceLicenseMetadata: JSON.stringify({
        canonicalNameLanguage: canonical.languageCode,
        canonicalNameLicense: canonical.licenseCode,
        declaredBaseLicense: baseLicense?.code ?? null,
        declaredBaseAuthor: baseAuthor,
        translationSourceUrl: canonical.sourceUrl,
        artifactSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
      sourceRecordUrl: `https://wger.de/api/v2/exerciseinfo/${id}/`,
      snapshotVersion: version,
      snapshotAt,
      canonicalNameLanguage: canonical.languageCode,
      translations,
      muscles: [...mapNamed("muscles", "primary"), ...mapNamed("muscles_secondary", "secondary")],
      equipment: mapNamed("equipment"),
      media,
    });
  }
  return {
    snapshotVersion: version,
    snapshotAt,
    artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    accepted,
    rejectedRecords: Object.values(reasons).reduce((sum, count) => sum + count, 0),
    rejectedTranslations,
    rejectedMedia,
    rejectedReasonCounts: reasons,
  };
}
