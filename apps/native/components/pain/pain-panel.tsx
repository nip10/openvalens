import { useLingui } from "@lingui/react/macro";
import {
  PAIN_COPY,
  PAIN_TYPE_LABELS,
  PAIN_TYPE_OPTIONS,
  painEntrySummary,
  painRegionText,
  painWorkoutFact,
} from "@openvalens/api/presenters/pain";
import {
  browserTimeZone,
  localInputToIso,
  nowLocalInput,
} from "@openvalens/api/presenters/tracker-draft";
import {
  PAIN_LIMITS,
  PAIN_RATING_MAX,
  PAIN_RATING_MIN,
  PAIN_REGION_IDS,
  type PainType,
} from "@openvalens/pain/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, cn } from "heroui-native";
import { Bot, History, Info, Lock, NotebookPen, X } from "lucide-react-native";
import { useState } from "react";
import { AccessibilityInfo, Alert, Pressable, Switch, Text, TextInput, View } from "react-native";

import { ErrorState, Icon, Section, Sheet, ToneIcon } from "@/components/bloom";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import { painKeys, type PainSubject } from "@/lib/pain/screen";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * The pain layer's panel on mobile (#442): the fixed notice, the opt-in, the
 * log form, a region's history and the settings. Same copy and presenters as
 * the web panel. The copy is a record of what the member rated: nothing here
 * changes with the value.
 */

const INPUT_CLASS =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 font-sans text-base text-ink";

/** Always shown on the pain layer, whatever the ratings. */
export function PainNotice() {
  const { i18n } = useLingui();
  return (
    <Sheet className="flex-row items-start gap-3 p-4">
      <ToneIcon icon={Info} tone="signal" size="sm" />
      <Text className="min-w-0 flex-1 font-sans text-sm leading-relaxed text-ink-2">
        {i18n._(PAIN_COPY.notice)}
      </Text>
    </Sheet>
  );
}

export function PainOff({
  onTurnOn,
  saving,
  failed,
}: {
  onTurnOn: () => void;
  saving: boolean;
  failed: boolean;
}) {
  const { t, i18n } = useLingui();
  return (
    <Section icon={Lock} tone="weight" title={i18n._(PAIN_COPY.offTitle)} sheet>
      <Text className="font-sans text-base leading-relaxed text-ink-2">
        {i18n._(PAIN_COPY.offBody)}
      </Text>
      <Button isDisabled={saving} onPress={onTurnOn}>
        <Button.Label>{saving ? t`Saving…` : i18n._(PAIN_COPY.turnOn)}</Button.Label>
      </Button>
      {failed ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not update this setting. Try again.`}
        </Text>
      ) : null}
    </Section>
  );
}

/** A row of choices read as a radio group: one is checked at a time. */
function Choices<T extends string | number>({
  label,
  value,
  options,
  onChange,
  round = false,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Number chips (the 0–10 rating). */
  round?: boolean;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="flex-row flex-wrap gap-2"
    >
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked }}
            onPress={() => onChange(option.value)}
            className={cn(
              "min-h-11 items-center justify-center rounded-full border active:opacity-70",
              round ? "min-w-11 px-2" : "px-4",
              checked ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-paper-2",
            )}
          >
            <Text
              className={cn(
                "font-sans text-sm",
                checked ? "font-semibold text-sidebar-accent-foreground" : "font-medium text-ink-2",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const RATINGS = Array.from(
  { length: PAIN_RATING_MAX - PAIN_RATING_MIN + 1 },
  (_, index) => PAIN_RATING_MIN + index,
);

/**
 * Logs one rating for one or more regions: one entry each. Starts with the
 * region selected on the map; more can be added from the list.
 */
export function PainLogForm({
  subject,
  selected,
}: {
  subject: PainSubject;
  selected: string | null;
}) {
  const { t, i18n } = useLingui();
  const qc = useQueryClient();
  const placeholder = useThemeColor("ink-3");
  const [regions, setRegions] = useState<string[]>(selected ? [selected] : []);
  const [adding, setAdding] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [type, setType] = useState<PainType | "">("");
  const [when, setWhen] = useState(nowLocalInput);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const others = PAIN_REGION_IDS.filter((region) => !regions.includes(region));
  const loggedAt = localInputToIso(when);

  const report = (message: string) => {
    setStatus(message);
    AccessibilityInfo.announceForAccessibility(message);
  };
  const save = useMutation({
    mutationFn: () =>
      client.pain.log({
        regions,
        rating: rating!,
        type: type || null,
        timeZone: browserTimeZone(),
        note: note.trim() ? note.trim() : null,
        ...(loggedAt ? { loggedAt } : {}),
      }),
    onSuccess: (created) => {
      const count = created.length;
      report(count === 1 ? t`Saved.` : t`Saved for ${count} regions.`);
      setRating(null);
      setNote("");
      setWhen(nowLocalInput());
      void qc.invalidateQueries({ queryKey: painKeys(subject).all });
    },
    onError: () => report(t`Could not save. Check your connection and try again.`),
  });

  const canSave = regions.length > 0 && rating !== null && Boolean(loggedAt) && !save.isPending;

  return (
    <Section icon={NotebookPen} tone="weight" title={t`Log pain`} sheet>
      <View className="gap-4">
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-sans text-sm font-semibold text-ink-2">
            {t`Where`}
          </Text>
          {regions.length ? (
            <View className="flex-row flex-wrap gap-2">
              {regions.map((region) => {
                const name = painRegionText(region, i18n);
                return (
                  <View
                    key={region}
                    className="flex-row items-center gap-1 rounded-full bg-paper-2 py-1 pl-3 pr-1"
                  >
                    <Text className="font-sans text-sm text-ink">{name}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t`Remove ${name}`}
                      onPress={() => setRegions(regions.filter((item) => item !== region))}
                      className="h-11 w-11 items-center justify-center rounded-full active:opacity-70"
                    >
                      <Icon icon={X} size={16} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text className="font-sans text-sm text-ink-3">
              {t`Select a region on the map, or add one from the list.`}
            </Text>
          )}
          {regions.length < PAIN_LIMITS.regionsPerLog ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: adding }}
                onPress={() => setAdding((open) => !open)}
                className="min-h-11 justify-center self-start rounded-full border border-rule-2 bg-paper-2 px-4 active:opacity-70"
              >
                <Text className="font-sans text-sm font-medium text-ink-2">{t`Add a region`}</Text>
              </Pressable>
              {adding ? (
                <View accessibilityLabel={t`Choose a region`} className="flex-row flex-wrap gap-2">
                  {others.map((region) => (
                    <Pressable
                      key={region}
                      accessibilityRole="button"
                      onPress={() => {
                        setRegions([...regions, region]);
                        setAdding(false);
                      }}
                      className="min-h-11 justify-center rounded-full border border-rule-2 bg-sheet px-3 active:opacity-70"
                    >
                      <Text className="font-sans text-sm text-ink-2">
                        {painRegionText(region, i18n)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        <View className="gap-2">
          <Text className="font-sans text-sm font-semibold text-ink-2">
            {i18n._(PAIN_COPY.rating)}
          </Text>
          <Choices
            label={i18n._(PAIN_COPY.rating)}
            value={rating}
            onChange={setRating}
            round
            options={RATINGS.map((value) => ({ value, label: String(value) }))}
          />
        </View>

        <View className="gap-2">
          <Text className="font-sans text-sm font-semibold text-ink-2">{t`Type (optional)`}</Text>
          <Choices
            label={t`Type (optional)`}
            value={type}
            onChange={setType}
            options={[
              { value: "" as const, label: t`No type` },
              ...PAIN_TYPE_OPTIONS.map((option) => ({
                value: option,
                label: i18n._(PAIN_TYPE_LABELS[option]),
              })),
            ]}
          />
        </View>

        <View className="gap-2">
          <Text className="font-sans text-sm font-semibold text-ink-2">{t`When`}</Text>
          <TextInput
            accessibilityLabel={t`When`}
            value={when}
            onChangeText={setWhen}
            placeholder="YYYY-MM-DDTHH:MM"
            placeholderTextColor={placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            className={INPUT_CLASS}
          />
          {!loggedAt ? (
            <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
              {t`Enter a real local date and time.`}
            </Text>
          ) : null}
        </View>

        <View className="gap-2">
          <Text className="font-sans text-sm font-semibold text-ink-2">{t`Note (optional)`}</Text>
          <TextInput
            accessibilityLabel={t`Note (optional)`}
            value={note}
            onChangeText={setNote}
            maxLength={PAIN_LIMITS.noteLength}
            multiline
            placeholderTextColor={placeholder}
            className={cn(INPUT_CLASS, "min-h-20 py-2")}
          />
        </View>

        <View className="flex-row flex-wrap items-center gap-3">
          <Button isDisabled={!canSave} onPress={() => canSave && save.mutate()}>
            <Button.Label>{save.isPending ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          {status ? (
            <Text
              accessibilityLiveRegion="polite"
              className="min-w-0 shrink font-sans text-sm text-ink-3"
            >
              {status}
            </Text>
          ) : null}
        </View>
      </View>
    </Section>
  );
}

function formatWhen(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** One region's ratings over time, with the workouts near each as plain facts. */
export function PainHistory({ subject, region }: { subject: PainSubject; region: string }) {
  const { t, i18n } = useLingui();
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: painKeys(subject).history(region),
    queryFn: () => client.pain.history({ region, days: 90, timeZone: browserTimeZone() }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.pain.delete({ id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: painKeys(subject).all }),
  });
  const name = painRegionText(region, i18n);
  const confirmDelete = (id: string) =>
    Alert.alert(t`Delete this rating? This cannot be undone.`, undefined, [
      { text: t`Cancel`, style: "cancel" },
      { text: t`Delete`, style: "destructive", onPress: () => remove.mutate(id) },
    ]);

  return (
    <Section
      icon={History}
      tone="weight"
      title={t`History: ${name}`}
      description={i18n._(PAIN_COPY.history)}
    >
      {history.isPending ? (
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
          {t`Loading…`}
        </Text>
      ) : history.isError ? (
        <ErrorState
          title={t`Could not load this region's history.`}
          action={
            <Button variant="outline" size="sm" onPress={() => void history.refetch()}>
              <Button.Label>{t`Retry`}</Button.Label>
            </Button>
          }
        />
      ) : !history.data.entries.length ? (
        <Text className="font-sans text-sm text-ink-2">{i18n._(PAIN_COPY.noHistory)}</Text>
      ) : (
        <Sheet className="px-4 py-1">
          {history.data.entries.map((entry, index) => {
            const summary = painEntrySummary(entry, i18n);
            const when = formatWhen(entry.loggedAt, i18n.locale);
            return (
              <View
                key={entry.id}
                className={cn("gap-1 py-3", index > 0 && "border-t border-rule")}
              >
                <View className="flex-row flex-wrap items-baseline justify-between gap-2">
                  <Text className="font-sans text-base font-semibold text-ink">{summary}</Text>
                  <Text className="font-sans text-sm text-ink-3">{when}</Text>
                </View>
                {entry.note ? (
                  <Text className="font-sans text-sm text-ink-2">{entry.note}</Text>
                ) : null}
                {entry.workoutsBefore.length ? (
                  <View
                    accessibilityLabel={t`Workouts logged near this rating`}
                    className="gap-0.5"
                  >
                    {entry.workoutsBefore.map((fact) => (
                      <Text key={fact.id} className="font-sans text-sm text-ink-3">
                        {painWorkoutFact(fact, i18n)}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <View className="items-start">
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={remove.isPending}
                    accessibilityLabel={t`Delete ${summary}, ${when}`}
                    onPress={() => confirmDelete(entry.id)}
                  >
                    <Button.Label>{t`Delete`}</Button.Label>
                  </Button>
                </View>
              </View>
            );
          })}
        </Sheet>
      )}
      {remove.isError ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not delete this rating. Try again.`}
        </Text>
      ) : null}
    </Section>
  );
}

/** The opt-in and the separate AI switch (off by default). */
export function PainSettings({
  preference,
  saving,
  failed,
  onChange,
}: {
  preference: { enabled: boolean; aiVisible: boolean };
  saving: boolean;
  failed: boolean;
  onChange: (change: { enabled?: boolean; aiVisible?: boolean }) => void;
}) {
  const { t, i18n } = useLingui();
  const signal = useThemeColor("signal");
  return (
    <Section icon={Lock} tone="weight" title={t`Pain log settings`}>
      <SettingsGroup>
        <SettingsRow
          icon={Lock}
          label={i18n._(PAIN_COPY.enabled)}
          description={i18n._(PAIN_COPY.enabledDetail)}
          trailing={
            <Switch
              accessibilityLabel={i18n._(PAIN_COPY.enabled)}
              value={preference.enabled}
              disabled={saving}
              onValueChange={(enabled) => onChange({ enabled })}
              trackColor={{ true: signal }}
            />
          }
        />
        <SettingsRow
          divider
          icon={Bot}
          label={i18n._(PAIN_COPY.aiVisible)}
          description={i18n._(PAIN_COPY.aiVisibleDetail)}
          trailing={
            <Switch
              accessibilityLabel={i18n._(PAIN_COPY.aiVisible)}
              value={preference.aiVisible}
              disabled={saving}
              onValueChange={(aiVisible) => onChange({ aiVisible })}
              trackColor={{ true: signal }}
            />
          }
        />
      </SettingsGroup>
      {failed ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {t`Could not update this setting. Try again.`}
        </Text>
      ) : null}
    </Section>
  );
}
