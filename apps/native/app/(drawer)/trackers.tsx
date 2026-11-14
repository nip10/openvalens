import { useLingui } from "@lingui/react/macro";
import {
  blankTrackerDraft,
  browserTimeZone,
  templateTrackerDraft,
  trackerCreatePayload,
  type TrackerDraft,
} from "@openvalens/api/presenters/tracker-draft";
import {
  formatTrackerTarget,
  formatTrackerTotal,
  formatTrackerValue,
  TRACKER_TEMPLATE_COPY,
} from "@openvalens/api/presenters/trackers";
import { TRACKER_LIMITS, TRACKER_TEMPLATES } from "@openvalens/trackers/model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Button, Spinner, useToast } from "heroui-native";
import { ListChecks, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import {
  EmptyState,
  ErrorState,
  Icon,
  ListCard,
  Meter,
  Page,
  PageHeader,
  Section,
  Sheet,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { TrackerEditor } from "@/components/trackers/tracker-editor";
import { trackerIcon } from "@/components/trackers/tracker-icons";
import { TrackerLogForm } from "@/components/trackers/tracker-log-form";
import { useTrackerFeedImport } from "@/components/trackers/tracker-phone-feed";
import { orpc } from "@/utils/orpc";

type TrackerSummary = Awaited<ReturnType<typeof orpc.trackers.list.call>>[number];

/** Custom trackers (#441) on mobile: the member's own and the workspace's shared ones. */
export default function TrackersScreen() {
  const { t } = useLingui();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const list = useQuery(
    orpc.trackers.list.queryOptions({
      input: { timeZone: browserTimeZone(), includeArchived: showArchived },
    }),
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.trackers.key() });
  // #452: linked phone feeds (mindful minutes, State of Mind) import on open.
  useTrackerFeedImport();
  const header = (
    <PageHeader
      eyebrow={t`Habits`}
      title={t`Trackers`}
      description={t`Small things you track yourself: mood, sauna, dead hangs and more.`}
      info={t`Trackers are private unless you share one with this workspace. Each has its own switch for the Coach and connected AI apps. Notes are never shared with the Coach.`}
      actions={
        !creating ? (
          <Button size="sm" testID="tracker-new" onPress={() => setCreating(true)}>
            <Button.Label>{t`New tracker`}</Button.Label>
          </Button>
        ) : null
      }
    />
  );

  if (list.isPending)
    return (
      <Container>
        <Page>
          {header}
          <Sheet className="items-center py-10">
            <Spinner />
          </Sheet>
        </Page>
      </Container>
    );
  if (list.isError || !list.data)
    return (
      <Container>
        <Page>
          {header}
          <ErrorState
            title={t`Could not load trackers.`}
            action={
              <Button variant="outline" size="sm" onPress={() => void list.refetch()}>
                <Button.Label>{t`Retry`}</Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const active = list.data.filter((tracker) => !tracker.archivedAt);
  const mine = active.filter((tracker) => tracker.owner.isYou);
  const shared = active.filter((tracker) => !tracker.owner.isYou);
  const archived = list.data.filter((tracker) => tracker.archivedAt);
  const open = (id: string) =>
    router.push({ pathname: "/trackers/[trackerId]", params: { trackerId: id } });

  return (
    <Container>
      <Page>
        {header}
        {creating ? (
          <NewTracker
            atLimit={mine.length >= TRACKER_LIMITS.activePerMember}
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              refresh();
              open(id);
            }}
          />
        ) : null}
        {mine.length === 0 && shared.length === 0 && !creating ? (
          <EmptyState
            icon={ListChecks}
            title={t`No trackers yet`}
            description={t`Start from a template such as Mood or Sauna, or make your own.`}
            action={
              <Button size="sm" onPress={() => setCreating(true)}>
                <Button.Label>{t`New tracker`}</Button.Label>
              </Button>
            }
          />
        ) : null}
        {mine.length > 0 ? (
          <Section title={t`Your trackers`}>
            {mine.map((tracker) => (
              <TrackerCard
                key={tracker.id}
                tracker={tracker}
                onOpen={() => open(tracker.id)}
                onLogged={refresh}
              />
            ))}
          </Section>
        ) : null}
        {shared.length > 0 ? (
          <Section title={t`Shared in this workspace`}>
            {shared.map((tracker) => (
              <TrackerCard
                key={tracker.id}
                tracker={tracker}
                onOpen={() => open(tracker.id)}
                onLogged={refresh}
              />
            ))}
          </Section>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() => setShowArchived((value) => !value)}
        >
          <Button.Label>
            {showArchived ? t`Hide archived trackers` : t`Show archived trackers`}
          </Button.Label>
        </Button>
        {showArchived
          ? archived.map((tracker) => (
              <ListCard
                key={tracker.id}
                icon={trackerIcon(tracker.icon)}
                title={tracker.name}
                subtitle={t`Archived`}
                onPress={() => open(tracker.id)}
              />
            ))
          : null}
        {showArchived && archived.length === 0 ? (
          <Text className="font-sans text-sm text-ink-3">{t`No archived trackers.`}</Text>
        ) : null}
      </Page>
    </Container>
  );
}

function TrackerCard({
  tracker,
  onOpen,
  onLogged,
}: {
  tracker: TrackerSummary;
  onOpen: () => void;
  onLogged: () => void;
}) {
  const { t, i18n } = useLingui();
  const progress = tracker.progress;
  const today =
    tracker.today === null
      ? t`Nothing logged today`
      : formatTrackerValue(i18n, tracker, tracker.today);
  const targetText = tracker.target ? formatTrackerTarget(i18n, tracker, tracker.target) : null;
  const current =
    progress && progress.current !== null
      ? progress.period === "week"
        ? formatTrackerTotal(i18n, tracker, progress.current)
        : formatTrackerValue(i18n, tracker, progress.current)
      : null;
  const owner = !tracker.owner.isYou && tracker.owner.name ? ` · ${tracker.owner.name}` : "";
  return (
    <ListCard
      icon={trackerIcon(tracker.icon)}
      tone="signal"
      title={tracker.name}
      subtitle={`${today}${owner}`}
      status={
        tracker.shared && tracker.owner.isYou ? { label: t`Shared`, tone: "neutral" } : undefined
      }
      testID={`tracker-card-${tracker.name}`}
      trailing={
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={t`Open ${tracker.name}`}
          className="min-h-11 min-w-11 items-center justify-center"
        >
          <Text className="font-sans text-sm font-semibold text-signal">{t`Open`}</Text>
        </Pressable>
      }
    >
      {progress && targetText ? (
        <View className="gap-1.5">
          <Meter
            value={progress.current === null ? 0 : progress.current / progress.target}
            tone="signal"
            label={t`Target progress`}
          />
          <Text className="font-sans text-sm text-ink-3">
            {progress.met
              ? t`Target reached: ${targetText}`
              : current
                ? t`${current} of ${targetText}`
                : t`Target: ${targetText}`}
          </Text>
        </View>
      ) : null}
      {tracker.canLog ? <TrackerLogForm tracker={tracker} onLogged={onLogged} /> : null}
    </ListCard>
  );
}

function NewTracker({
  atLimit,
  onClose,
  onCreated,
}: {
  atLimit: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const [draft, setDraft] = useState<TrackerDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const create = useMutation({
    mutationFn: (input: NonNullable<ReturnType<typeof trackerCreatePayload>>) =>
      orpc.trackers.create.call(input),
    onSuccess: (created) => onCreated(created.id),
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : t`Could not create it. Try again.`,
      }),
  });

  return (
    <Section
      icon={Plus}
      tone="signal"
      title={t`New tracker`}
      actions={
        <Button size="sm" variant="ghost" onPress={onClose}>
          <Button.Label>{t`Close`}</Button.Label>
        </Button>
      }
      sheet
    >
      {atLimit ? (
        <Text accessibilityRole="text" className="font-sans text-base text-ink-2">
          {t`You have 50 active trackers, the most you can have. Archive one to add another.`}
        </Text>
      ) : !draft ? (
        <View className="gap-2">
          <Text className="font-sans text-base text-ink-2">
            {t`Start from a template, or make your own.`}
          </Text>
          {TRACKER_TEMPLATES.map((template) => {
            const copy = TRACKER_TEMPLATE_COPY[template.id];
            return (
              <Pressable
                key={template.id}
                testID={`tracker-template-${template.id}`}
                accessibilityRole="button"
                onPress={() => setDraft(templateTrackerDraft(template.id, i18n._(copy.name)))}
                className="min-h-11 flex-row items-start gap-3 rounded-xl border border-rule-2 bg-sheet p-3 active:opacity-80"
              >
                <Icon icon={trackerIcon(template.icon)} />
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="font-sans text-base font-semibold text-ink">
                    {i18n._(copy.name)}
                  </Text>
                  <Text className="font-sans text-sm text-ink-3">{i18n._(copy.description)}</Text>
                </View>
              </Pressable>
            );
          })}
          <Pressable
            testID="tracker-template-custom"
            accessibilityRole="button"
            onPress={() => setDraft(blankTrackerDraft())}
            className="min-h-11 flex-row items-start gap-3 rounded-xl border border-dashed border-rule-2 bg-sheet p-3 active:opacity-80"
          >
            <Icon icon={Plus} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="font-sans text-base font-semibold text-ink">{t`Custom`}</Text>
              <Text className="font-sans text-sm text-ink-3">
                {t`A number, a 1 to 5 rating, yes or no, or a duration.`}
              </Text>
            </View>
          </Pressable>
        </View>
      ) : (
        <View className="gap-4">
          <TrackerEditor draft={draft} onChange={setDraft} showErrors={showErrors} />
          <View className="flex-row flex-wrap gap-2">
            <Button
              testID="tracker-create"
              isDisabled={create.isPending}
              onPress={() => {
                setShowErrors(true);
                const payload = trackerCreatePayload(draft, i18n.locale);
                if (payload) create.mutate(payload);
              }}
            >
              <Button.Label>{create.isPending ? t`Creating…` : t`Create tracker`}</Button.Label>
            </Button>
            <Button variant="outline" onPress={() => setDraft(null)}>
              <Button.Label>{t`Back to templates`}</Button.Label>
            </Button>
          </View>
        </View>
      )}
    </Section>
  );
}
