import { Trans, useLingui } from "@lingui/react/macro";
import {
  resolveExerciseGuideMuscle,
  type ExerciseGuideMuscle,
  type GuideRegion,
} from "@openvalens/api/presenters/exercise-muscle-guide";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { Text, View } from "react-native";

const shapes: Record<GuideRegion, [number, number, number, number][]> = {
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
    <Svg
      width={112}
      height={135}
      viewBox="0 0 100 120"
      accessibilityRole="image"
      accessibilityLabel={
        side === "front" ? t`front view muscle illustration` : t`back view muscle illustration`
      }
    >
      <Circle cx="50" cy="10" r="7" fill="#94a3b8" opacity=".25" />
      <Path
        d="M42 19 Q50 16 58 19 L72 28 77 56 68 58 65 43 65 66 62 116 53 116 50 77 47 116 38 116 35 66 35 43 32 58 23 56 28 28Z"
        fill="#94a3b8"
        fillOpacity=".18"
        stroke="#64748b"
        strokeWidth="1.5"
      />
      {(Object.entries(shapes) as [GuideRegion, [number, number, number, number][]][])
        .filter(([r]) => regions.has(r))
        .flatMap(([r, rects]) =>
          rects.map(([x, y, width, height], i) => (
            <Rect
              key={`${r}-${i}`}
              x={x}
              y={y}
              width={width}
              height={height}
              rx="5"
              fill="#0f766e"
              fillOpacity=".85"
            />
          )),
        )}
    </Svg>
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
  const primary = muscles.filter((m) => m.role?.toLowerCase() === "primary"),
    secondary = muscles.filter((m) => m.role?.toLowerCase() === "secondary"),
    unknown = mapped.filter((x) => !x.region);
  // Muscle names come from the source data (wger) and are shown as listed.
  const noneListed = t`None listed`;
  const listedNames = muscles.map((m) => m.name).join(", ") || noneListed;
  const primaryNames = primary.map((x) => x.name).join(", ") || noneListed;
  const secondaryNames = secondary.map((x) => x.name).join(", ") || noneListed;
  const unknownNames = unknown.map((x) => x.muscle.name).join(", ");
  if (!front.size && !back.size)
    return (
      <View
        accessibilityLabel={t`Muscle guide`}
        className="gap-2 rounded-2xl border border-rule bg-sheet p-4"
      >
        <Text className="font-sans text-sm font-semibold text-ink-2">
          <Trans>Muscle guide</Trans>
        </Text>
        <Text className="font-sans text-xs text-ink-3">
          <Trans>Illustration of muscles listed by the source</Trans>
        </Text>
        <Text className="font-sans text-xs text-ink">
          <Trans>Source-listed muscles: {listedNames}</Trans>
        </Text>
        <Text className="font-sans text-xs text-ink">
          <Trans>Primary: {primaryNames}</Trans>
        </Text>
        <Text className="font-sans text-xs text-ink">
          <Trans>Secondary: {secondaryNames}</Trans>
        </Text>
        <Text className="font-sans text-xs text-ink-3">
          <Trans>No matching diagram mapping is available; no anatomy is highlighted.</Trans>
        </Text>
      </View>
    );
  return (
    <View
      accessibilityLabel={t`Muscle guide`}
      className="gap-2 rounded-2xl border border-rule bg-sheet p-4"
    >
      <Text className="font-sans text-sm font-semibold text-ink-2">
        <Trans>Muscle guide</Trans>
      </Text>
      <Text className="font-sans text-xs text-ink-3">
        <Trans>Illustration of muscles listed by the source</Trans>
      </Text>
      <View className="flex-row flex-wrap justify-center gap-2">
        <View className="items-center">
          <Figure side="front" regions={front} />
          <Text className="font-sans text-xs text-ink">
            <Trans>Front</Trans>
          </Text>
        </View>
        <View className="items-center">
          <Figure side="back" regions={back} />
          <Text className="font-sans text-xs text-ink">
            <Trans>Back</Trans>
          </Text>
        </View>
      </View>
      <Text className="font-sans text-xs text-ink">
        <Trans>Primary: {primaryNames}</Trans>
      </Text>
      <Text className="font-sans text-xs text-ink">
        <Trans>Secondary: {secondaryNames}</Trans>
      </Text>
      {unknown.length > 0 && (
        <Text accessibilityRole="text" className="font-sans text-xs text-ink-3">
          <Trans>
            No matching diagram mapping for: {unknownNames}. Names are shown without highlighting.
          </Trans>
        </Text>
      )}
    </View>
  );
}
