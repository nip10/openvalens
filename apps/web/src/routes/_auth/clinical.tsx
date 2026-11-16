import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  imagingTypeLabel,
  summaryText,
} from "@openvalens/api/presenters/clinical-records";
import { deviceTimeZone, localDateIn } from "@openvalens/api/presenters/nutrition-diary";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { HeartPulse, type LucideIcon, Pencil, Plus, ScanLine, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { ClinicalRecordDialog } from "@/components/clinical-record-dialog";
import { MoreMenu } from "@/components/more-menu";
import { EmptyState, ErrorState, Page, PageHeader, Section, ToneIcon } from "@/components/page";
import {
  cardiacDraft,
  clinicalPayload,
  emptyClinicalDraft,
  familyDraft,
  imagingDraft,
  type ClinicalDraft,
  type ClinicalRecordKind,
} from "@/utils/clinical-records";
import { client, orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/clinical")({
  component: ClinicalPage,
});

/** Saves a draft through the write procedure for its kind (#clinical-3). */
async function saveClinicalRecord(draft: ClinicalDraft) {
  const payload = clinicalPayload(draft);
  if (!payload) throw new Error("The record is not complete.");
  switch (payload.kind) {
    case "cardiac":
      return client.clinical.upsertCardiacExam(payload.input);
    case "imaging":
      return client.clinical.upsertImagingStudy(payload.input);
    case "family":
      return client.clinical.upsertFamilyHistoryEntry(payload.input);
  }
}

async function deleteClinicalRecord(target: { kind: ClinicalRecordKind; id: number }) {
  switch (target.kind) {
    case "cardiac":
      return client.clinical.deleteCardiacExam({ id: target.id });
    case "imaging":
      return client.clinical.deleteImagingStudy({ id: target.id });
    case "family":
      return client.clinical.deleteFamilyHistoryEntry({ id: target.id });
  }
}

export function ClinicalPage() {
  const { t, i18n } = useLingui();
  const qc = useQueryClient();
  const cardiac = useQuery(orpc.clinical.listCardiacExams.queryOptions({ input: {} }));
  const imaging = useQuery(orpc.clinical.listImagingStudies.queryOptions({ input: {} }));
  const family = useQuery(orpc.clinical.listFamilyHistory.queryOptions({ input: {} }));
  const today = useMemo(() => localDateIn(deviceTimeZone()), []);
  const [draft, setDraft] = useState<ClinicalDraft | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.clinical.key() });
  const save = useMutation({
    mutationFn: saveClinicalRecord,
    onSuccess: () => {
      setDraft(null);
      toast.success(t`Record saved.`);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: deleteClinicalRecord,
    onSuccess: () => {
      toast.success(t`Record deleted.`);
      refresh();
    },
    onError: () =>
      toast.error(t`Could not delete this record. Check your connection and try again.`),
  });
  const open = (next: ClinicalDraft) => {
    save.reset();
    setDraft(next);
  };
  const confirmDelete = (kind: ClinicalRecordKind, id: number) => {
    const question =
      kind === "cardiac"
        ? t`Delete this cardiac exam and its measurements? This cannot be undone.`
        : kind === "imaging"
          ? t`Delete this imaging study? This cannot be undone.`
          : t`Delete this family history entry? This cannot be undone.`;
    if (window.confirm(question) && !remove.isPending) remove.mutate({ kind, id });
  };
  const header = (
    <PageHeader
      title={<Trans>Clinical</Trans>}
      actions={
        <Button onClick={() => open(emptyClinicalDraft("cardiac", today))}>
          <Plus aria-hidden="true" />
          <Trans>Add record</Trans>
        </Button>
      }
    />
  );
  const dialog = (
    <ClinicalRecordDialog
      draft={draft}
      today={today}
      onDraftChange={setDraft}
      onClose={() => setDraft(null)}
      onSave={(next) => save.mutate(next)}
      saving={save.isPending}
      failed={save.isError}
    />
  );

  if (cardiac.isPending || imaging.isPending || family.isPending) {
    return (
      <Page>
        <ModuleHiddenNote module="labs" />
        <PageHeader title={<Trans>Clinical</Trans>} />
        <div className="grid gap-4 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-32 w-full rounded-3xl" />
          ))}
        </div>
      </Page>
    );
  }

  if (cardiac.isError || imaging.isError || family.isError) {
    return (
      <Page>
        <ModuleHiddenNote module="labs" />
        <PageHeader title={<Trans>Clinical</Trans>} />
        <ErrorState
          title={<Trans>Could not load clinical records.</Trans>}
          action={
            <Button
              variant="outline"
              onClick={() => {
                void cardiac.refetch();
                void imaging.refetch();
                void family.refetch();
              }}
            >
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <ModuleHiddenNote module="labs" />
      {header}

      {/* #clinical-4: the counts sit in each section head; no tiles repeating them. */}
      <RecordSection
        icon={HeartPulse}
        title={t`Cardiac`}
        rows={cardiac.data}
        renderItem={(row) => renderCardiac(row, i18n)}
        emptyText={t`No cardiac exams recorded.`}
        onOpen={(row) => open(cardiacDraft(row))}
        onDelete={(row) => confirmDelete("cardiac", row.id)}
      />
      <RecordSection
        icon={ScanLine}
        title={t`Imaging`}
        rows={imaging.data}
        renderItem={(row) => renderImaging(row, i18n)}
        emptyText={t`No imaging studies recorded.`}
        onOpen={(row) => open(imagingDraft(row))}
        onDelete={(row) => confirmDelete("imaging", row.id)}
      />
      <RecordSection
        icon={Users}
        title={t`Family history`}
        rows={family.data}
        renderItem={(row) => renderFamily(row, i18n)}
        emptyText={t`No family history entries.`}
        onOpen={(row) => open(familyDraft(row))}
        onDelete={(row) => confirmDelete("family", row.id)}
      />
      {dialog}
    </Page>
  );
}

/** #clinical-5: a record's day, always with its year ("7 Sep 2026"). */
function recordDate(i18n: I18n, iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(i18n.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

/** #clinical-2: the age a condition started, labelled, or null when not recorded. */
function onsetNote(ageOfOnset: number | null, i18n: I18n): string | null {
  if (ageOfOnset === null || !Number.isFinite(ageOfOnset)) return null;
  const age = Math.trunc(ageOfOnset);
  return i18n._(msg`Onset at ${age}`);
}

/** The recorded parts only: a missing facility or note leaves no "—" line. */
function presentParts(...parts: Array<string | null | undefined>): string[] {
  return parts.map((part) => part?.trim() ?? "").filter((part) => part.length > 0);
}

type RecordItem = {
  /** What the record is, then any qualifier (body part, condition). */
  headline: readonly string[];
  /** An ISO day, shown with its year (clinical history spans decades), or null. */
  date: string | null;
  /** A label in place of a date, such as "Onset at 61" (#clinical-2), or null. */
  note: string | null;
  /** Where it was done, if anywhere, and what it concluded. */
  secondary: readonly string[];
};

type RecordSectionProps<T> = {
  icon: LucideIcon;
  title: string;
  rows: readonly T[];
  renderItem: (row: T) => RecordItem;
  emptyText: string;
  /** Opens the record with every recorded field, ready to edit (#clinical-3). */
  onOpen: (row: T) => void;
  onDelete: (row: T) => void;
};

/** One kind of clinical record, as cards: what and where, with when in a chip. */
function RecordSection<T extends { id: number }>({
  icon,
  title,
  rows,
  renderItem,
  emptyText,
  onOpen,
  onDelete,
}: RecordSectionProps<T>) {
  const { t, i18n } = useLingui();
  return (
    <Section
      icon={icon}
      tone="water"
      title={
        <>
          {title} <span className="num text-ink-3">({rows.length})</span>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState icon={icon} title={emptyText} />
      ) : (
        // #clinical-6: one record per row across the width, like a medical record.
        <ul className="grid gap-3">
          {rows.map((row) => {
            const item = renderItem(row);
            const name = item.headline.join(", ");
            return (
              <li key={row.id} className="sheet flex min-w-0 items-start gap-3 p-4">
                <ToneIcon icon={icon} tone="water" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <button
                    type="button"
                    onClick={() => onOpen(row)}
                    aria-label={t`Open ${name}`}
                    className="rounded-sm text-left font-semibold break-words text-ink hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {item.headline.map((part, partIndex) => (
                      <span
                        key={partIndex}
                        className={partIndex > 0 ? "block text-sm font-normal text-ink-2" : ""}
                      >
                        {part}
                      </span>
                    ))}
                  </button>
                  {item.secondary.map((part, partIndex) => (
                    <span key={partIndex} className="block text-sm break-words text-ink-3">
                      {part}
                    </span>
                  ))}
                </div>
                {item.date ? (
                  <span className="num shrink-0 rounded-full bg-water-soft px-2.5 py-1 text-sm font-semibold text-ink">
                    {recordDate(i18n, item.date)}
                  </span>
                ) : item.note ? (
                  <span className="shrink-0 rounded-full bg-paper-2 px-2.5 py-1 text-sm text-ink-2">
                    {item.note}
                  </span>
                ) : null}
                <div className="-my-1 -mr-1 shrink-0">
                  <MoreMenu
                    label={t`More for ${name}`}
                    items={[
                      { label: t`Edit`, icon: Pencil, onSelect: () => onOpen(row) },
                      {
                        label: t`Delete`,
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => onDelete(row),
                      },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

type CardiacRow = {
  date: string;
  type: string;
  facility: string | null;
  conclusion: string | null;
};
function renderCardiac(row: CardiacRow, i18n: I18n): RecordItem {
  return {
    headline: [cardiacExamTypeLabel(row.type, i18n)],
    date: row.date,
    note: null,
    secondary: presentParts(row.facility, row.conclusion ? summaryText(row.conclusion) : null),
  };
}

type ImagingRow = {
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  conclusion: string | null;
};
function renderImaging(row: ImagingRow, i18n: I18n): RecordItem {
  return {
    headline: [imagingTypeLabel(row.type, i18n), row.bodyPart],
    date: row.date,
    note: null,
    secondary: presentParts(row.facility, row.conclusion ? summaryText(row.conclusion) : null),
  };
}

type FamilyRow = {
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
};
function renderFamily(row: FamilyRow, i18n: I18n): RecordItem {
  return {
    headline: [familyRelationLabel(row.relation, i18n), row.condition],
    date: null,
    note: onsetNote(row.ageOfOnset, i18n),
    secondary: presentParts(row.notes ? summaryText(row.notes) : null),
  };
}
