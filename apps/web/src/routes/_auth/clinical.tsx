import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  imagingTypeLabel,
  summaryText,
} from "@openvalens/api/presenters/clinical-records";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { HeartPulse, type LucideIcon, ScanLine, Users } from "lucide-react";

import { EmptyState, ErrorState, Page, PageHeader, Section, ToneIcon } from "@/components/page";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

export const Route = createFileRoute("/_auth/clinical")({
  component: ClinicalPage,
});

function ClinicalPage() {
  const { t, i18n } = useLingui();
  const cardiac = useQuery(orpc.clinical.listCardiacExams.queryOptions({ input: {} }));
  const imaging = useQuery(orpc.clinical.listImagingStudies.queryOptions({ input: {} }));
  const family = useQuery(orpc.clinical.listFamilyHistory.queryOptions({ input: {} }));

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
      <PageHeader title={<Trans>Clinical</Trans>} />

      {/* #clinical-4: the counts sit in each section head; no tiles repeating them. */}
      <RecordSection
        icon={HeartPulse}
        title={t`Cardiac`}
        rows={cardiac.data}
        renderItem={(row) => renderCardiac(row, i18n)}
        emptyText={t`No cardiac exams recorded.`}
      />
      <RecordSection
        icon={ScanLine}
        title={t`Imaging`}
        rows={imaging.data}
        renderItem={(row) => renderImaging(row, i18n)}
        emptyText={t`No imaging studies recorded.`}
      />
      <RecordSection
        icon={Users}
        title={t`Family history`}
        rows={family.data}
        renderItem={(row) => renderFamily(row, i18n)}
        emptyText={t`No family history entries.`}
      />
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
};

/** One kind of clinical record, as cards: what and where, with when in a chip. */
function RecordSection<T>({ icon, title, rows, renderItem, emptyText }: RecordSectionProps<T>) {
  const { i18n } = useLingui();
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
          {rows.map((row, index) => {
            const item = renderItem(row);
            return (
              <li key={index} className="sheet flex min-w-0 items-start gap-3 p-4">
                <ToneIcon icon={icon} tone="water" />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-semibold break-words text-ink">
                    {item.headline.map((part, partIndex) => (
                      <span
                        key={partIndex}
                        className={partIndex > 0 ? "block text-sm font-normal text-ink-2" : ""}
                      >
                        {part}
                      </span>
                    ))}
                  </span>
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
