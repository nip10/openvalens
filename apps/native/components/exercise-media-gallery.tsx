import { ph } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Image, Linking, Platform, Text, View } from "react-native";

import { MuscleGuide } from "@/components/muscle-guide";
import { previewAssets, previewUrl, safeHttpUrl } from "@/lib/exercises/media";
import { getServerUrl } from "@/lib/server/server-url";

/** Every licensed image of an exercise with its full licence text (#93); falls back to the muscle guide. */
export function ExerciseMediaGallery({
  exerciseName,
  media,
  muscles,
}: {
  exerciseName: string;
  media: unknown;
  muscles: Array<{
    name: string;
    role?: string | null;
    location?: string | null;
    externalMuscleId?: string | null;
  }>;
}) {
  const { t } = useLingui();
  const assets = previewAssets(media);
  const [browserOrigin, setBrowserOrigin] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, "loaded" | "failed">>({});
  useEffect(() => {
    if (Platform.OS === "web") setBrowserOrigin(window.location.origin);
  }, []);
  if (assets.length === 0)
    return (
      <View className="gap-3">
        <Text className="font-sans rounded-2xl border border-dashed border-rule-2 p-4 text-center text-xs text-ink-3">
          {Array.isArray(media) && media.length > 0
            ? t`Preview unavailable because image license details are incomplete.`
            : t`No preview image is provided.`}
        </Text>
        <MuscleGuide muscles={muscles} />
      </View>
    );
  if (Platform.OS === "web" && !browserOrigin)
    return (
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans rounded-2xl border border-dashed border-rule-2 p-4 text-center text-xs text-ink-3"
      >
        <Trans>Preparing preview…</Trans>
      </Text>
    );
  const urls = assets.map((asset) => ({
    asset,
    url: previewUrl(asset, getServerUrl() ?? "", browserOrigin),
  }));
  return (
    <View className="gap-4" accessibilityLabel={t`${exerciseName} previews`}>
      {urls.map(({ asset, url }, index) => (
        <View key={asset.assetId} className="gap-2">
          <View
            className="relative overflow-hidden rounded-2xl border border-rule bg-paper-2"
            style={{ aspectRatio: asset.width / asset.height, maxHeight: 320 }}
          >
            {!url ? (
              <View className="flex-1 items-center justify-center p-4">
                <Text className="font-sans text-center text-xs text-ink-3">
                  <Trans>Preview unavailable on this connection.</Trans>
                </Text>
              </View>
            ) : states[asset.assetId] === "failed" ? (
              <View className="flex-1 items-center justify-center p-4">
                <Text
                  accessibilityLiveRegion="polite"
                  className="font-sans text-center text-xs text-ink-3"
                >
                  <Trans>Preview unavailable.</Trans>
                </Text>
              </View>
            ) : (
              <>
                <View className="absolute inset-0 items-center justify-center">
                  <Text accessibilityLiveRegion="polite" className="font-sans text-xs text-ink-3">
                    {states[asset.assetId] === "loaded" ? "" : t`Loading preview…`}
                  </Text>
                </View>
                <Image
                  source={{ uri: url }}
                  accessibilityRole="image"
                  accessibilityLabel={t`${exerciseName} preview ${ph({ number: index + 1 })}`}
                  resizeMode="contain"
                  onLoad={() => setStates((current) => ({ ...current, [asset.assetId]: "loaded" }))}
                  onError={() =>
                    setStates((current) => ({ ...current, [asset.assetId]: "failed" }))
                  }
                  className={`h-full w-full ${states[asset.assetId] === "loaded" ? "" : "opacity-0"}`}
                />
              </>
            )}
          </View>
          <View className="gap-1">
            <Text className="font-sans text-xs text-ink-3">
              {asset.author
                ? t`License: ${ph({ license: asset.license })}, ${ph({ author: asset.author })}`
                : t`License: ${ph({ license: asset.license })}`}
            </Text>
            {asset.attribution ? (
              <Text className="font-sans text-xs text-ink-3">{asset.attribution}</Text>
            ) : null}
            {asset.transformationNotice ? (
              <Text className="font-sans text-xs text-ink-3">{asset.transformationNotice}</Text>
            ) : null}
            {safeHttpUrl(asset.licenseUrl) ? (
              <Text
                onPress={() => void Linking.openURL(safeHttpUrl(asset.licenseUrl)!)}
                accessibilityRole="link"
                className="min-h-11 text-xs font-semibold text-signal"
              >
                <Trans>License details</Trans>
              </Text>
            ) : null}
            {safeHttpUrl(asset.sourceUrl) ? (
              <Text
                onPress={() => void Linking.openURL(safeHttpUrl(asset.sourceUrl)!)}
                accessibilityRole="link"
                className="min-h-11 text-xs font-semibold text-signal"
              >
                <Trans>Image source</Trans>
              </Text>
            ) : null}
          </View>
        </View>
      ))}
      {urls.every(({ asset, url }) => !url || states[asset.assetId] === "failed") ? (
        <MuscleGuide muscles={muscles} />
      ) : null}
    </View>
  );
}
