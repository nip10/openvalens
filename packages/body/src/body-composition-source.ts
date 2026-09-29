export type BodyFatCandidate = {
  date: string;
  bodyFatPct: number | null;
};

type BodyFatSourceKind = "dexa" | "smart_scale" | "manual";

export type SourceConfidence = 1 | 0.8 | 0.5;

const SOURCE_CONFIDENCE: Record<BodyFatSourceKind, SourceConfidence> = {
  dexa: 1,
  smart_scale: 0.8,
  manual: 0.5,
};

export type BodyFatSource = {
  source: BodyFatSourceKind;
  date: string;
  measuredDate: string;
  // Source-prior method reliability, independent of the measured value itself.
  confidence: SourceConfidence;
  bodyFatPct: number;
};

export function pickBodyFatSource({
  dexa,
  smartScale = null,
  manual,
}: {
  dexa: BodyFatCandidate | null;
  smartScale?: BodyFatCandidate | null;
  manual: BodyFatCandidate | null;
}): BodyFatSource | null {
  const candidates: Array<{
    source: BodyFatSourceKind;
    candidate: BodyFatCandidate | null;
  }> = [
    { source: "dexa", candidate: dexa },
    { source: "smart_scale", candidate: smartScale },
    { source: "manual", candidate: manual },
  ];

  let winner: BodyFatSource | null = null;

  for (const { source, candidate } of candidates) {
    if (candidate?.bodyFatPct == null) {
      continue;
    }

    const bodyFatSource: BodyFatSource = {
      source,
      date: candidate.date,
      measuredDate: candidate.date,
      confidence: SOURCE_CONFIDENCE[source],
      bodyFatPct: candidate.bodyFatPct,
    };

    if (winner == null || bodyFatSource.confidence > winner.confidence) {
      winner = bodyFatSource;
    }
  }

  return winner;
}
