import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComparisonMetric } from "@openvalens/api/reference-comparison-contract";
import { Spinner } from "heroui-native";
import { Footprints, HeartPulse, Moon, Scale } from "lucide-react-native";
import { Linking, Pressable, Text, View } from "react-native";

import {
  Details,
  ErrorState,
  type LucideIcon,
  Prose,
  Section,
  Sheet,
  type Tone,
  ToneIcon,
} from "@/components/bloom";
import { comparisonScreenModel, type ComparisonBlock } from "@/utils/comparison-screen";
import { orpc } from "@/utils/orpc";

/**
 * Issue #96 — reference comparisons on mobile. Same view model as the web
 * card (`utils/comparison-screen.ts` → `@openvalens/api/presenters/
 * reference-comparison`): own trend first, each comparison off until turned
 * on, the band or guideline range in words, the named source and its limits.
 * Every state is in text; blocks carry screen-reader labels and the toggles
 * expose their on/off state.
 */

const METRIC_LOOK: Record<ComparisonMetric, { icon: LucideIcon; tone: Tone }> = {
  resting_heart_rate: { icon: HeartPulse, tone: "heart" },
  sleep_duration: { icon: Moon, tone: "sleep" },
  active_minutes: { icon: Footprints, tone: "steps" },
};

function BlockView({
  block,
  pending,
  onToggle,
}: {
  block: ComparisonBlock;
  pending: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  const title = block.title;
  const toggle = block.toggleLabel;
  const look = METRIC_LOOK[block.key] ?? { icon: Scale, tone: "water" as const };
  return (
    <Sheet className="gap-4">
      <View accessible accessibilityLabel={block.accessibilityLabel} className="gap-3">
        <View className="flex-row items-start gap-3">
          <ToneIcon icon={look.icon} tone={look.tone} />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-sans text-base font-semibold text-ink" accessibilityRole="header">
              {block.title}
            </Text>
            {block.trendLines.map((line) => (
              <Text
                key={line}
                className="font-sans text-sm text-ink-2"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>
        {block.statusText || block.comparisonLines.length > 0 ? (
          <View className="gap-1 rounded-2xl bg-paper-2 px-4 py-3">
            {block.statusText ? (
              <Text className="font-sans text-sm text-ink-3">{block.statusText}</Text>
            ) : null}
            {block.comparisonLines.map((line) => (
              <Text
                key={line}
                className="font-sans text-sm text-ink"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          onPress={onToggle}
          disabled={pending}
          accessibilityRole="switch"
          accessibilityState={{ checked: block.optedIn, disabled: pending }}
          accessibilityLabel={t`${title}: ${toggle}`}
          className={`min-h-11 justify-center self-start rounded-full border px-4 active:opacity-70 ${block.optedIn ? "border-rule-2 bg-paper-2" : "border-rule-2 bg-sheet"}`}
        >
          <Text className="font-sans text-sm font-semibold text-ink">{block.toggleLabel}</Text>
        </Pressable>
      </View>
      {/* A consent disclosure: it stays on screen next to its toggle. */}
      {block.disclosure ? (
        <Text className="font-sans text-sm leading-relaxed text-ink-3">{block.disclosure}</Text>
      ) : null}
      <Details summary={block.sourceLabel}>
        <View className="gap-1.5">
          <Pressable onPress={() => void Linking.openURL(block.sourceUrl)} accessibilityRole="link">
            <Text className="font-sans text-sm text-ink underline">{block.sourceCitation}</Text>
          </Pressable>
          {block.sourceDetails.map((line) => (
            <Text key={line} className="font-sans text-sm text-ink-3">
              {line}
            </Text>
          ))}
          {block.notes.map((note) => (
            <Text key={note} className="font-sans text-sm text-ink-3">
              • {note}
            </Text>
          ))}
        </View>
      </Details>
    </Sheet>
  );
}

export function ReferenceComparisonsSection() {
  const queryClient = useQueryClient();
  const { t, i18n } = useLingui();
  const comparisons = useQuery(orpc.comparison.get.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.comparison.updateSettings.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.comparison.key() }),
    }),
  );

  if (comparisons.isPending)
    return (
      <Sheet className="h-40 items-center justify-center">
        <Spinner />
      </Sheet>
    );
  if (comparisons.isError || !comparisons.data)
    return (
      <Pressable
        onPress={() => void comparisons.refetch()}
        className="min-h-11 justify-center"
        accessibilityRole="button"
      >
        <ErrorState
          title={
            <Trans>
              Could not load reference comparisons. <Text className="underline">Retry</Text>
            </Trans>
          }
        />
      </Pressable>
    );

  const model = comparisonScreenModel(comparisons.data, i18n);
  return (
    <Section
      icon={Scale}
      tone="water"
      title={model.title}
      info={
        <>
          <Prose>{model.intro}</Prose>
          <Prose>{model.noOtherPeople}</Prose>
          <Prose className="text-sm text-ink-3">{model.versionText}</Prose>
        </>
      }
    >
      <Text className="font-sans text-sm leading-relaxed text-ink-3">{model.limits}</Text>
      {model.withheldText ? (
        <Sheet className="p-4">
          <Text className="font-sans text-base text-ink-2">{model.withheldText}</Text>
        </Sheet>
      ) : null}
      {update.isError ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not update the comparison setting.`}
        </Text>
      ) : null}
      {model.blocks.map((block) => (
        <BlockView
          key={block.key}
          block={block}
          pending={update.isPending}
          onToggle={() => update.mutate({ metric: block.key, enabled: !block.optedIn })}
        />
      ))}
      <Details summary={model.notComparedTitle}>
        <View className="gap-1">
          {model.notCompared.map((line) => (
            <Text key={line} className="font-sans text-sm text-ink-3">
              • {line}
            </Text>
          ))}
        </View>
      </Details>
    </Section>
  );
}
