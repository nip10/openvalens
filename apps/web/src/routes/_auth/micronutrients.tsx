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
import { SlidersHorizontal, Sprout } from "lucide-react";
import { useState } from "react";

import { controlLinkClass, textLinkClass } from "@/components/food-classes";
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
import { friendlyDate } from "@/utils/friendly";
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
        info={i18n._(MICRONUTRIENT_COPY.intro)}
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
            <Link
              to="/nutrition-targets"
              className={`inline-flex items-center gap-1.5 pb-2 ${controlLinkClass}`}
            >
              <SlidersHorizontal className="size-4 text-food" aria-hidden="true" />
              <Trans>Nutrition settings</Trans>
            </Link>
          </div>
        }
      />

      {summary.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status">
          <span className="sr-only">
            <Trans>Loading…</Trans>
          </span>
          {SKELETON_ROWS.map((key) => (
            <Skeleton key={key} className="h-32 w-full rounded-3xl" />
          ))}
        </div>
      ) : summary.isError || !data ? (
        <ErrorState title={<Trans>Could not load the summary.</Trans>} />
      ) : data.status === "off" ? (
        <EmptyState icon={Sprout} title={i18n._(MICRONUTRIENT_COPY.off)} />
      ) : data.status === "hidden" ? (
        <EmptyState icon={Sprout} title={i18n._(MICRONUTRIENT_COPY.hidden)} />
      ) : (
        <Section
          icon={Sprout}
          tone="food"
          title={friendlyDate(i18n, localDate)}
          info={
            <>
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
            </>
          }
        >
          {data.totalEntries === 0 ? (
            <EmptyState
              icon={Sprout}
              title={<Trans>Nothing logged on this day.</Trans>}
              action={
                <Link to="/nutrition" className={controlLinkClass}>
                  <Trans>Back to meal diary</Trans>
                </Link>
              }
            />
          ) : (
            <ul className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.rows.map((row) => {
                const compared = row.percentOfReference !== null;
                const notCompared =
                  row.percentOfReference === null &&
                  row.references.length > 0 &&
                  row.knownEntries < row.totalEntries;
                return (
                  <li key={row.nutrient} className="sheet grid min-w-0 content-start gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <ToneIcon icon={Sprout} tone="food" />
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="font-semibold text-ink">
                            {i18n._(MICRONUTRIENT_LABELS[row.nutrient])}
                          </span>
                          {row.references.length > 0 || row.atLeast ? (
                            <InfoTip align="end">
                              {row.atLeast ? <p>{i18n._(MICRONUTRIENT_COPY.incomplete)}</p> : null}
                              {notCompared ? <p>{i18n._(MICRONUTRIENT_COPY.notCompared)}</p> : null}
                              {row.references.map((reference) => (
                                <p key={reference.type} className="text-ink-3">
                                  {describeReference(row.nutrient, reference, i18n)}
                                </p>
                              ))}
                            </InfoTip>
                          ) : null}
                        </div>
                        <span className="sr-only">{rowTitle(row, data.hideNumbers)}</span>
                        <span className="text-sm text-ink-3">{i18n._(coverageText(row))}</span>
                      </div>
                      <span
                        className="num shrink-0 rounded-full bg-food-soft px-2.5 py-1 text-sm font-semibold text-ink"
                        aria-hidden="true"
                      >
                        {row.amount === null
                          ? data.hideNumbers
                            ? t`Hidden`
                            : t`Unknown`
                          : `${row.atLeast ? "\u2265 " : ""}${formatMicronutrientAmount(row.nutrient, row.amount)}`}
                      </span>
                    </div>
                    {compared ? (
                      <div className="grid gap-1.5">
                        <Meter value={(row.percentOfReference ?? 0) / 100} tone="food" />
                        <span className="text-sm text-ink-3">
                          <span className="num font-semibold text-ink">
                            {row.percentOfReference}
                          </span>
                          <Trans>% of reference</Trans>
                        </span>
                      </div>
                    ) : null}
                    {notCompared ? (
                      <div>
                        <StatusPill tone="neutral">
                          <Trans>Not compared</Trans>
                        </StatusPill>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}
    </Page>
  );
}

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"] as const;
