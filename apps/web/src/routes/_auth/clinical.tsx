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

import { HeartPulse, type LucideIcon, ScanLine, Users } from "lucide-react";

import {
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Section,
  StatTile,
  ToneIcon,
} from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
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

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={HeartPulse} tone="water" label={t`Cardiac`} value={cardiac.data.length} />
        <StatTile icon={ScanLine} tone="water" label={t`Imaging`} value={imaging.data.length} />
        <StatTile icon={Users} tone="water" label={t`Family history`} value={family.data.length} />
      </div>

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

type RecordItem = {
  /** What the record is, then any qualifier (body part, condition). */
  headline: readonly string[];
  date: string;
  /** True when `date` is an ISO day (shown as people say it); false for an age or year. */
  isDate: boolean;
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
        <ul className="grid gap-3 sm:grid-cols-2">
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
                <span className="num shrink-0 rounded-full bg-water-soft px-2.5 py-1 text-sm font-semibold text-ink">
                  {item.isDate ? friendlyDate(i18n, item.date) : item.date}
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
    isDate: true,
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
    isDate: true,
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
    isDate: false,
    secondary: [summaryText(row.notes)],
  };
}
