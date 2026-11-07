import { useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react-native";
import { useState } from "react";
import { Image, Platform, View } from "react-native";

import { previewAssets, previewUrl } from "@/lib/exercises/media";
import { getServerUrl } from "@/lib/server/server-url";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * The exercise's first licensed image (#400/#401): a Workout Guide frame or
 * a wger photo, tinted to the ink colour (Workout Guide frames are
 * monochrome line art). Custom exercises and exercises without an image get
 * a neutral icon, never a made-up drawing. Decorative: the name is always
 * next to it, so it is hidden from screen readers.
 */
export function ExerciseThumbnail({
  exerciseId,
  size = 52,
  frame = 0,
  media,
}: {
  exerciseId: number | null | undefined;
  /** Media already in hand (search results carry it); skips the lookup. */
  media?: unknown;
  size?: number;
  /** Which Workout Guide frame (0–2) to show; falls back to the first. */
  frame?: number;
}) {
  const ink = useThemeColor("ink");
  const muted = useThemeColor("ink-3");
  const [failed, setFailed] = useState(false);
  const detail = useQuery({
    ...orpc.exerciseCatalog.get.queryOptions({ input: { id: exerciseId ?? 1 } }),
    enabled: media === undefined && exerciseId != null && exerciseId > 0,
    staleTime: 60 * 60_000,
  });
  const assets = previewAssets(
    media !== undefined ? media : (detail.data as { media?: unknown } | null | undefined)?.media,
  );
  const asset = assets[frame] ?? assets[0];
  const origin =
    Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : null;
  const url = asset && !failed ? previewUrl(asset, getServerUrl() ?? "", origin) : null;
  const tinted = asset?.source === "workout-guide";
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center overflow-hidden rounded-2xl border border-rule bg-sheet"
      style={{ width: size, height: size }}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          resizeMode="contain"
          onError={() => setFailed(true)}
          style={{
            width: size - 6,
            height: size - 6,
            ...(tinted ? { tintColor: ink } : null),
          }}
        />
      ) : (
        <Dumbbell size={Math.round(size * 0.42)} color={muted} strokeWidth={1.8} />
      )}
    </View>
  );
}
