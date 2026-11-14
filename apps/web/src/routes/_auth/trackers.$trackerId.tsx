import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatTrackerTarget,
  formatTrackerTotal,
  formatTrackerValue,
  parseTrackerInput,
} from "@openvalens/api/presenters/trackers";
import { entrySourceLabel, TRACKER_FEED_COPY } from "@openvalens/api/presenters/tracker-feeds";
import { TRACKER_CHART_DAYS, type TrackerChartDays } from "@openvalens/trackers/model";
import { Button } from "@openvalens/ui/components/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@openvalens/ui/components/chart";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import {
  ErrorState,
  Figure,
  Meter,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { trackerIcon } from "@/components/tracker-icons";
import {
  browserTimeZone,
  draftFromTracker,
  trackerUpdatePayload,
  type TrackerDraft,
} from "@openvalens/api/presenters/tracker-draft";
import { TrackerEditor } from "@/components/trackers/tracker-editor";
import { TrackerLogForm } from "@/components/trackers/tracker-log-form";
import { TrackerValueInput } from "@/components/trackers/tracker-value-input";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/trackers/$trackerId")({ component: TrackerPage });

type Tracker = Awaited<ReturnType<typeof client.trackers.get>>;
type Entry = Awaited<ReturnType<typeof client.trackers.entries>>["entries"][number];

/** One custom tracker (#441): log it, its chart and target, its entries and its settings. */
function TrackerPage() {
  const { t } = useLingui();
  const { trackerId } = Route.useParams();
  const queryClient = useQueryClient();
  const tracker = useQuery(orpc.trackers.get.queryOptions({ input: { id: trackerId } }));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.trackers.key() });

  const back = (
    <Link
      to="/trackers"
      className="flex items-center gap-1 text-sm text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      <Trans>All trackers</Trans>
    </Link>
  );

  if (tracker.isPending)
    return (
      <Page>
        {back}
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 rounded-3xl" />
      </Page>
    );
  if (tracker.isError || !tracker.data)
    return (
      <Page>
        {back}
        <ErrorState
          title={<Trans>This tracker is not available.</Trans>}
          description={
            <Trans>
              It may have been deleted, or its owner stopped sharing it with this workspace.
            </Trans>
          }
        />
      </Page>
    );

  const data = tracker.data;
  const Icon = trackerIcon(data.icon);
  const ownerName = data.owner.name ?? t`another member`;
  return (
    <Page>
      {back}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <ToneIcon icon={Icon} tone="signal" />
            {data.name}
          </span>
        }
        description={
          data.owner.isYou ? (
            data.shared ? (
              <Trans>Shared with this workspace.</Trans>
            ) : (
              <Trans>Private: only you see it.</Trans>
            )
          ) : (
            <Trans>Shared by {ownerName}.</Trans>
          )
        }
        actions={
          data.archivedAt ? (
            <StatusPill tone="neutral">
              <Trans>Archived</Trans>
            </StatusPill>
          ) : null
        }
      />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="grid min-w-0 content-start gap-8">
          <TrackerChartSection tracker={data} />
          <EntriesSection tracker={data} onChanged={refresh} />
        </div>
        <div className="grid min-w-0 content-start gap-8">
          {data.canLog ? (
            <Section title={<Trans>Log</Trans>} sheet>
              <TrackerLogForm tracker={data} onLogged={refresh} />
            </Section>
          ) : null}
          {data.canEdit ? <PhoneFeedNote trackerId={data.id} /> : null}
          {data.canEdit ? <SettingsSection tracker={data} onChanged={refresh} /> : null}
        </div>
      </div>
    </Page>
  );
}

function TrackerChartSection({ tracker }: { tracker: Tracker }) {
  const { t, i18n } = useLingui();
  const [days, setDays] = useState<TrackerChartDays>(30);
  const chart = useQuery(
    orpc.trackers.chart.queryOptions({
      input: { trackerId: tracker.id, days, timeZone: browserTimeZone() },
    }),
  );
  const config = {
    value: { label: tracker.name, color: "var(--tone-signal)" },
  } satisfies ChartConfig;
  const scaled = (value: number) => (tracker.type === "duration" ? value / 60 : value);
  const series =
    chart.data?.days.map((day) => ({
      date: day.date,
      value: day.value === null ? null : scaled(day.value),
      raw: day.value,
    })) ?? [];
  const progress = chart.data?.progress ?? null;
  const targetText = tracker.target ? formatTrackerTarget(i18n, tracker, tracker.target) : null;

  return (
    <Section
      title={<Trans>History</Trans>}
      actions={
        <div role="radiogroup" aria-label={t`Chart range`} className="flex gap-1">
          {TRACKER_CHART_DAYS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={option === days ? "default" : "outline"}
              role="radio"
              aria-checked={option === days}
              onClick={() => setDays(option)}
            >
              {option === 30 ? (
                <Trans>30 days</Trans>
              ) : option === 90 ? (
                <Trans>90 days</Trans>
              ) : (
                <Trans>365 days</Trans>
              )}
            </Button>
          ))}
        </div>
      }
    >
      <div className="sheet grid gap-5 p-5">
        {chart.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : chart.isError || !chart.data ? (
          <p role="alert" className="text-ink-2">
            <Trans>Could not load the chart.</Trans>
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Figure
                label={<Trans>Days logged</Trans>}
                value={String(chart.data.loggedDays)}
                note={<Trans>of {days}</Trans>}
              />
              <Figure
                label={
                  tracker.type === "yes_no" ? <Trans>Yes days</Trans> : <Trans>Average day</Trans>
                }
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
                  label={
                    progress.period === "day" ? (
                      <Trans>Days on target</Trans>
                    ) : (
                      <Trans>Weeks on target</Trans>
                    )
                  }
                  value={`${progress.metCount} / ${progress.periodCount}`}
                  note={targetText}
                />
              ) : null}
            </div>
            {progress && targetText ? (
              <div className="grid gap-1.5">
                <Meter
                  value={progress.current === null ? 0 : progress.current / progress.target}
                  tone="signal"
                  label={t`Target progress`}
                />
                <p className="text-sm text-ink-3">
                  {progress.period === "day" ? <Trans>Today</Trans> : <Trans>This week</Trans>}
                  {": "}
                  {progress.current === null
                    ? t`nothing yet`
                    : progress.period === "week"
                      ? formatTrackerTotal(i18n, tracker, progress.current)
                      : formatTrackerValue(i18n, tracker, progress.current)}
                  {" · "}
                  {targetText}
                </p>
              </div>
            ) : null}
            <ChartContainer config={config} className="aspect-auto h-64 w-full">
              <BarChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={32}
                  tickFormatter={(value: string) => friendlyDate(i18n, value)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={tracker.type === "number" && tracker.decimals > 0}
                  domain={
                    tracker.type === "scale"
                      ? [0, 5]
                      : tracker.type === "yes_no"
                        ? [0, 1]
                        : [0, "auto"]
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const date = payload?.[0]?.payload?.date as string | undefined;
                        return date ? friendlyDate(i18n, date) : "";
                      }}
                      formatter={(_, __, item) => {
                        const raw = item.payload?.raw as number | null | undefined;
                        return raw === null || raw === undefined
                          ? t`Nothing logged`
                          : formatTrackerValue(i18n, tracker, raw);
                      }}
                    />
                  }
                />
                {tracker.target?.period === "day" ? (
                  <ReferenceLine
                    y={scaled(tracker.target.value)}
                    stroke="var(--ink-3)"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                  />
                ) : null}
                <Bar
                  dataKey="value"
                  fill="var(--color-value)"
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
            {tracker.type === "duration" ? (
              <p className="text-sm text-ink-3">
                <Trans>Bars show minutes per day.</Trans>
              </p>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}

function EntriesSection({ tracker, onChanged }: { tracker: Tracker; onChanged: () => void }) {
  const { t, i18n } = useLingui();
  const entries = useQuery(
    orpc.trackers.entries.queryOptions({ input: { trackerId: tracker.id, limit: 50 } }),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => client.trackers.deleteEntry({ id }),
    onSuccess: () => {
      toast.success(t`Entry deleted.`);
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not delete it. Try again.`),
  });
  const time = (iso: string) =>
    new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );

  return (
    <Section title={<Trans>Entries</Trans>}>
      {entries.isPending ? (
        <Skeleton className="h-32 rounded-3xl" />
      ) : entries.isError || !entries.data ? (
        <p role="alert" className="text-ink-2">
          <Trans>Could not load the entries.</Trans>
        </p>
      ) : entries.data.entries.length === 0 ? (
        <p className="text-ink-3">
          <Trans>No entries yet.</Trans>
        </p>
      ) : (
        <ul className="sheet grid divide-y divide-rule px-4 py-1">
          {entries.data.entries.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id} className="py-3">
                <EntryEditor
                  tracker={tracker}
                  entry={entry}
                  onDone={() => {
                    setEditing(null);
                    onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={entry.id} className="flex items-start gap-3 py-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <p className="font-semibold text-ink">
                    {formatTrackerValue(i18n, tracker, entry.value)}
                  </p>
                  {entry.note ? <p className="text-ink-2">{entry.note}</p> : null}
                  <p className="text-sm text-ink-3">
                    {friendlyDate(i18n, entry.localDate)} · {time(entry.loggedAt)}
                    {" · "}
                    <EntryOrigin entry={entry} />
                  </p>
                </div>
                {entry.canEdit ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t`Edit entry`}
                      onClick={() => setEditing(entry.id)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t`Delete entry`}
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(t`Delete this entry? This cannot be undone.`))
                          remove.mutate(entry.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </Section>
  );
}

function EntryEditor({
  tracker,
  entry,
  onDone,
  onCancel,
}: {
  tracker: Tracker;
  entry: Entry;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useLingui();
  const initial =
    tracker.type === "yes_no"
      ? entry.value > 0
        ? "yes"
        : "no"
      : tracker.type === "duration"
        ? formatTrackerValue(i18n, tracker, entry.value)
        : String(entry.value);
  const [text, setText] = useState(initial);
  const [note, setNote] = useState(entry.note ?? "");
  const value = parseTrackerInput(tracker, text, i18n.locale);
  const save = useMutation({
    mutationFn: () =>
      client.trackers.updateEntry({
        id: entry.id,
        value: value!,
        timeZone: browserTimeZone(),
        note: note.trim() ? note.trim() : null,
      }),
    onSuccess: onDone,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not save. Try again.`),
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== null && !save.isPending) save.mutate();
      }}
    >
      <Label id={`edit-${entry.id}-label`} htmlFor={`edit-${entry.id}`}>
        <Trans>Value</Trans>
      </Label>
      <TrackerValueInput
        id={`edit-${entry.id}`}
        type={tracker.type}
        unit={tracker.unit}
        template={tracker.template}
        text={text}
        onText={setText}
        invalid={value === null}
      />
      <Label htmlFor={`edit-${entry.id}-note`}>
        <Trans>Note (optional)</Trans>
      </Label>
      <Input
        id={`edit-${entry.id}-note`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={value === null || save.isPending}>
          <Trans>Save</Trans>
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
      </div>
    </form>
  );
}

/** Who logged an entry, or the phone feed it came from (#452). */
function EntryOrigin({ entry }: { entry: Entry }) {
  const { i18n } = useLingui();
  const from = entrySourceLabel(entry.source);
  if (from) return <>{i18n._(from)}</>;
  if (entry.loggedBy.isYou) return <Trans>logged by you</Trans>;
  if (entry.loggedBy.name) return <Trans>logged by {entry.loggedBy.name}</Trans>;
  return <Trans>logged by a former member</Trans>;
}

/**
 * Phone feeds (#452) are linked and unlinked in the mobile app, which reads
 * Apple Health or Health Connect; the web only says which feed fills this
 * tracker.
 */
function PhoneFeedNote({ trackerId }: { trackerId: string }) {
  const { i18n } = useLingui();
  const feeds = useQuery(orpc.trackers.feeds.queryOptions());
  const linked = (feeds.data ?? []).filter((link) => link.trackerId === trackerId);
  if (linked.length === 0) return null;
  const names = linked.map((link) => i18n._(TRACKER_FEED_COPY[link.feed].name)).join(", ");
  return (
    <Section title={<Trans>From your phone</Trans>} sheet>
      <p className="text-ink-2" data-testid="tracker-phone-feed-note">
        <Trans>
          Filled from {names}. Link or unlink it in the tracker's settings in the OpenValens app on
          your phone; unlinking keeps the entries already imported.
        </Trans>
      </p>
    </Section>
  );
}

function SettingsSection({ tracker, onChanged }: { tracker: Tracker; onChanged: () => void }) {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<TrackerDraft>(() => draftFromTracker(tracker));
  const [showErrors, setShowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const payload = trackerUpdatePayload(tracker.id, tracker, draft, i18n.locale);
      if (!payload) throw new Error(t`Check the highlighted fields.`);
      return client.trackers.update(payload);
    },
    onSuccess: () => {
      toast.success(t`Tracker saved.`);
      onChanged();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not save. Try again.`),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => client.trackers.setArchived({ id: tracker.id, archived }),
    onSuccess: onChanged,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not save. Try again.`),
  });
  const remove = useMutation({
    mutationFn: () => client.trackers.delete({ id: tracker.id, confirmation: typed }),
    onSuccess: (result) => {
      toast.success(
        result.deletedEntries === 1
          ? t`Tracker and 1 entry deleted.`
          : t`Tracker and ${result.deletedEntries} entries deleted.`,
      );
      onChanged();
      void navigate({ to: "/trackers" });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not delete it. Try again.`),
  });

  return (
    <Section title={<Trans>Settings</Trans>} sheet>
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          setShowErrors(true);
          if (!save.isPending) save.mutate();
        }}
      >
        <TrackerEditor
          draft={draft}
          onChange={setDraft}
          locked={tracker.locked}
          showErrors={showErrors}
        />
        <Button type="submit" className="justify-self-start" disabled={save.isPending}>
          {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save changes</Trans>}
        </Button>
      </form>
      <div className="mt-6 grid gap-4 border-t border-rule pt-5">
        <div className="grid gap-1.5">
          <Button
            variant="outline"
            className="justify-self-start"
            disabled={archive.isPending}
            onClick={() => archive.mutate(!tracker.archivedAt)}
          >
            {tracker.archivedAt ? <Trans>Restore tracker</Trans> : <Trans>Archive tracker</Trans>}
          </Button>
          <p className="text-sm text-ink-3">
            <Trans>Archiving hides the tracker and keeps its entries.</Trans>
          </p>
        </div>
        {!confirming ? (
          <Button
            variant="ghost"
            className="justify-self-start text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden="true" />
            <Trans>Delete tracker</Trans>
          </Button>
        ) : (
          <div className="grid gap-2">
            <label htmlFor="tracker-delete-confirmation" className="text-sm text-ink-2">
              <Trans>
                This erases the tracker and all of its entries. Type{" "}
                <span className="font-semibold text-ink">{tracker.name}</span> to confirm.
              </Trans>
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="tracker-delete-confirmation"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                className="max-w-56"
              />
              <Button
                variant="destructive"
                disabled={typed.trim() !== tracker.name.trim() || remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? <Trans>Deleting…</Trans> : <Trans>Delete for good</Trans>}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirming(false);
                  setTyped("");
                }}
              >
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
