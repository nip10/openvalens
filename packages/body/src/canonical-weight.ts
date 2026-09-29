export type CanonicalWeightQualityFlag = string | null;

export type CanonicalWeightAutoEvent = {
  id: number;
  measuredAt: string;
  weightKg: number;
  qualityFlag?: CanonicalWeightQualityFlag;
};

export type CanonicalWeightOverride = {
  weightKg: number;
} | null;

export type CanonicalWeightResolverInput = {
  autoEvents: ReadonlyArray<CanonicalWeightAutoEvent>;
  override: CanonicalWeightOverride;
};

export type CanonicalWeightResolution = {
  source: "auto" | "override";
  weightKg: number;
  resolvedFromEventId: number | null;
} | null;

function isUsableWeight(weightKg: number): boolean {
  return Number.isFinite(weightKg) && weightKg > 0;
}

export function resolveCanonicalWeight({
  autoEvents,
  override,
}: CanonicalWeightResolverInput): CanonicalWeightResolution {
  if (override && isUsableWeight(override.weightKg)) {
    return {
      source: "override",
      weightKg: override.weightKg,
      resolvedFromEventId: null,
    };
  }

  const validAutoEvents = autoEvents.filter(
    (event) => event.qualityFlag !== "invalid" && isUsableWeight(event.weightKg),
  );
  if (validAutoEvents.length === 0) {
    return null;
  }

  const sortedForMedian = [...validAutoEvents].sort((a, b) => {
    if (a.weightKg !== b.weightKg) {
      return a.weightKg - b.weightKg;
    }

    if (a.measuredAt !== b.measuredAt) {
      return a.measuredAt.localeCompare(b.measuredAt);
    }

    return a.id - b.id;
  });

  const medianIndex = Math.floor((sortedForMedian.length - 1) / 2);
  const selected = sortedForMedian[medianIndex];
  if (!selected) return null;

  return {
    source: "auto",
    weightKg: selected.weightKg,
    resolvedFromEventId: selected.id,
  };
}
