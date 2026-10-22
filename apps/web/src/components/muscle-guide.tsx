import {
  resolveExerciseGuideMuscle,
  type ExerciseGuideMuscle,
  type GuideRegion,
} from "@openvalens/api/presenters/exercise-muscle-guide";

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
  return (
    <svg
      viewBox="0 0 100 120"
      role="img"
      aria-label={`${side} view muscle illustration`}
      className="h-36 w-28 text-muted-foreground"
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
              className="fill-primary"
              opacity=".8"
            />
          )),
        )}
    </svg>
  );
}
export function MuscleGuide({ muscles }: { muscles: ExerciseGuideMuscle[] }) {
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
  if (!front.size && !back.size)
    return (
      <section className="grid gap-2 rounded-lg border bg-muted/20 p-3" aria-label="Muscle guide">
        <h3 className="text-sm font-medium">Muscle guide</h3>
        <p className="text-xs text-muted-foreground">
          Illustration of muscles listed by the source
        </p>
        <p className="text-xs">
          <strong>Source-listed muscles:</strong>{" "}
          {muscles.map((m) => m.name).join(", ") || "None listed"}
        </p>
        <p className="text-xs">
          <strong>Primary:</strong> {primary.map((x) => x.name).join(", ") || "None listed"}
        </p>
        <p className="text-xs">
          <strong>Secondary:</strong> {secondary.map((x) => x.name).join(", ") || "None listed"}
        </p>
        <p role="note" className="text-xs text-muted-foreground">
          No matching diagram mapping is available; no anatomy is highlighted.
        </p>
      </section>
    );
  return (
    <section className="grid gap-2 rounded-lg border bg-muted/20 p-3" aria-label="Muscle guide">
      <h3 className="text-sm font-medium">Muscle guide</h3>
      <p className="text-xs text-muted-foreground">Illustration of muscles listed by the source</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="text-center">
          <Figure side="front" regions={front} />
          <span className="text-xs">Front</span>
        </div>
        <div className="text-center">
          <Figure side="back" regions={back} />
          <span className="text-xs">Back</span>
        </div>
      </div>
      <div className="grid gap-1 text-xs">
        <p>
          <strong>Primary:</strong> {primary.map((x) => x.name).join(", ") || "None listed"}
        </p>
        <p>
          <strong>Secondary:</strong> {secondary.map((x) => x.name).join(", ") || "None listed"}
        </p>
      </div>
      {unresolved.length ? (
        <p role="note" className="text-xs text-muted-foreground">
          No matching diagram mapping for: {unresolved.map((x) => x.muscle.name).join(", ")}. Names
          are shown without highlighting.
        </p>
      ) : null}
    </section>
  );
}
