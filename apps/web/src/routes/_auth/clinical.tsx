import type { I18n } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  cardiacExamTypeLabel,
  familyRelationLabel,
  formatYear,
  imagingTypeLabel,
  summaryText,
} from "@openvalens/api/presenters/clinical-records";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

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
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">
          <Trans>Clinical</Trans>
        </h1>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (cardiac.isError || imaging.isError || family.isError) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">
          <Trans>Clinical</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>Could not load clinical records.</Trans>{" "}
          <button
            className="underline"
            onClick={() => {
              void cardiac.refetch();
              void imaging.refetch();
              void family.refetch();
            }}
          >
            <Trans>Retry</Trans>
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">
        <Trans>Clinical</Trans>
      </h1>

      <Section
        title={t`Cardiac`}
        rows={cardiac.data}
        renderItem={(row) => renderCardiac(row, i18n)}
        emptyText={t`No cardiac exams recorded.`}
      />
      <Section
        title={t`Imaging`}
        rows={imaging.data}
        renderItem={(row) => renderImaging(row, i18n)}
        emptyText={t`No imaging studies recorded.`}
      />
      <Section
        title={t`Family history`}
        rows={family.data}
        renderItem={(row) => renderFamily(row, i18n)}
        emptyText={t`No family history entries.`}
      />
    </div>
  );
}

type CardProps<T> = {
  title: string;
  rows: readonly T[];
  renderItem: (row: T) => { headline: string; date: string; secondary: string };
  emptyText: string;
};

function Section<T>({ title, rows, renderItem, emptyText }: CardProps<T>) {
  return (
    <Card className="py-0">
      <CardHeader className="border-b border-border">
        <CardTitle>
          {title} · {rows.length}
        </CardTitle>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </CardContent>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row, index) => {
            const item = renderItem(row);
            return (
              <li key={index} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{item.headline}</div>
                  <div className="text-sm text-muted-foreground">{item.secondary}</div>
                </div>
                <div className="shrink-0 font-mono text-sm text-muted-foreground">{item.date}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

type CardiacRow = {
  date: string;
  type: string;
  facility: string | null;
  conclusion: string | null;
};
function renderCardiac(
  row: CardiacRow,
  i18n: I18n,
): { headline: string; date: string; secondary: string } {
  return {
    headline: cardiacExamTypeLabel(row.type, i18n),
    date: row.date,
    secondary: `${row.facility ?? "—"} · ${summaryText(row.conclusion)}`,
  };
}

type ImagingRow = {
  date: string;
  type: string;
  bodyPart: string;
  facility: string | null;
  conclusion: string | null;
};
function renderImaging(
  row: ImagingRow,
  i18n: I18n,
): { headline: string; date: string; secondary: string } {
  return {
    headline: `${imagingTypeLabel(row.type, i18n)} · ${row.bodyPart}`,
    date: row.date,
    secondary: `${row.facility ?? "—"} · ${summaryText(row.conclusion)}`,
  };
}

type FamilyRow = {
  relation: string;
  condition: string;
  ageOfOnset: number | null;
  notes: string | null;
};
function renderFamily(
  row: FamilyRow,
  i18n: I18n,
): { headline: string; date: string; secondary: string } {
  return {
    headline: `${familyRelationLabel(row.relation, i18n)} · ${row.condition}`,
    date: formatYear(row.ageOfOnset),
    secondary: summaryText(row.notes),
  };
}
