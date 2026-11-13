import { useLingui } from "@lingui/react/macro";
import {
  browserTimeZone,
  draftFromTracker,
  trackerUpdatePayload,
  type TrackerDraft,
} from "@openvalens/api/presenters/tracker-draft";
import {
  formatTrackerTarget,
  formatTrackerTotal,
  formatTrackerValue,
} from "@openvalens/api/presenters/trackers";
import { TRACKER_CHART_DAYS, type TrackerChartDays } from "@openvalens/trackers/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Spinner, useToast } from "heroui-native";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import {
  ErrorState,
  Figure,
  Icon,
  Meter,
  Page,
  PageHeader,
  Section,
  Sheet,
  StatusPill,
  ToneIcon,
} from "@/components/bloom";
import { TrendChart } from "@/components/chart";
import { Container } from "@/components/container";
import { TrackerEditor } from "@/components/trackers/tracker-editor";
import { trackerIcon } from "@/components/trackers/tracker-icons";
import { TrackerLogForm } from "@/components/trackers/tracker-log-form";
import { TRACKER_INPUT_CLASS } from "@/components/trackers/tracker-value-input";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

type Tracker = Awaited<ReturnType<typeof orpc.trackers.get.call>>;

/** One custom tracker (#441) on mobile: log it, its chart and target, its entries and settings. */
export default function TrackerScreen() {
  const { t } = useLingui();
  const { trackerId } = useLocalSearchParams<{ trackerId: string }>();
  const queryClient = useQueryClient();
  const tracker = useQuery({
    ...orpc.trackers.get.queryOptions({ input: { id: trackerId ?? "" } }),
    enabled: Boolean(trackerId),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.trackers.key() });

  if (tracker.isPending)
    return (
      <Container>
        <Page>
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );
  if (tracker.isError || !tracker.data)
    return (
      <Container>
        <Page>
          <ErrorState
            title={t`This tracker is not available.`}
            description={t`It may have been deleted, or its owner stopped sharing it with this workspace.`}
          />
        </Page>
      </Container>
    );

  const data = tracker.data;
  const ownerName = data.owner.name ?? t`another member`;
  return (
    <Container>
      <Page>
        <View className="flex-row items-center gap-3">
          <ToneIcon icon={trackerIcon(data.icon)} tone="signal" />
          <View className="min-w-0 flex-1">
            <PageHeader
              title={data.name}
              description={
                data.owner.isYou
                  ? data.shared
                    ? t`Shared with this workspace.`
                    : t`Private: only you see it.`
                  : t`Shared by ${ownerName}.`
              }
            />
          </View>
        </View>
        {data.archivedAt ? <StatusPill tone="neutral">{t`Archived`}</StatusPill> : null}
        {data.canLog ? (
          <Section title={t`Log`} sheet>
            <TrackerLogForm tracker={data} onLogged={refresh} />
          </Section>
        ) : null}
        <ChartSection tracker={data} />
        <EntriesSection tracker={data} onChanged={refresh} />
        {data.canEdit ? <SettingsSection tracker={data} onChanged={refresh} /> : null}
      </Page>
    </Container>
  );
}

function ChartSection({ tracker }: { tracker: Tracker }) {
  const { t, i18n } = useLingui();
  const [days, setDays] = useState<TrackerChartDays>(30);
  const chart = useQuery(
    orpc.trackers.chart.queryOptions({
      input: { trackerId: tracker.id, days, timeZone: browserTimeZone() },
    }),
  );
  const scaled = (value: number) => (tracker.type === "duration" ? value / 60 : value);
  const progress = chart.data?.progress ?? null;
  const targetText = tracker.target ? formatTrackerTarget(i18n, tracker, tracker.target) : null;
  const rangeLabel = (option: TrackerChartDays) =>
    option === 30 ? t`30 days` : option === 90 ? t`90 days` : t`365 days`;
  return (
    <Section
      title={t`History`}
      actions={
        <View accessibilityRole="radiogroup" className="flex-row gap-1">
          {TRACKER_CHART_DAYS.map((option) => (
            <Pressable
              key={option}
              onPress={() => setDays(option)}
              accessibilityRole="radio"
              accessibilityState={{ checked: option === days }}
              className={`min-h-11 justify-center rounded-full border px-3 ${option === days ? "border-signal bg-sidebar-accent" : "border-rule-2 bg-sheet"}`}
            >
              <Text className="font-sans text-sm text-ink">{rangeLabel(option)}</Text>
            </Pressable>
          ))}
        </View>
      }
      sheet
    >
      {chart.isPending ? (
        <Spinner />
      ) : chart.isError || !chart.data ? (
        <Text accessibilityRole="alert" className="font-sans text-base text-ink-2">
          {t`Could not load the chart.`}
        </Text>
      ) : (
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-4">
            <Figure
              label={t`Days logged`}
              value={String(chart.data.loggedDays)}
              note={t`of ${days}`}
            />
            <Figure
              label={tracker.type === "yes_no" ? t`Yes days` : t`Average day`}
              value={
                tracker.type === "yes_no"
                  ? chart.data.total === null
                    ? "–"
                    : formatTrackerTotal(i18n, tracker, chart.data.total)
                  : chart.data.average === null
                    ? "–"
                    : formatTrackerValue(i18n, tracker, chart.data.average)
              }
            />
            {progress && targetText ? (
              <Figure
                label={progress.period === "day" ? t`Days on target` : t`Weeks on target`}
                value={`${progress.metCount} / ${progress.periodCount}`}
                note={targetText}
              />
            ) : null}
          </View>
          {progress && targetText ? (
            <Meter
              value={progress.current === null ? 0 : progress.current / progress.target}
              tone="signal"
              label={t`Target progress`}
            />
          ) : null}
          <TrendChart
            tone="signal"
            bars
            data={chart.data.days.map((day) => ({
              value: day.value === null ? 0 : scaled(day.value),
              label: friendlyDate(i18n, day.date),
            }))}
            minValue={0}
            maxValue={tracker.type === "scale" ? 5 : tracker.type === "yes_no" ? 1 : undefined}
            target={tracker.target?.period === "day" ? scaled(tracker.target.value) : null}
          />
          {tracker.type === "duration" ? (
            <Text className="font-sans text-sm text-ink-3">{t`Bars show minutes per day.`}</Text>
          ) : null}
        </View>
      )}
    </Section>
  );
}

function EntriesSection({ tracker, onChanged }: { tracker: Tracker; onChanged: () => void }) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const entries = useQuery(
    orpc.trackers.entries.queryOptions({ input: { trackerId: tracker.id, limit: 50 } }),
  );
  const remove = useMutation({
    mutationFn: (id: string) => orpc.trackers.deleteEntry.call({ id }),
    onSuccess: () => {
      toast.show({ variant: "success", label: t`Entry deleted.` });
      onChanged();
    },
    onError: () => toast.show({ variant: "danger", label: t`Could not delete it. Try again.` }),
  });
  const time = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  return (
    <Section title={t`Entries`}>
      {entries.isPending ? (
        <Spinner />
      ) : entries.isError || !entries.data ? (
        <Text accessibilityRole="alert" className="font-sans text-base text-ink-2">
          {t`Could not load the entries.`}
        </Text>
      ) : entries.data.entries.length === 0 ? (
        <Text className="font-sans text-base text-ink-3">{t`No entries yet.`}</Text>
      ) : (
        <Sheet className="gap-0 px-4 py-1">
          {entries.data.entries.map((entry) => {
            const by = entry.loggedBy.isYou
              ? t`logged by you`
              : entry.loggedBy.name
                ? t`logged by ${entry.loggedBy.name}`
                : t`logged by a former member`;
            return (
              <View
                key={entry.id}
                className="flex-row items-start gap-3 border-b border-rule py-3 last:border-b-0"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="font-sans text-base font-semibold text-ink">
                    {formatTrackerValue(i18n, tracker, entry.value)}
                  </Text>
                  {entry.note ? (
                    <Text className="font-sans text-base text-ink-2">{entry.note}</Text>
                  ) : null}
                  <Text className="font-sans text-sm text-ink-3">
                    {`${friendlyDate(i18n, entry.localDate)} · ${time(entry.loggedAt)} · ${by}`}
                  </Text>
                </View>
                {entry.canEdit ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t`Delete entry`}
                    className="min-h-11 min-w-11 items-center justify-center"
                    onPress={() =>
                      Alert.alert(t`Delete this entry? This cannot be undone.`, undefined, [
                        { text: t`Cancel`, style: "cancel" },
                        {
                          text: t`Delete`,
                          style: "destructive",
                          onPress: () => remove.mutate(entry.id),
                        },
                      ])
                    }
                  >
                    <Icon icon={Trash2} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </Sheet>
      )}
    </Section>
  );
}

function SettingsSection({ tracker, onChanged }: { tracker: Tracker; onChanged: () => void }) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState<TrackerDraft>(() => draftFromTracker(tracker));
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const failed = (error: unknown) =>
    toast.show({
      variant: "danger",
      label: error instanceof Error ? error.message : t`Could not save. Try again.`,
    });
  const save = useMutation({
    mutationFn: () => {
      const payload = trackerUpdatePayload(tracker.id, tracker, draft, i18n.locale);
      if (!payload) throw new Error(t`Check the highlighted fields.`);
      return orpc.trackers.update.call(payload);
    },
    onSuccess: () => {
      toast.show({ variant: "success", label: t`Tracker saved.` });
      onChanged();
    },
    onError: failed,
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => orpc.trackers.setArchived.call({ id: tracker.id, archived }),
    onSuccess: onChanged,
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: () => orpc.trackers.delete.call({ id: tracker.id, confirmation: typed }),
    onSuccess: () => {
      onChanged();
      router.replace("/trackers");
    },
    onError: failed,
  });
  return (
    <Section title={t`Settings`} sheet>
      <TrackerEditor
        draft={draft}
        onChange={setDraft}
        locked={tracker.locked}
        showErrors={showErrors}
      />
      <Button
        isDisabled={save.isPending}
        onPress={() => {
          setShowErrors(true);
          save.mutate();
        }}
      >
        <Button.Label>{save.isPending ? t`Saving…` : t`Save changes`}</Button.Label>
      </Button>
      <View className="gap-3 border-t border-rule pt-4">
        <Button
          variant="outline"
          isDisabled={archive.isPending}
          onPress={() => archive.mutate(!tracker.archivedAt)}
        >
          <Button.Label>
            {tracker.archivedAt ? t`Restore tracker` : t`Archive tracker`}
          </Button.Label>
        </Button>
        <Text className="font-sans text-sm text-ink-3">
          {t`Archiving hides the tracker and keeps its entries.`}
        </Text>
        {!confirming ? (
          <Button variant="ghost" onPress={() => setConfirming(true)}>
            <Button.Label>{t`Delete tracker`}</Button.Label>
          </Button>
        ) : (
          <View className="gap-2">
            <Text className="font-sans text-sm text-ink-2">
              {t`This erases the tracker and all of its entries. Type ${tracker.name} to confirm.`}
            </Text>
            <TextInput
              testID="tracker-delete-confirmation"
              accessibilityLabel={t`Tracker name`}
              value={typed}
              onChangeText={setTyped}
              autoCorrect={false}
              autoCapitalize="none"
              className={TRACKER_INPUT_CLASS}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                variant="danger"
                isDisabled={typed.trim() !== tracker.name.trim() || remove.isPending}
                onPress={() => remove.mutate()}
              >
                <Button.Label>{remove.isPending ? t`Deleting…` : t`Delete for good`}</Button.Label>
              </Button>
              <Button
                variant="outline"
                onPress={() => {
                  setConfirming(false);
                  setTyped("");
                }}
              >
                <Button.Label>{t`Cancel`}</Button.Label>
              </Button>
            </View>
          </View>
        )}
      </View>
    </Section>
  );
}
