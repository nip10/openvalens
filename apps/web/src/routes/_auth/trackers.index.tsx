import { Trans, useLingui } from "@lingui/react/macro";
import {
  formatTrackerTarget,
  formatTrackerTotal,
  formatTrackerValue,
  TRACKER_TEMPLATE_COPY,
} from "@openvalens/api/presenters/trackers";
import { TRACKER_LIMITS, TRACKER_TEMPLATES } from "@openvalens/trackers/model";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ListChecks, Plus, Users, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  ErrorState,
  Meter,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
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
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/trackers/")({ component: TrackersPage });

type TrackerSummary = Awaited<ReturnType<typeof client.trackers.list>>[number];

/** Custom trackers (#441): the member's own and the workspace's shared ones. */
function TrackersPage() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
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
        !creating ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            <Trans>New tracker</Trans>
          </Button>
        ) : null
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

  return (
    <Page>
      {header}
      {creating ? (
        <NewTracker
          atLimit={atLimit}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      ) : null}

      {mine.length === 0 && shared.length === 0 && !creating ? (
        <EmptyState
          icon={ListChecks}
          title={<Trans>No trackers yet</Trans>}
          description={
            <Trans>Start from a template such as Mood or Sauna, or make your own.</Trans>
          }
          action={
            <Button onClick={() => setCreating(true)}>
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

      <div className="grid gap-3">
        <Button
          variant="ghost"
          className="justify-self-start"
          aria-expanded={showArchived}
          onClick={() => setShowArchived((value) => !value)}
        >
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
  const todayText =
    tracker.today === null
      ? t`Nothing logged today`
      : formatTrackerValue(i18n, tracker, tracker.today);
  const currentText =
    progress && progress.current !== null
      ? progress.period === "week"
        ? formatTrackerTotal(i18n, tracker, progress.current)
        : formatTrackerValue(i18n, tracker, progress.current)
      : null;
  const targetText = tracker.target ? formatTrackerTarget(i18n, tracker, tracker.target) : null;
  return (
    <li className="sheet grid content-start gap-4 p-5">
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
          <p className="text-sm text-ink-3">
            {todayText}
            {!tracker.owner.isYou && tracker.owner.name ? ` · ${tracker.owner.name}` : ""}
          </p>
        </div>
        {tracker.shared && tracker.owner.isYou ? (
          <StatusPill tone="neutral">
            <Trans>Shared</Trans>
          </StatusPill>
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
            {progress.met ? (
              <Trans>Target reached: {targetText}</Trans>
            ) : currentText ? (
              <Trans>
                {currentText} of {targetText}
              </Trans>
            ) : (
              <Trans>Target: {targetText}</Trans>
            )}
          </p>
        </div>
      ) : null}
      {tracker.canLog ? <TrackerLogForm tracker={tracker} onLogged={onLogged} compact /> : null}
    </li>
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
  atLimit,
  onClose,
  onCreated,
}: {
  atLimit: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, i18n } = useLingui();
  const [draft, setDraft] = useState<TrackerDraft | null>(null);
  const [showErrors, setShowErrors] = useState(false);
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
    <Section
      title={<Trans>New tracker</Trans>}
      actions={
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t`Close`}>
          <X aria-hidden="true" />
        </Button>
      }
      sheet
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
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TRACKER_TEMPLATES.map((template) => {
              const copy = TRACKER_TEMPLATE_COPY[template.id];
              const Icon = trackerIcon(template.icon);
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => setDraft(templateTrackerDraft(template.id, i18n._(copy.name)))}
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
    </Section>
  );
}
