// Source: anchovy/apps/web/src/lib/export/extractors/clinical.ts#selectLatestBodyWeight
// Pure helpers for the `body` extractor. The shape mirrors the source's
// legacy / canonical snapshot union: prefer the canonical daily row, otherwise
// fall back to the legacy `weight_checkin` row. Both shapes are typed against
// the actual `packages/db` table selections; the body package already returns
// the canonical/legacy envelope via `getLatestWeight`/`getLatestCanonicalWeight`.
export type LatestCanonicalBodyWeight = {
  date: string;
  weightKg: number;
};

export type LatestLegacyBodyWeight = {
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
};

export function selectLatestBodyWeight(
  canonical: LatestCanonicalBodyWeight | undefined,
  legacy: LatestLegacyBodyWeight | undefined,
): LatestLegacyBodyWeight | null {
  if (canonical) {
    return {
      date: canonical.date,
      weightKg: canonical.weightKg,
      bodyFatPct: null,
    };
  }
  if (legacy) return legacy;
  return null;
}

export function maxIsoDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}
