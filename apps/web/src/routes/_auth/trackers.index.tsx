import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatTrackerTarget,
  formatTrackerTotal,
  formatTrackerValue,
  TRACKER_CHECK_IN_COPY,
  TRACKER_TEMPLATE_COPY,
  trackerIsReadinessCheckIn,
} from "@openvalens/api/presenters/trackers";
import {
  TRACKER_LIMITS,
  TRACKER_TEMPLATES,
  type TrackerTemplateId,
} from "@openvalens/trackers/model";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, ChevronUp, ListChecks, Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  ErrorState,
  InfoTip,
  Meter,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { FormDialog } from "@/components/form-dialog";
import { trackerIcon } from "@/components/tracker-icons";
import {
  blankTrackerDraft,
  browserTimeZone,
  templateTrackerDraft,
  trackerCreatePayload,
  type TrackerDraft,
} from "@openvalens/api/presenters/tracker-draft";
import { TrackerEditor } from "@/components/trackers/tracker-editor";
import { TrackerLogForm } from "@/components/trackers/tracker-log-form";
import { recentTrackerUse, stripHeight } from "@/components/trackers/recent-use";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/trackers/")({ component: TrackersPage });

type TrackerSummary = Awaited<ReturnType<typeof client.trackers.list>>[number];

/** Custom trackers (#441): the member's own and the workspace's shared ones. */
function TrackersPage() {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  // The new-tracker dialog: closed, at the template list, or started from one template.
  const [creating, setCreating] = useState<null | "pick" | TrackerTemplateId>(null);
  const timeZone = browserTimeZone();
  const list = useQuery(
    orpc.trackers.list.queryOptions({ input: { timeZone, includeArchived: showArchived } }),
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.trackers.key() });

  const header = (
    <PageHeader
      title={<Trans>Trackers</Trans>}
      description={
        <Trans>Small things you track yourself: mood, sauna, dead hangs and more.</Trans>
      }
      info={
        <Trans>
          Trackers are private unless you share one with this workspace. Each has its own switch for
          the Coach and connected AI apps. Notes are never shared with the Coach.
        </Trans>
      }
      actions={
        <Button onClick={() => setCreating("pick")}>
          <Plus aria-hidden="true" />
          <Trans>New tracker</Trans>
        </Button>
      }
    />
  );

  if (list.isPending)
    return (
      <Page>
        {header}
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40 rounded-3xl" />
          <Skeleton className="h-40 rounded-3xl" />
        </div>
      </Page>
    );
  if (list.isError || !list.data)
    return (
      <Page>
        {header}
        <ErrorState
          title={<Trans>Could not load trackers.</Trans>}
          action={
            <Button variant="outline" onClick={() => void list.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );

  const active = list.data.filter((tracker) => !tracker.archivedAt);
  const mine = active.filter((tracker) => tracker.owner.isYou);
  const shared = active.filter((tracker) => !tracker.owner.isYou);
  const archived = list.data.filter((tracker) => tracker.archivedAt);
  const atLimit = mine.length >= TRACKER_LIMITS.activePerMember;
  // Templates the member has not started yet, offered as one-tap ideas (trackers#6).
  const usedTemplates = new Set(active.map((tracker) => tracker.template));
  const ideas = TRACKER_TEMPLATES.filter((template) => !usedTemplates.has(template.id));

  return (
    <Page>
      {header}
      <NewTracker
        open={creating !== null}
        template={creating === null || creating === "pick" ? null : creating}
        atLimit={atLimit}
        onClose={() => setCreating(null)}
        onCreated={() => {
          setCreating(null);
          refresh();
        }}
      />

      {mine.length === 0 && shared.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={<Trans>No trackers yet</Trans>}
          description={
            <Trans>Start from a template such as Mood or Sauna, or make your own.</Trans>
          }
          action={
            <Button variant="outline" onClick={() => setCreating("pick")}>
              <Trans>New tracker</Trans>
            </Button>
          }
        />
      ) : null}

      {mine.length > 0 ? (
        <Section title={<Trans>Your trackers</Trans>}>
          <ul className="grid gap-4 md:grid-cols-2">
            {mine.map((tracker) => (
              <TrackerCard key={tracker.id} tracker={tracker} onLogged={refresh} />
            ))}
          </ul>
        </Section>
      ) : null}

      {shared.length > 0 ? (
        <Section icon={Users} title={<Trans>Shared in this workspace</Trans>}>
          <ul className="grid gap-4 md:grid-cols-2">
            {shared.map((tracker) => (
              <TrackerCard key={tracker.id} tracker={tracker} onLogged={refresh} />
            ))}
          </ul>
        </Section>
      ) : null}

      {mine.length > 0 && !atLimit && ideas.length > 0 ? (
        <section aria-labelledby="tracker-ideas" className="grid gap-2">
          <h2 id="tracker-ideas" className="font-body text-sm font-normal text-ink-3">
            <Trans>More to track</Trans>
          </h2>
          <ul className="flex flex-wrap gap-2">
            {ideas.map((template) => {
              const Icon = trackerIcon(template.icon);
              const name = i18n._(TRACKER_TEMPLATE_COPY[template.id].name);
              return (
                <li key={template.id}>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t`Add a ${name} tracker`}
                    onClick={() => setCreating(template.id)}
                  >
                    <Icon aria-hidden="true" />
                    {name}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3">
        <Button
          variant="outline"
          className="justify-self-start"
          aria-expanded={showArchived}
          onClick={() => setShowArchived((value) => !value)}
        >
          {showArchived ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {showArchived ? (
            <Trans>Hide archived trackers</Trans>
          ) : (
            <Trans>Show archived trackers</Trans>
          )}
        </Button>
        {showArchived ? (
          archived.length ? (
            <ul className="sheet grid divide-y divide-rule px-4 py-1">
              {archived.map((tracker) => (
                <ArchivedRow key={tracker.id} tracker={tracker} onChanged={refresh} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">{t`No archived trackers.`}</p>
          )
        ) : null}
      </div>
    </Page>
  );
}

function TrackerCard({ tracker, onLogged }: { tracker: TrackerSummary; onLogged: () => void }) {
  const { t, i18n } = useLingui();
  const Icon = trackerIcon(tracker.icon);
  const progress = tracker.progress;
  // The last 30 days, for the last entry and the rolling week (trackers#0, #1).
  const chart = useQuery(
    orpc.trackers.chart.queryOptions({
      input: { trackerId: tracker.id, days: 30, timeZone: browserTimeZone() },
    }),
  );
  const recent = chart.data ? recentTrackerUse(chart.data.days, tracker) : null;
  const lastDay = recent?.last ? friendlyDate(i18n, recent.last.date) : null;
  const lastValue = recent?.last ? formatTrackerValue(i18n, tracker, recent.last.value) : null;
  const lastText =
    lastDay && lastValue ? t`${lastDay}: ${lastValue}` : recent ? t`Nothing logged lately` : null;
  const figure = recent?.figure ?? null;
  const figureValue = figure
    ? figure.kind === "total"
      ? formatTrackerTotal(i18n, tracker, figure.value)
      : formatTrackerValue(i18n, tracker, figure.value)
    : null;
  const figureText =
    figure && figureValue
      ? figure.kind === "average"
        ? t`7-day average ${figureValue}`
        : figure.kind === "total"
          ? t`${figureValue} in 7 days`
          : t`Yes on ${figure.value} of 7 days`
      : null;
  const targetText = tracker.target ? formatTrackerTarget(i18n, tracker, tracker.target) : null;
  return (
    <li className="sheet flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <ToneIcon icon={Icon} tone="signal" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Link
            to="/trackers/$trackerId"
            params={{ trackerId: tracker.id }}
            className="flex items-center gap-1 font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="truncate">{tracker.name}</span>
            <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
          </Link>
          <p className="min-h-5 text-sm text-ink-3">
            {lastText}
            {figureText ? ` · ${figureText}` : ""}
            {!tracker.owner.isYou && tracker.owner.name ? ` · ${tracker.owner.name}` : ""}
          </p>
        </div>
        {tracker.shared && tracker.owner.isYou ? (
          <StatusPill tone="neutral">
            <Trans>Shared</Trans>
          </StatusPill>
        ) : null}
      </div>
      {recent ? <WeekStrip tracker={tracker} days={recent.window} /> : null}
      {progress && targetText ? (
        <TargetBar tracker={tracker} progress={progress} targetText={targetText} />
      ) : null}
      {trackerIsReadinessCheckIn(tracker) ? (
        <p className="flex flex-wrap items-center gap-1 text-sm text-ink-3">
          <Link
            to="/scores"
            className="rounded-full hover:text-signal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {i18n._(TRACKER_CHECK_IN_COPY.label)}
          </Link>
          <InfoTip>
            <p>{i18n._(TRACKER_CHECK_IN_COPY.explanation)}</p>
          </InfoTip>
        </p>
      ) : null}
      {tracker.canLog ? (
        <div className="mt-auto">
          <TrackerLogForm tracker={tracker} onLogged={onLogged} compact />
        </div>
      ) : null}
    </li>
  );
}

/** Seven small bars, one per day; a day with nothing logged is a dot, not a zero. */
function WeekStrip({
  tracker,
  days,
}: {
  tracker: TrackerSummary;
  days: readonly { date: string; value: number | null }[];
}) {
  const { t, i18n } = useLingui();
  const max = Math.max(0, ...days.map((day) => day.value ?? 0));
  const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: "narrow", timeZone: "UTC" });
  return (
    <ol className="grid grid-cols-7 gap-1.5" aria-label={t`Last 7 days`}>
      {days.map((day) => {
        const height = stripHeight(day.value, tracker.type, max);
        const when = friendlyDate(i18n, day.date);
        const what =
          day.value === null ? t`nothing logged` : formatTrackerValue(i18n, tracker, day.value);
        return (
          <li key={day.date} className="grid justify-items-center gap-1">
            <span className="flex h-8 w-full items-end justify-center" aria-hidden="true">
              {height === null ? (
                <span className="mb-0.5 size-1.5 rounded-full bg-paper-3" />
              ) : (
                <span
                  className="w-full max-w-4 rounded-full bg-signal"
                  style={{ height: `${Math.max(12, height * 100)}%` }}
                />
              )}
            </span>
            <span className="text-xs text-ink-3" aria-hidden="true">
              {weekday.format(new Date(`${day.date}T00:00:00Z`))}
            </span>
            <span className="sr-only">{`${when}: ${what}`}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The target as a bar with its figures: "20 min of 1 h this week". */
function TargetBar({
  tracker,
  progress,
  targetText,
}: {
  tracker: TrackerSummary;
  progress: NonNullable<TrackerSummary["progress"]>;
  targetText: string;
}) {
  const { t, i18n } = useLingui();
  const weekly = progress.period === "week";
  const format = (value: number) =>
    weekly ? formatTrackerTotal(i18n, tracker, value) : formatTrackerValue(i18n, tracker, value);
  // Amounts that add up start from zero; an average or a rating has nothing to show yet.
  const counts = tracker.type === "yes_no" || tracker.aggregation === "sum";
  const current = progress.current ?? (counts ? 0 : null);
  const amount = format(progress.target);
  const currentText = current === null ? null : format(current);
  return (
    <div className="grid gap-1.5">
      <Meter
        value={current === null ? 0 : current / progress.target}
        tone="signal"
        label={t`Target progress`}
      />
      <p className="text-sm text-ink-3">
        {progress.met ? (
          <Trans>Target reached: {targetText}</Trans>
        ) : currentText === null ? (
          <Trans>Target: {targetText}</Trans>
        ) : weekly ? (
          <Trans>
            {currentText} of {amount} this week
          </Trans>
        ) : (
          <Trans>
            {currentText} of {amount} today
          </Trans>
        )}
      </p>
    </div>
  );
}

function ArchivedRow({ tracker, onChanged }: { tracker: TrackerSummary; onChanged: () => void }) {
  const { t } = useLingui();
  const restore = useMutation({
    mutationFn: () => client.trackers.setArchived({ id: tracker.id, archived: false }),
    onSuccess: onChanged,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not restore it. Try again.`),
  });
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <Link
        to="/trackers/$trackerId"
        params={{ trackerId: tracker.id }}
        className="truncate text-ink hover:underline"
      >
        {tracker.name}
      </Link>
      {tracker.canEdit ? (
        <Button
          variant="outline"
          size="sm"
          disabled={restore.isPending}
          onClick={() => restore.mutate()}
        >
          <Trans>Restore</Trans>
        </Button>
      ) : null}
    </li>
  );
}

function NewTracker({
  open,
  template,
  atLimit,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** Start from this template's form; null shows the template list first. */
  template: TrackerTemplateId | null;
  atLimit: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState<TrackerDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  // Each opening starts fresh: at the list, or at the chosen template.
  const opening = open ? (template ?? "pick") : null;
  if (opening !== openedFor) {
    setOpenedFor(opening);
    setShowErrors(false);
    setDraft(
      open && template
        ? templateTrackerDraft(template, i18n._(TRACKER_TEMPLATE_COPY[template].name))
        : null,
    );
  }
  const create = useMutation({
    mutationFn: (input: NonNullable<ReturnType<typeof trackerCreatePayload>>) =>
      client.trackers.create(input),
    onSuccess: (created) => {
      toast.success(t`${created.name} is ready to log.`);
      onCreated();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not create it. Try again.`),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={<Trans>New tracker</Trans>}
      size="lg"
    >
      {atLimit ? (
        <p role="status" className="text-ink-2">
          <Trans>
            You have 50 active trackers, the most you can have. Archive one to add another.
          </Trans>
        </p>
      ) : !draft ? (
        <div className="grid gap-3">
          <p className="text-ink-2">
            <Trans>Start from a template, or make your own.</Trans>
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {TRACKER_TEMPLATES.map((item) => {
              const copy = TRACKER_TEMPLATE_COPY[item.id];
              const Icon = trackerIcon(item.icon);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setDraft(templateTrackerDraft(item.id, i18n._(copy.name)))}
                    className="flex w-full items-start gap-3 rounded-xl border border-rule bg-card p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Icon className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden="true" />
                    <span className="grid gap-0.5">
                      <span className="font-semibold text-ink">{i18n._(copy.name)}</span>
                      <span className="text-sm text-ink-3">{i18n._(copy.description)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => setDraft(blankTrackerDraft())}
                className="flex w-full items-start gap-3 rounded-xl border border-dashed border-rule-2 bg-card p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Plus className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden="true" />
                <span className="grid gap-0.5">
                  <span className="font-semibold text-ink">
                    <Trans>Custom</Trans>
                  </span>
                  <span className="text-sm text-ink-3">
                    <Trans>A number, a 1 to 5 rating, yes or no, or a duration.</Trans>
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      ) : (
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            setShowErrors(true);
            const payload = trackerCreatePayload(draft, i18n.locale);
            if (payload && !create.isPending) create.mutate(payload);
          }}
        >
          <TrackerEditor draft={draft} onChange={setDraft} showErrors={showErrors} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Trans>Creating…</Trans> : <Trans>Create tracker</Trans>}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              <Trans>Back to templates</Trans>
            </Button>
          </div>
        </form>
      )}
    </FormDialog>
  );
}
