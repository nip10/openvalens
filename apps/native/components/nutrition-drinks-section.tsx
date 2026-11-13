import type { DrinkSummaryWire } from "@openvalens/api/contracts/nutrition-drinks";
import {
  DRINKS_COPY,
  caffeineReferenceNote,
  describeCaffeineReference,
  describeStandardDrink,
  drinkCoverageText,
  drinkPresetLabel,
  formatAlcoholTotal,
  formatCaffeineTotal,
  formatStandardDrinks,
} from "@openvalens/api/presenters/drinks";
import {
  DIARY_COPY,
  SLOT_LABELS,
  mealSlotForLocalTime,
  newClientMutationId,
} from "@openvalens/api/presenters/nutrition-diary";
import { useLingui } from "@lingui/react/macro";
import { Button } from "heroui-native";
import { CupSoda } from "lucide-react-native";
import { useState } from "react";
import { AccessibilityInfo, Linking, Pressable, Text, View } from "react-native";

import { availablePresets, drinkTotalsState, presetLogInput } from "@/lib/nutrition/drinks";
import { DIARY_CACHE_PREFIX, type DiaryOutbox } from "@/lib/nutrition/sync";
import { useCacheFirst } from "@/lib/offline/sync";
import { orpc } from "@/utils/orpc";

import { InfoTip, Section } from "./bloom";

/**
 * Drinks (Issue #443) on mobile: presets that save a known catalog food at
 * once in the current meal, through the diary's durable outbox, and the
 * opt-in caffeine and alcohol day totals. Plain water is not part of this
 * section and is never added to anything here; there is no total hydration.
 */

function announce(message: string) {
  AccessibilityInfo.announceForAccessibility(message);
}

export function NutritionDrinksSection({
  localDate,
  timeZone,
  hideNumbers,
  pending,
  outbox,
}: {
  localDate: string;
  timeZone: string;
  hideNumbers: boolean;
  /** The day has changes waiting to sync, so the server totals may not include them yet. */
  pending: boolean;
  outbox: DiaryOutbox;
}) {
  const { t, i18n } = useLingui();
  const presets = useCacheFirst(
    `${DIARY_CACHE_PREFIX}drinks.presets`,
    orpc.nutritionDrinks.presets.queryOptions({ input: {} }),
  );
  const summary = useCacheFirst(
    `${DIARY_CACHE_PREFIX}drinks.summary:${localDate}`,
    orpc.nutritionDrinks.summary.queryOptions({ input: { localDate } }),
  );
  const [saved, setSaved] = useState<{ mutationId: string; text: string; name: string } | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const available = availablePresets(presets.data);

  const save = (preset: (typeof available)[number]) => {
    setNotice(null);
    const slot = mealSlotForLocalTime();
    const name = drinkPresetLabel(preset.key, i18n);
    const clientMutationId = newClientMutationId();
    const stored = outbox.enqueueForIntent(
      outbox.beginWrite(),
      presetLogInput(preset, { clientMutationId, localDate, timeZone, slot, name }),
    );
    if (!stored) {
      const message = i18n._(DRINKS_COPY.saveFailed);
      setNotice(message);
      announce(message);
      return;
    }
    const meal = i18n._(SLOT_LABELS[slot]);
    const text = t`Saved ${name} to ${meal} on ${localDate}`;
    setSaved({ mutationId: clientMutationId, text, name });
    announce(text);
  };

  const undo = () => {
    if (!saved) return;
    const removed = outbox.deleteEntry(
      outbox.beginWrite(),
      { kind: "pending", mutationId: saved.mutationId },
      newClientMutationId(),
    );
    if (!removed) return;
    const { name } = saved;
    announce(t`Entry removed. ${name}`);
    setSaved(null);
  };

  return (
    <Section
      icon={CupSoda}
      tone="food"
      sheet
      title={i18n._(DRINKS_COPY.title)}
      info={i18n._(DRINKS_COPY.intro)}
    >
      <View className="gap-4">
        {notice ? (
          <Text className="font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}

        {presets.isPending && !presets.data ? (
          <View className="h-20 rounded-2xl bg-paper-2" />
        ) : available.length === 0 ? (
          <Text className="font-sans text-sm text-ink-3">{i18n._(DRINKS_COPY.unavailable)}</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2" accessibilityLabel={i18n._(DRINKS_COPY.title)}>
            {available.map((preset) => (
              <Pressable
                key={preset.key}
                onPress={() => save(preset)}
                accessibilityRole="button"
                testID={`drink-preset-${preset.key}`}
                className="min-h-11 justify-center rounded-full border border-rule bg-sheet px-4 active:opacity-70"
              >
                <Text className="font-sans text-sm text-ink">
                  {drinkPresetLabel(preset.key, i18n)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {saved ? (
          <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-paper-2 px-4 py-3">
            <Text className="flex-1 font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
              {saved.text}
            </Text>
            <Button size="sm" variant="outline" onPress={undo}>
              <Button.Label>{i18n._(DIARY_COPY.undo)}</Button.Label>
            </Button>
          </View>
        ) : null}

        <DrinkTotals summary={summary.data} hideNumbers={hideNumbers} pending={pending} />
      </View>
    </Section>
  );
}

function SourceLink({ url }: { url: string }) {
  const { i18n } = useLingui();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => void Linking.openURL(url)}
      className="min-h-11 justify-center self-start"
    >
      <Text className="font-sans text-sm text-signal underline">{i18n._(DRINKS_COPY.source)}</Text>
    </Pressable>
  );
}

function Amount({ children }: { children: string }) {
  return (
    <Text
      className="font-sans text-base font-semibold text-ink"
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {children}
    </Text>
  );
}

function DrinkTotals({
  summary,
  hideNumbers,
  pending,
}: {
  summary: DrinkSummaryWire | undefined;
  hideNumbers: boolean;
  pending: boolean;
}) {
  const { i18n } = useLingui();
  const state = drinkTotalsState(summary, hideNumbers);
  if (state === "none" || !summary) return null;
  // Unknown or hidden preference fails closed: no amount is shown.
  if (state === "hidden")
    return <Text className="font-sans text-sm text-ink-3">{i18n._(DRINKS_COPY.hidden)}</Text>;

  const { caffeine, alcohol } = summary;
  const caffeineNote =
    caffeine.status === "ready" ? caffeineReferenceNote(caffeine.referenceNote) : null;
  const standardDrinks =
    alcohol.status === "ready" ? formatStandardDrinks(alcohol, i18n, false) : null;
  return (
    <View className="gap-3 rounded-2xl bg-paper-2 p-4">
      {caffeine.status === "ready" ? (
        <View className="gap-1">
          <Text className="font-sans text-sm font-semibold text-ink" accessibilityRole="header">
            {i18n._(DRINKS_COPY.caffeine)}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-2">
            <Amount>{formatCaffeineTotal(caffeine.total, i18n, false)}</Amount>
            {caffeine.total.atLeast ? <InfoTip>{i18n._(DRINKS_COPY.incomplete)}</InfoTip> : null}
          </View>
          <Text className="font-sans text-sm text-ink-3">
            {i18n._(drinkCoverageText(caffeine.total))}
          </Text>
          {caffeine.reference ? (
            <>
              <Text className="font-sans text-sm text-ink-3">
                {describeCaffeineReference(caffeine.reference, i18n)}
              </Text>
              <SourceLink url={caffeine.reference.url} />
            </>
          ) : caffeineNote ? (
            <Text className="font-sans text-sm text-ink-3">{i18n._(caffeineNote)}</Text>
          ) : null}
        </View>
      ) : null}
      {alcohol.status === "ready" ? (
        <View className="gap-1">
          <Text className="font-sans text-sm font-semibold text-ink" accessibilityRole="header">
            {i18n._(DRINKS_COPY.alcohol)}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-2">
            <Amount>{formatAlcoholTotal(alcohol.total, i18n, false)}</Amount>
            {standardDrinks ? (
              <Text
                className="font-sans text-sm text-ink-2"
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {`· ${standardDrinks}`}
              </Text>
            ) : null}
            {alcohol.total.atLeast ? <InfoTip>{i18n._(DRINKS_COPY.incomplete)}</InfoTip> : null}
          </View>
          <Text className="font-sans text-sm text-ink-3">
            {i18n._(drinkCoverageText(alcohol.total))}
          </Text>
          {alcohol.definition ? (
            <>
              <Text className="font-sans text-sm text-ink-3">
                {describeStandardDrink(alcohol.definition, i18n)}
              </Text>
              <SourceLink url={alcohol.definition.url} />
            </>
          ) : (
            <Text className="font-sans text-sm text-ink-3">{i18n._(DRINKS_COPY.noDefinition)}</Text>
          )}
        </View>
      ) : null}
      {pending ? (
        <Text className="font-sans text-sm text-ink-3">{i18n._(DRINKS_COPY.pendingSync)}</Text>
      ) : null}
      <Text className="font-sans text-sm text-ink-3">{i18n._(DRINKS_COPY.notAdvice)}</Text>
    </View>
  );
}
