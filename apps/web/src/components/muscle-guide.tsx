import { Trans, useLingui } from "@lingui/react/macro";
import {
  resolveExerciseGuideMuscle,
  type ExerciseGuideMuscle,
  type GuideRegion,
} from "@openvalens/api/presenters/exercise-muscle-guide";
import { PersonStanding } from "lucide-react";

import { InfoTip, ToneIcon } from "@/components/page";

const parts: Record<GuideRegion, [number, number, number, number][]> = {
  Shoulders: [
    [27, 27, 13, 11],
    [60, 27, 13, 11],
  ],
  "Upper arms": [
    [21, 40, 10, 19],
    [69, 40, 10, 19],
  ],
  Hamstrings: [
    [35, 80, 13, 20],
    [52, 80, 13, 20],
  ],
  Calves: [
    [37, 101, 10, 16],
    [53, 101, 10, 16],
  ],
  Glutes: [[36, 65, 28, 15]],
  Lats: [
    [30, 42, 15, 22],
    [55, 42, 15, 22],
  ],
  Obliques: [
    [29, 49, 9, 19],
    [62, 49, 9, 19],
  ],
  Chest: [[35, 35, 30, 13]],
  Quads: [
    [35, 75, 13, 25],
    [52, 75, 13, 25],
  ],
  Abs: [[40, 49, 20, 24]],
  Serratus: [
    [31, 45, 7, 12],
    [62, 45, 7, 12],
  ],
  Trapezius: [[35, 27, 30, 14]],
};
function Figure({ side, regions }: { side: "front" | "back"; regions: Set<GuideRegion> }) {
  const { t } = useLingui();
  return (
    <svg
      viewBox="0 0 100 120"
      role="img"
      aria-label={
        side === "front" ? t`front view muscle illustration` : t`back view muscle illustration`
      }
      className="h-40 w-32 text-ink-3"
    >
      <circle cx="50" cy="10" r="7" fill="currentColor" opacity=".16" />
      <path
        d="M42 19 Q50 16 58 19 L72 28 77 56 68 58 65 43 65 66 62 116 53 116 50 77 47 116 38 116 35 66 35 43 32 58 23 56 28 28Z"
        fill="currentColor"
        opacity=".12"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {(Object.entries(parts) as [GuideRegion, [number, number, number, number][]][])
        .filter(([region]) => regions.has(region))
        .flatMap(([region, rects]) =>
          rects.map(([x, y, w, h], i) => (
            <rect
              key={`${region}-${i}`}
              x={x}
              y={y}
              width={w}
              height={h}
              rx="5"
              className="fill-steps"
              opacity=".85"
            />
          )),
        )}
    </svg>
  );
}
export function MuscleGuide({ muscles }: { muscles: ExerciseGuideMuscle[] }) {
  const { t } = useLingui();
  const mapped = muscles.map((muscle) => ({ muscle, region: resolveExerciseGuideMuscle(muscle) }));
  const front = new Set(
    mapped.filter((x) => x.region?.side === "front").map((x) => x.region!.region),
  );
  const back = new Set(
    mapped.filter((x) => x.region?.side === "back").map((x) => x.region!.region),
  );
  const primary = muscles.filter((m) => m.role?.toLowerCase() === "primary");
  const secondary = muscles.filter((m) => m.role?.toLowerCase() === "secondary");
  const unresolved = mapped.filter((x) => !x.region);
  // Muscle names come from the source data (wger) and are shown as listed.
  const noneListed = t`None listed`;
  const listedNames = muscles.map((m) => m.name).join(", ") || noneListed;
  const primaryNames = primary.map((x) => x.name).join(", ") || noneListed;
  const secondaryNames = secondary.map((x) => x.name).join(", ") || noneListed;
  const unresolvedNames = unresolved.map((x) => x.muscle.name).join(", ");
  if (!front.size && !back.size)
    return (
      <section className="grid gap-3 rounded-2xl bg-paper-2 px-4 py-4" aria-label={t`Muscle guide`}>
        <h3 className="flex items-center gap-2 font-body text-sm font-semibold text-ink">
          <ToneIcon icon={PersonStanding} tone="steps" size="sm" />
          <Trans>Muscle guide</Trans>
          <InfoTip>
            <Trans>Illustration of muscles listed by the source</Trans>
          </InfoTip>
        </h3>
        <p className="text-sm text-ink-2">
          <Trans>
            <strong>Source-listed muscles:</strong> {listedNames}
          </Trans>
        </p>
        <p className="text-sm text-ink-2">
          <Trans>
            <strong>Primary:</strong> {primaryNames}
          </Trans>
        </p>
        <p className="text-sm text-ink-2">
          <Trans>
            <strong>Secondary:</strong> {secondaryNames}
          </Trans>
        </p>
        <p role="note" className="max-w-[60ch] text-sm text-ink-3">
          <Trans>No matching diagram mapping is available; no anatomy is highlighted.</Trans>
        </p>
      </section>
    );
  return (
    <section className="grid gap-3 rounded-2xl bg-paper-2 px-4 py-4" aria-label={t`Muscle guide`}>
      <h3 className="flex items-center gap-2 font-body text-sm font-semibold text-ink">
        <ToneIcon icon={PersonStanding} tone="steps" size="sm" />
        <Trans>Muscle guide</Trans>
        <InfoTip>
          <Trans>Illustration of muscles listed by the source</Trans>
        </InfoTip>
      </h3>
      <div className="flex flex-wrap items-center justify-center gap-8 rounded-2xl bg-card py-3">
        <div className="grid justify-items-center gap-1">
          <Figure side="front" regions={front} />
          <span className="text-sm text-ink-3">
            <Trans>Front</Trans>
          </span>
        </div>
        <div className="grid justify-items-center gap-1">
          <Figure side="back" regions={back} />
          <span className="text-sm text-ink-3">
            <Trans>Back</Trans>
          </span>
        </div>
      </div>
      <div className="grid gap-1 text-sm text-ink-2">
        <p>
          <Trans>
            <strong>Primary:</strong> {primaryNames}
          </Trans>
        </p>
        <p>
          <Trans>
            <strong>Secondary:</strong> {secondaryNames}
          </Trans>
        </p>
      </div>
      {unresolved.length ? (
        <p role="note" className="max-w-[60ch] text-sm text-ink-3">
          <Trans>
            No matching diagram mapping for: {unresolvedNames}. Names are shown without
            highlighting.
          </Trans>
        </p>
      ) : null}
    </section>
  );
}
