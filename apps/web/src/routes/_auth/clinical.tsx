import type { I18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  formatYear,
  imagingTypeLabel,
  summaryText,
} from "@openvalens/api/presenters/clinical-records";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import { orpc } from "@/utils/orpc";

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
        <PageHeader title={<Trans>Clinical</Trans>} />
        {[0, 1, 2].map((key) => (
          <div key={key} className="grid gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-28 w-full" />
          </div>
        ))}
      </Page>
    );
  }

  if (cardiac.isError || imaging.isError || family.isError) {
    return (
      <Page>
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
      <PageHeader title={<Trans>Clinical</Trans>} />

      <RecordSection
        title={t`Cardiac`}
        rows={cardiac.data}
        renderItem={(row) => renderCardiac(row, i18n)}
        emptyText={t`No cardiac exams recorded.`}
      />
      <RecordSection
        title={t`Imaging`}
        rows={imaging.data}
        renderItem={(row) => renderImaging(row, i18n)}
        emptyText={t`No imaging studies recorded.`}
      />
      <RecordSection
        title={t`Family history`}
        rows={family.data}
        renderItem={(row) => renderFamily(row, i18n)}
        emptyText={t`No family history entries.`}
      />
    </Page>
  );
}

type RecordItem = {
  /** What the record is, then any qualifier (body part, condition). */
  headline: readonly string[];
  date: string;
  /** Where it was done, if anywhere, and what it concluded. */
  secondary: readonly string[];
};

type RecordSectionProps<T> = {
  title: string;
  rows: readonly T[];
  renderItem: (row: T) => RecordItem;
  emptyText: string;
};

/** One kind of clinical record, printed as rows: what and where on the left, when on the right. */
function RecordSection<T>({ title, rows, renderItem, emptyText }: RecordSectionProps<T>) {
  return (
    <Section
      title={
        <>
          {title} <span className="num text-ink-3">({rows.length})</span>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <ul className="sheet divide-y divide-rule">
          {rows.map((row, index) => {
            const item = renderItem(row);
            return (
              <li
                key={index}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 px-5 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
              >
                <span className="font-display font-medium text-ink">
                  {item.headline.map((part, partIndex) => (
                    <span
                      key={partIndex}
                      className={partIndex > 0 ? "block text-sm text-ink-2" : ""}
                    >
                      {part}
                    </span>
                  ))}
                </span>
                <span className="col-span-2 row-start-2 text-sm text-ink-3 md:col-span-1 md:row-start-auto">
                  {item.secondary.map((part, partIndex) => (
                    <span key={partIndex} className="block">
                      {part}
                    </span>
                  ))}
                </span>
                <span className="num col-start-2 row-start-1 text-right text-sm text-ink-3 md:col-start-auto">
                  {item.date}
                </span>
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
    secondary: [row.facility ?? "—", summaryText(row.conclusion)],
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
    secondary: [row.facility ?? "—", summaryText(row.conclusion)],
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
    date: formatYear(row.ageOfOnset),
    secondary: [summaryText(row.notes)],
  };
}
