import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { History, Lock, Plus, Ruler, Scale, ShieldCheck } from "lucide-react";

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
import { authClient } from "@/lib/auth-client";
import { friendlyDate } from "@/utils/friendly";
import { client } from "@/utils/orpc";
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

export const Route = createFileRoute("/_auth/private-measurements")({
  component: PrivateMeasurements,
});

type Kind = PrivateMeasurementKind;
type Unit = "kg" | "lb" | "cm" | "in";
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
const NATIVE_SELECT =
  "h-9 rounded-md border border-input bg-card px-3 text-ink hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function PrivateMeasurements() {
  const { data: auth, isPending } = authClient.useSession();
  const subject =
    auth?.user?.id && auth.session.activeOrganizationId
      ? { userId: auth.user.id, organizationId: auth.session.activeOrganizationId }
      : null;
  if (isPending || !subject) {
    return (
      <Page width="narrow">
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
  // Hide-numbers preference (#80) is not yet available. Fail closed: never
  // render stored values until that client-safe preference can be confirmed.
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
  const [kind, setKind] = useState<Kind>("weight");
  const [unit, setUnit] = useState<Unit>("kg");
  const [value, setValue] = useState("");
  const [measuredAt, setMeasuredAt] = useState(nowLocal);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (editing) valueInputRef.current?.focus();
  }, [editing]);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.preference });
    void qc.invalidateQueries({ queryKey: keys.list });
  };
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => client.privateBody.setPreference({ enabled }),
    onSuccess: invalidate,
  });
  const save = useMutation({
    mutationFn: (id?: string) => {
      const input = makePrivateMeasurementPayload({
        kind,
        unit,
        value,
        measuredAtLocal: measuredAt,
      });
      if (!input) throw new Error(t`Enter a valid measurement and observed time.`);
      return id
        ? client.privateBody.update({ id, value: input })
        : client.privateBody.create(input);
    },
    onSuccess: () => {
      setValue("");
      setEditing(null);
      setMeasuredAt(nowLocal());
      setNotice(t`Entry saved.`);
      invalidate();
    },
    onError: () => setNotice(t`Could not save. Check your connection and try again.`),
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
  const draftPayload = makePrivateMeasurementPayload({
    kind,
    unit,
    value,
    measuredAtLocal: measuredAt,
  });
  const canDisplayStoredValues = mayShowStoredMeasurementValue(undefined);
  return (
    <Page width="narrow">
      <PageHeader
        title={<Trans>Private measurements</Trans>}
        info={
          <Trans>
            These manual entries are private to your account. Workspace owners and other members
            cannot view them. They are separate from shared workspace body records.
          </Trans>
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
          <div className="sheet flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <span className="flex items-center gap-3 font-semibold text-ink-2">
              <ToneIcon icon={ShieldCheck} tone="weight" />
              <Trans>Private measurements are on</Trans>
            </span>
            <Button
              variant="outline"
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
          <Section
            icon={Plus}
            tone="weight"
            title={editing ? <Trans>Edit entry</Trans> : <Trans>Add an entry</Trans>}
            sheet
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="measurement-kind">
                  <Trans>Measurement</Trans>
                </Label>
                <select
                  id="measurement-kind"
                  className={NATIVE_SELECT}
                  value={kind}
                  onChange={(e) => {
                    const next = e.target.value as Kind;
                    const draft = nextKindDraft(next);
                    setEditing(null);
                    setKind(draft.kind);
                    setUnit(draft.unit);
                    setValue(draft.value);
                  }}
                  aria-label={t`Measurement type`}
                >
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {i18n._(KIND_LABELS[k])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="measurement-value">{t`${labelOf(kind)} value`}</Label>
                <div className="flex gap-2">
                  <Input
                    id="measurement-value"
                    ref={valueInputRef}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                  <select
                    aria-label={t`Unit`}
                    className={NATIVE_SELECT}
                    value={unit}
                    onChange={(e) => {
                      const draft = nextUnitDraft(e.target.value);
                      setEditing(null);
                      setUnit(draft.unit as Unit);
                      setValue(draft.value);
                    }}
                  >
                    {unitsForMeasurement(kind).map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="measurement-time">
                  <Trans>Observed at</Trans>
                </Label>
                <Input
                  id="measurement-time"
                  type="datetime-local"
                  value={measuredAt}
                  onChange={(e) => setMeasuredAt(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button
                  onClick={() => save.mutate(editing ?? undefined)}
                  disabled={!draftPayload || save.isPending}
                >
                  {save.isPending ? (
                    <Trans>Saving…</Trans>
                  ) : editing ? (
                    <Trans>Save changes</Trans>
                  ) : (
                    <Trans>Save entry</Trans>
                  )}
                </Button>
                {editing && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(null);
                      setValue("");
                    }}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                )}
                {save.isError && (
                  <span role="alert" className="text-sm text-destructive">
                    {notice}
                  </span>
                )}
              </div>
            </div>
          </Section>
          <section className="grid min-w-0 content-start gap-3">
            <div className="flex items-center gap-2">
              <ToneIcon icon={History} tone="weight" size="sm" />
              <h2
                ref={historyHeadingRef}
                tabIndex={-1}
                className="text-xl leading-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Trans>History</Trans>
              </h2>
              <InfoTip>
                <Trans>Values are hidden until your hide-numbers setting can be checked.</Trans>
              </InfoTip>
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
                <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {(history.data ?? []).map((row) => {
                    const label = labelOf(row.kind);
                    const when = new Date(row.measuredAt).toLocaleString();
                    const measured = new Date(row.measuredAt);
                    const localIso = new Date(
                      measured.getTime() - measured.getTimezoneOffset() * 60000,
                    ).toISOString();
                    return (
                      <li key={row.id} className="sheet grid min-w-0 content-start gap-3 p-4">
                        <div className="flex items-start gap-3">
                          <ToneIcon icon={row.kind === "weight" ? Scale : Ruler} tone="weight" />
                          <div className="grid min-w-0 flex-1 gap-0.5">
                            <span className="font-semibold text-ink">{label}</span>
                            <span className="text-sm text-ink-3">
                              <time dateTime={row.measuredAt} title={when}>
                                {`${friendlyDate(i18n, localIso)} ${localIso.slice(11, 16)}`}
                              </time>
                            </span>
                          </div>
                          {canDisplayStoredValues ? (
                            <span className="num shrink-0 rounded-full bg-weight-soft px-2.5 py-1 text-sm font-semibold text-ink">
                              {row.value} {row.unit}
                            </span>
                          ) : (
                            <StatusPill tone="neutral">
                              <Lock className="mr-1 size-3" aria-hidden="true" />
                              <Trans>Hidden</Trans>
                            </StatusPill>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={t`Edit ${label} entry from ${when}`}
                            onClick={() => {
                              setEditing(row.id);
                              setKind(row.kind as Kind);
                              setUnit(row.unit as Unit);
                              setValue("");
                              setMeasuredAt(
                                new Date(
                                  new Date(row.measuredAt).getTime() -
                                    new Date(row.measuredAt).getTimezoneOffset() * 60000,
                                )
                                  .toISOString()
                                  .slice(0, 16),
                              );
                            }}
                          >
                            <Trans>Edit</Trans>
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            aria-label={t`Delete ${label} entry from ${when}`}
                            onClick={() => deleteEntry(row.id)}
                            disabled={remove.isPending}
                          >
                            <Trans>Delete</Trans>
                          </Button>
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
              )}
              {notice && !save.isError && (
                <p role="status" className="sr-only">
                  {notice}
                </p>
              )}
            </div>
          </section>
          <ProgressPhotos subject={subject} />
        </>
      )}
    </Page>
  );
}
