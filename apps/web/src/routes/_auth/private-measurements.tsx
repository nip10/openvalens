import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { Button } from "@openvalens/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@openvalens/ui/components/dropdown-menu";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Lock, MoreHorizontal, Plus, Ruler, Scale, ShieldCheck } from "lucide-react";

import { FormDialog } from "@/components/form-dialog";
import {
  EmptyState,
  ErrorState,
  InfoTip,
  Page,
  PageHeader,
  Section,
  StatusPill,
  ToneIcon,
} from "@/components/page";
import { ProgressPhotos } from "@/components/progress-photos";
import { useLogDialog } from "@/components/quick-log/log-launcher";
import { authClient } from "@/lib/auth-client";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import {
  PRIVATE_MEASUREMENT_KINDS,
  makePrivateMeasurementPayload,
  mayShowStoredMeasurementValue,
  nextKindDraft,
  nextUnitDraft,
  privateMeasurementQueryKeys,
  privateMeasurementAccessState,
  privateMeasurementHistoryState,
  shouldShowPrivateMeasurementDeleteError,
  unitsForMeasurement,
  type PrivateMeasurementKind,
} from "@/utils/private-measurements";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/private-measurements")({
  component: PrivateMeasurements,
});

type Kind = PrivateMeasurementKind;
type Unit = "kg" | "lb" | "cm" | "in";
type Entry = { id: string; kind: string; value: number; unit: string; measuredAt: string };
const kinds = PRIVATE_MEASUREMENT_KINDS;
const KIND_LABELS: Record<Kind, MessageDescriptor> = {
  weight: msg`Weight`,
  waist: msg`Waist`,
  hip: msg`Hip`,
  neck: msg`Neck`,
  chest: msg`Chest`,
  upper_arm: msg`Upper arm`,
  thigh: msg`Thigh`,
};
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function PrivateMeasurements() {
  const { data: auth, isPending } = authClient.useSession();
  const subject =
    auth?.user?.id && auth.session.activeOrganizationId
      ? { userId: auth.user.id, organizationId: auth.session.activeOrganizationId }
      : null;
  if (isPending || !subject) {
    return (
      <Page>
        <ModuleHiddenNote module="body" />
        <PageHeader title={<Trans>Private measurements</Trans>} />
        <p role="status" className="text-sm text-ink-3">
          {isPending ? (
            <Trans>Checking your account and workspace…</Trans>
          ) : (
            <Trans>Choose a workspace to continue.</Trans>
          )}
        </p>
      </Page>
    );
  }
  return (
    <PrivateMeasurementsForSubject
      key={`${subject.organizationId}:${subject.userId}`}
      subject={subject}
    />
  );
}

/** The add or edit form, in a dialog: measurement, value with unit, and time. */
type Draft = { id: string | null; kind: Kind; unit: Unit; value: string; measuredAt: string };

function MeasurementDialog({
  draft,
  onDraftChange,
  onClose,
  onSave,
  saving,
  failed,
}: {
  draft: Draft | null;
  onDraftChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  saving: boolean;
  failed: boolean;
}) {
  const { t, i18n } = useLingui();
  if (!draft) return null;
  const label = i18n._(KIND_LABELS[draft.kind]);
  const payload = makePrivateMeasurementPayload({
    kind: draft.kind,
    unit: draft.unit,
    value: draft.value,
    measuredAtLocal: draft.measuredAt,
  });
  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={draft.id ? <Trans>Edit entry</Trans> : <Trans>Add a measurement</Trans>}
      description={<Trans>Private to you. Workspace owners and members cannot see it.</Trans>}
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (payload && !saving) onSave(draft);
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="measurement-kind">
            <Trans>Measurement</Trans>
          </Label>
          <Select
            value={draft.kind}
            onValueChange={(next) => {
              const kind = next as Kind;
              const reset = nextKindDraft(kind);
              onDraftChange({ ...draft, kind: reset.kind, unit: reset.unit, value: reset.value });
            }}
          >
            <SelectTrigger
              id="measurement-kind"
              className="w-full"
              aria-label={t`Measurement type`}
            >
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {kinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {i18n._(KIND_LABELS[kind])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="measurement-value">{t`${label} value`}</Label>
          <div className="flex gap-2">
            <Input
              id="measurement-value"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              autoFocus
              value={draft.value}
              onChange={(event) => onDraftChange({ ...draft, value: event.target.value })}
            />
            <Select
              value={draft.unit}
              onValueChange={(next) => {
                const reset = nextUnitDraft(next);
                onDraftChange({ ...draft, unit: reset.unit as Unit, value: reset.value });
              }}
            >
              <SelectTrigger aria-label={t`Unit`} className="w-24 shrink-0">
                <SelectValue>{draft.unit}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {unitsForMeasurement(draft.kind).map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="measurement-time">
            <Trans>Observed at</Trans>
          </Label>
          <Input
            id="measurement-time"
            type="datetime-local"
            value={draft.measuredAt}
            onChange={(event) => onDraftChange({ ...draft, measuredAt: event.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={!payload || saving}>
            {saving ? (
              <Trans>Saving…</Trans>
            ) : draft.id ? (
              <Trans>Save changes</Trans>
            ) : (
              <Trans>Save entry</Trans>
            )}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          {failed ? (
            <span role="alert" className="text-sm text-destructive">
              <Trans>Could not save. Check your connection and try again.</Trans>
            </span>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}

function PrivateMeasurementsForSubject({
  subject,
}: {
  subject: { userId: string; organizationId: string };
}) {
  const qc = useQueryClient();
  const { t, i18n } = useLingui();
  const labelOf = (value: string) => {
    const known = KIND_LABELS[value as Kind];
    return known ? i18n._(known) : value;
  };
  const keys = privateMeasurementQueryKeys(subject);
  const preference = useQuery({
    queryKey: keys.preference,
    queryFn: () => client.privateBody.preference({}),
    enabled: Boolean(subject.userId && subject.organizationId),
    retry: false,
  });
  // The member's hide-numbers setting (#80) lives with the nutrition target
  // settings. Fail closed: values show only once it is confirmed off.
  const localDate = useMemo(() => localDateIn(deviceTimeZone()), []);
  const displaySettings = useQuery({
    ...orpc.nutritionTargets.get.queryOptions({ input: { localDate } }),
    enabled: preference.data?.enabled === true,
    retry: false,
  });
  const history = useQuery({
    queryKey: keys.list,
    queryFn: () => client.privateBody.list({}),
    enabled: Boolean(subject.userId && subject.organizationId) && preference.data?.enabled === true,
  });
  const accessState = privateMeasurementAccessState({
    identityKnown: Boolean(subject.userId && subject.organizationId),
    preferenceStatus: preference.isPending ? "pending" : preference.isError ? "error" : "success",
    enabled: preference.data?.enabled,
  });
  const historyState = privateMeasurementHistoryState({
    status: history.isPending ? "pending" : history.isError ? "error" : "success",
    count: history.data?.length,
  });
  const entries = ((history.data ?? []) as Entry[])
    .slice()
    .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState("");
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.preference });
    void qc.invalidateQueries({ queryKey: keys.list });
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => client.privateBody.setPreference({ enabled }),
    onSuccess: invalidate,
  });
  const save = useMutation({
    mutationFn: (entry: Draft) => {
      const input = makePrivateMeasurementPayload({
        kind: entry.kind,
        unit: entry.unit,
        value: entry.value,
        measuredAtLocal: entry.measuredAt,
      });
      if (!input) throw new Error(t`Enter a valid measurement and observed time.`);
      return entry.id
        ? client.privateBody.update({ id: entry.id, value: input })
        : client.privateBody.create(input);
    },
    onSuccess: () => {
      setDraft(null);
      setNotice(t`Entry saved.`);
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.privateBody.delete({ id }),
    onSuccess: () => {
      invalidate();
      setNotice(t`Entry deleted.`);
      historyHeadingRef.current?.focus();
    },
    onError: (_error, id) => {
      setDeleteErrorId(id);
      setNotice(t`Could not delete this entry. Check your connection and try again.`);
    },
  });
  const deleteEntry = (id: string) => {
    if (window.confirm(t`Delete this private measurement? This cannot be undone.`)) {
      if (!remove.isPending) remove.mutate(id);
    }
  };

  // A new entry starts at the kind logged last.
  const openNew = () => {
    save.reset();
    const last = (entries[0]?.kind as Kind | undefined) ?? "weight";
    const kind = (kinds as readonly string[]).includes(last) ? last : "weight";
    const reset = nextKindDraft(kind);
    setDraft({ id: null, kind, unit: reset.unit, value: "", measuredAt: nowLocal() });
  };
  const enabled = accessState === "enabled";
  useLogDialog("private_measurement", enabled ? openNew : null);

  const canDisplayStoredValues = mayShowStoredMeasurementValue(
    displaySettings.isSuccess ? displaySettings.data?.settings.hideNumbers : undefined,
  );
  const byKind = new Map<string, Entry[]>();
  for (const entry of entries) byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
  const groups = [...byKind.entries()].sort(
    ([a], [b]) => (kinds as readonly string[]).indexOf(a) - (kinds as readonly string[]).indexOf(b),
  );

  return (
    <Page>
      <ModuleHiddenNote module="body" />
      <PageHeader
        title={<Trans>Private measurements</Trans>}
        info={
          <Trans>
            These manual entries are private to your account. Workspace owners and other members
            cannot view them. They are separate from shared workspace body records.
          </Trans>
        }
        actions={
          enabled ? (
            <Button onClick={openNew}>
              <Plus aria-hidden="true" />
              <Trans>Add a measurement</Trans>
            </Button>
          ) : undefined
        }
      />
      {accessState === "identity-pending" ? (
        <div className="grid gap-3" role="status">
          <p className="text-sm text-ink-3">
            <Trans>Checking your private measurement setting…</Trans>
          </p>
          <Skeleton className="h-40 w-full" />
        </div>
      ) : accessState === "preference-error" ? (
        <ErrorState
          title={
            <Trans>
              Could not check this setting. Measurements stay unavailable until it can be confirmed.
            </Trans>
          }
          action={
            <Button variant="outline" onClick={() => void preference.refetch()}>
              <Trans>Try again</Trans>
            </Button>
          }
        />
      ) : accessState === "disabled" ? (
        <Section
          icon={Lock}
          tone="weight"
          title={<Trans>Private measurements are off</Trans>}
          sheet
          className="max-w-3xl"
        >
          <div className="grid justify-items-start gap-4">
            <p className="max-w-[65ch] text-ink-2">
              <Trans comment="safety">
                Turn this on to record weight or circumference measurements and progress photos for
                your own reference. It is off by default.
              </Trans>
            </p>
            <Button onClick={() => toggle.mutate(true)} disabled={toggle.isPending}>
              {toggle.isPending ? (
                <Trans>Saving…</Trans>
              ) : (
                <Trans>Turn on private measurements</Trans>
              )}
            </Button>
            {toggle.isError && (
              <p role="alert" className="text-sm text-destructive">
                <Trans>Could not update this setting. Try again.</Trans>
              </p>
            )}
          </div>
        </Section>
      ) : (
        <>
          <div className="sheet flex items-center justify-between gap-3 px-5 py-3">
            <span className="flex min-w-0 items-center gap-3 font-semibold text-ink-2">
              <ToneIcon icon={ShieldCheck} tone="weight" size="sm" />
              <span className="min-w-0">
                <Trans>Private measurements are on</Trans>
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => toggle.mutate(false)}
              disabled={toggle.isPending}
            >
              <Trans>Turn off</Trans>
            </Button>
          </div>
          {toggle.isError && (
            <p role="alert" className="text-sm text-destructive">
              <Trans>Could not update this setting. Try again.</Trans>
            </p>
          )}
          <section className="grid min-w-0 content-start gap-3">
            <div className="flex items-center gap-2">
              <h2
                ref={historyHeadingRef}
                tabIndex={-1}
                className="text-xl leading-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Trans>History</Trans>
              </h2>
              {canDisplayStoredValues ? null : (
                <InfoTip>
                  <Trans>
                    Values are hidden while Hide numbers is on in Nutrition targets, or until that
                    setting can be checked.
                  </Trans>
                </InfoTip>
              )}
            </div>
            <div>
              {historyState === "loading" ? (
                <div className="grid gap-3">
                  <p role="status" className="text-sm text-ink-3">
                    <Trans>Loading your entries…</Trans>
                  </p>
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : historyState === "error" ? (
                <ErrorState
                  title={<Trans>Could not load entries.</Trans>}
                  action={
                    <Button variant="outline" onClick={() => void history.refetch()}>
                      <Trans>Try again</Trans>
                    </Button>
                  }
                />
              ) : historyState === "empty" ? (
                <EmptyState icon={Ruler} title={<Trans>No private entries yet.</Trans>} />
              ) : (
                <div className="grid items-start gap-6 lg:grid-cols-2">
                  {groups.map(([kind, rows]) => {
                    const label = labelOf(kind);
                    return (
                      <section
                        key={kind}
                        aria-label={label}
                        className="sheet grid min-w-0 content-start gap-1 px-5 pt-4 pb-1"
                      >
                        <h3 className="flex items-center gap-2.5 font-body text-base font-semibold tracking-normal text-ink-2">
                          <ToneIcon
                            icon={kind === "weight" ? Scale : Ruler}
                            tone="weight"
                            size="sm"
                          />
                          {label}
                        </h3>
                        <ul className="grid divide-y divide-rule">
                          {rows.map((row, index) => {
                            const when = new Date(row.measuredAt).toLocaleString();
                            const localIso = toLocalInput(row.measuredAt);
                            const before = rows[index + 1];
                            const change =
                              canDisplayStoredValues && before && before.unit === row.unit
                                ? Math.round((row.value - before.value) * 10) / 10
                                : null;
                            return (
                              <li key={row.id} className="grid gap-1 py-2.5">
                                <div className="flex items-center gap-3">
                                  <time
                                    dateTime={row.measuredAt}
                                    title={when}
                                    className="num min-w-0 flex-1 text-sm text-ink-2"
                                  >
                                    {`${friendlyDate(i18n, localIso)} ${localIso.slice(11, 16)}`}
                                  </time>
                                  {canDisplayStoredValues ? (
                                    <span className="num font-semibold text-ink">
                                      {row.value} {row.unit}
                                      {change !== null ? (
                                        <span className="ml-2 text-sm font-normal text-ink-3">
                                          {change > 0 ? `+${change}` : `${change}`}
                                        </span>
                                      ) : null}
                                    </span>
                                  ) : (
                                    <StatusPill tone="neutral">
                                      <Lock className="mr-1 size-3" aria-hidden="true" />
                                      <Trans>Hidden</Trans>
                                    </StatusPill>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={t`Edit ${label} entry from ${when}`}
                                    onClick={() => {
                                      save.reset();
                                      setDraft({
                                        id: row.id,
                                        kind: row.kind as Kind,
                                        unit: row.unit as Unit,
                                        // Start from the stored value, unless numbers are hidden.
                                        value: canDisplayStoredValues ? String(row.value) : "",
                                        measuredAt: localIso,
                                      });
                                    }}
                                  >
                                    <Trans>Edit</Trans>
                                  </Button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-8"
                                        aria-label={t`More for ${label} entry from ${when}`}
                                      >
                                        <MoreHorizontal className="size-4" aria-hidden="true" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem
                                        variant="destructive"
                                        disabled={remove.isPending}
                                        aria-label={t`Delete ${label} entry from ${when}`}
                                        onSelect={() => deleteEntry(row.id)}
                                      >
                                        <Trans>Delete</Trans>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                {shouldShowPrivateMeasurementDeleteError({
                                  rowId: row.id,
                                  failedRowId: deleteErrorId,
                                  isError: remove.isError,
                                }) && (
                                  <div role="alert">
                                    <p className="text-sm text-destructive">
                                      <Trans>
                                        Could not delete this entry. It is still in your history.
                                      </Trans>
                                    </p>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="mt-2"
                                      onClick={() => remove.mutate(row.id)}
                                      disabled={remove.isPending}
                                    >
                                      <Trans>Try delete again</Trans>
                                    </Button>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
              {notice ? (
                <p role="status" className="sr-only">
                  {notice}
                </p>
              ) : null}
            </div>
          </section>
          <ProgressPhotos subject={subject} />
        </>
      )}

      <MeasurementDialog
        draft={draft}
        onDraftChange={setDraft}
        onClose={() => setDraft(null)}
        onSave={(entry) => save.mutate(entry)}
        saving={save.isPending}
        failed={save.isError}
      />
    </Page>
  );
}
