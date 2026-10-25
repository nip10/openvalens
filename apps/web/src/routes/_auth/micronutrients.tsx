import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_LABELS,
} from "@openvalens/api/presenters/micronutrients";
import type { MicronutrientSummaryWire } from "@openvalens/api/contracts/nutrition-micronutrients";
import { Trans, useLingui } from "@lingui/react/macro";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { controlLinkClass, textLinkClass } from "@/components/food-classes";
import { EmptyState, ErrorState, Page, PageHeader, Section } from "@/components/page";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/micronutrients")({ component: MicronutrientsPage });

/**
 * Opt-in micronutrient summary (#78). Unknown values are never zero, every
 * amount shows how many foods reported it, and a day is compared with the
 * accepted reference only when every food reported the nutrient.
 */

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function MicronutrientsPage() {
  const [localDate, setLocalDate] = useState(localToday());
  const summary = useQuery({
    queryKey: ["nutritionMicronutrients", "summary", localDate],
    queryFn: () => client.nutritionMicronutrients.summary({ localDate }),
  });
  const data = summary.data;
  const { t, i18n } = useLingui();
  const reference = data?.reference ?? null;
  const sourceOrg = reference?.sourceOrg ?? "";
  const populationLabel = reference?.populationLabel ?? "";
  const licenceNote = reference?.licenceNote ?? "";
  const datasetVersion = data?.datasetVersion ?? "";
  const rowTitle = (
    row: Pick<MicronutrientSummaryWire["rows"][number], "nutrient" | "amount" | "atLeast">,
    hideNumbers: boolean,
  ) => {
    const label = i18n._(MICRONUTRIENT_LABELS[row.nutrient]);
    if (row.amount === null) return hideNumbers ? label : t`${label}: unknown`;
    const amount = formatMicronutrientAmount(row.nutrient, row.amount);
    return row.atLeast ? t`${label}: at least ${amount}` : t`${label}: ${amount}`;
  };

  return (
    <Page>
      <PageHeader
        title={<Trans>Micronutrients</Trans>}
        description={i18n._(MICRONUTRIENT_COPY.intro)}
        actions={
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="micronutrient-date" className="text-sm font-medium text-ink-3">
                <Trans>Day</Trans>
              </Label>
              <Input
                id="micronutrient-date"
                type="date"
                className="num"
                value={localDate}
                onChange={(event) => event.target.value && setLocalDate(event.target.value)}
              />
            </div>
            <Link to="/nutrition-targets" className={`pb-2 ${controlLinkClass}`}>
              <Trans>Nutrition settings</Trans>
            </Link>
          </div>
        }
      />

      {summary.isPending ? (
        <div className="grid gap-2" role="status">
          <span className="sr-only">
            <Trans>Loading…</Trans>
          </span>
          {SKELETON_ROWS.map((key) => (
            <Skeleton key={key} className="h-10 w-full" />
          ))}
        </div>
      ) : summary.isError || !data ? (
        <ErrorState title={<Trans>Could not load the summary.</Trans>} />
      ) : data.status === "off" ? (
        <EmptyState title={i18n._(MICRONUTRIENT_COPY.off)} />
      ) : data.status === "hidden" ? (
        <EmptyState title={i18n._(MICRONUTRIENT_COPY.hidden)} />
      ) : (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
          <Section title={<span className="num">{localDate}</span>}>
            {data.totalEntries === 0 ? (
              <EmptyState
                title={<Trans>Nothing logged on this day.</Trans>}
                action={
                  <Link to="/nutrition" className={controlLinkClass}>
                    <Trans>Back to meal diary</Trans>
                  </Link>
                }
              />
            ) : (
              <div className="sheet px-5 pt-3 pb-4">
                <table className="w-full text-left text-sm text-ink-2">
                  <thead>
                    <tr className="border-b-2 border-rule-2">
                      <th scope="col" className="pb-2 font-medium text-ink-3">
                        <Trans>Nutrient</Trans>
                      </th>
                      <th scope="col" className="w-28 pb-2 text-right font-medium text-ink-3">
                        <Trans>Amount</Trans>
                      </th>
                      <th scope="col" className="w-28 pb-2 text-right font-medium text-ink-3">
                        <Trans>% of reference</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr
                        key={row.nutrient}
                        className="border-b border-rule align-top last:border-0"
                      >
                        <th scope="row" className="py-2.5 pr-4 font-normal">
                          <span className="block font-display font-medium text-ink">
                            {i18n._(MICRONUTRIENT_LABELS[row.nutrient])}
                          </span>
                          <span className="sr-only">{rowTitle(row, data.hideNumbers)}</span>
                          <span className="block text-ink-3">{i18n._(coverageText(row))}</span>
                          {row.atLeast ? (
                            <span className="block text-ink-3">
                              {i18n._(MICRONUTRIENT_COPY.incomplete)}
                            </span>
                          ) : null}
                          {row.percentOfReference === null &&
                          row.references.length &&
                          row.knownEntries < row.totalEntries ? (
                            <span className="block text-warning">
                              {i18n._(MICRONUTRIENT_COPY.notCompared)}
                            </span>
                          ) : null}
                          {row.references.map((reference) => (
                            <span key={reference.type} className="block text-ink-3">
                              {describeReference(row.nutrient, reference, i18n)}
                            </span>
                          ))}
                        </th>
                        <td className="num py-2.5 font-medium text-ink" aria-hidden="true">
                          {row.amount === null
                            ? data.hideNumbers
                              ? t`Hidden`
                              : t`Unknown`
                            : `${row.atLeast ? "\u2265 " : ""}${formatMicronutrientAmount(row.nutrient, row.amount)}`}
                        </td>
                        <td className="num py-2.5 text-ink">
                          {row.percentOfReference !== null ? `${row.percentOfReference}%` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <aside className="well grid gap-2 px-4 py-4 text-sm text-ink-2">
            {data.reference ? (
              <p>
                <Trans>
                  Reference: {sourceOrg}, {populationLabel}.{" "}
                  <a
                    className={textLinkClass}
                    href={data.reference.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Source
                  </a>
                  . {licenceNote}
                </Trans>
              </p>
            ) : (
              <p>
                {i18n._(
                  data.referenceNote === "adults_only"
                    ? MICRONUTRIENT_COPY.adultsOnly
                    : MICRONUTRIENT_COPY.noReference,
                )}
              </p>
            )}
            <p className="text-ink-3">{i18n._(MICRONUTRIENT_COPY.intakeExplainer)}</p>
            <p className="text-ink-3">
              <Trans>Dataset {datasetVersion}.</Trans> {i18n._(MICRONUTRIENT_COPY.notAdvice)}
            </p>
          </aside>
        </div>
      )}
    </Page>
  );
}

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"] as const;
