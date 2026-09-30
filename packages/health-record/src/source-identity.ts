import type { DataSourceIdentity, SourceIdentityInput, SourceIdentityTuple } from "./types";

/**
 * Source identity (Issue #17, MVP).
 *
 * Minimal port of
 * `anchovy/apps/web/src/lib/v2/health-record/source-identity.ts`.
 * The helpers compose a stable `sourceKey` from a `SourceIdentityTuple`
 * (or a raw string passthrough) and decide whether the populated
 * identity fields are rich enough to derive a `canonicalSourceKey`.
 *
 * Pure — no DB calls.
 */

function normalizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build the normalized source key from the rich identity tuple. The
 * segments are joined with `|` so the tuple `("oura", null, null, null,
 * null, "Oura", null)` and `("oura", null, null, null, null, "OURA",
 * null)` produce identical keys (case is normalized at segment
 * level).
 */
export function buildSourceIdentityKey(input: SourceIdentityInput): string {
  if (typeof input === "string") {
    return input;
  }

  return [
    input.provider,
    input.importChannel,
    input.deviceType,
    input.deviceModel,
    input.softwareVersion,
    input.originalSourceName,
    input.sourceAppId,
  ]
    .map((value) => normalizeSegment(readString(value) ?? ""))
    .join("|");
}

/**
 * Read the rich identity tuple into a normalized record (trimmed
 * strings, nulls preserved). Defensive — callers sometimes hand
 * partially-populated tuples.
 */
export function readSourceIdentityTuple(input: SourceIdentityInput): SourceIdentityTuple {
  if (typeof input === "string") {
    return {};
  }

  const pick = (key: keyof SourceIdentityTuple): string | null => {
    const value = input[key];
    return readString(value);
  };

  const result: SourceIdentityTuple = {};
  const provider = pick("provider");
  if (provider != null) result.provider = provider;
  const importChannel = pick("importChannel");
  if (importChannel != null) result.importChannel = importChannel;
  const deviceType = pick("deviceType");
  if (deviceType != null) result.deviceType = deviceType;
  const deviceModel = pick("deviceModel");
  if (deviceModel != null) result.deviceModel = deviceModel;
  const softwareVersion = pick("softwareVersion");
  if (softwareVersion != null) result.softwareVersion = softwareVersion;
  const originalSourceName = pick("originalSourceName");
  if (originalSourceName != null) result.originalSourceName = originalSourceName;
  const sourceAppId = pick("sourceAppId");
  if (sourceAppId != null) result.sourceAppId = sourceAppId;
  const existingSourceKey = pick("existingSourceKey");
  if (existingSourceKey != null) result.existingSourceKey = existingSourceKey;

  return result;
}

export function buildDataSourceIdentity(input: SourceIdentityInput): DataSourceIdentity {
  const tuple = typeof input === "string" ? { existingSourceKey: input } : input;
  const populatedRichIdentityFields = [
    tuple.importChannel,
    tuple.deviceType,
    tuple.deviceModel,
    tuple.softwareVersion,
    tuple.originalSourceName,
    tuple.sourceAppId,
  ].filter((value): value is string => value != null && value.length > 0);

  const canonicalSourceKey =
    populatedRichIdentityFields.length >= 2 ? buildSourceIdentityKey(tuple) : undefined;

  return {
    ...tuple,
    sourceKey: tuple.existingSourceKey ?? canonicalSourceKey ?? buildSourceIdentityKey(tuple),
    canonicalSourceKey,
  };
}
