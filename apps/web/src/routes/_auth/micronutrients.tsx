import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_LABELS,
} from "@openvalens/api/presenters/micronutrients";
import type { MicronutrientSummaryWire } from "@openvalens/api/contracts/nutrition-micronutrients";
import { Trans, useLingui } from "@lingui/react/macro";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

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
    <main className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">
          <Trans>Micronutrients</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">{i18n._(MICRONUTRIENT_COPY.intro)}</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="micronutrient-date">
              <Trans>Day</Trans>
            </Label>
            <Input
              id="micronutrient-date"
              type="date"
              value={localDate}
              onChange={(event) => event.target.value && setLocalDate(event.target.value)}
            />
          </div>
          <Link to="/nutrition-targets" className="text-sm underline">
            <Trans>Nutrition settings</Trans>
          </Link>
        </div>
      </header>

      {summary.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          <Trans>Loading…</Trans>
        </p>
      ) : summary.isError || !data ? (
        <p role="alert" className="text-sm">
          <Trans>Could not load the summary.</Trans>
        </p>
      ) : data.status === "off" ? (
        <p className="text-sm">{i18n._(MICRONUTRIENT_COPY.off)}</p>
      ) : data.status === "hidden" ? (
        <p className="text-sm">{i18n._(MICRONUTRIENT_COPY.hidden)}</p>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-1 pt-6 text-sm">
              {data.reference ? (
                <p>
                  <Trans>
                    Reference: {sourceOrg}, {populationLabel}.{" "}
                    <a
                      className="underline"
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
              <p className="text-muted-foreground">{i18n._(MICRONUTRIENT_COPY.intakeExplainer)}</p>
              <p className="text-xs text-muted-foreground">
                <Trans>Dataset {datasetVersion}.</Trans> {i18n._(MICRONUTRIENT_COPY.notAdvice)}
              </p>
            </CardContent>
          </Card>

          {data.totalEntries === 0 ? (
            <p className="text-sm">
              <Trans>Nothing logged on this day.</Trans>
            </p>
          ) : (
            <ul className="grid gap-3">
              {data.rows.map((row) => (
                <li key={row.nutrient}>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{rowTitle(row, data.hideNumbers)}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-1 text-sm">
                      <p>{i18n._(coverageText(row))}</p>
                      {row.atLeast ? (
                        <p className="text-muted-foreground">
                          {i18n._(MICRONUTRIENT_COPY.incomplete)}
                        </p>
                      ) : null}
                      {row.percentOfReference !== null ? (
                        <p>{t`${row.percentOfReference}% of the intake reference below.`}</p>
                      ) : row.references.length && row.knownEntries < row.totalEntries ? (
                        <p className="text-muted-foreground">
                          {i18n._(MICRONUTRIENT_COPY.notCompared)}
                        </p>
                      ) : null}
                      {row.references.map((reference) => (
                        <p key={reference.type} className="text-muted-foreground">
                          {describeReference(row.nutrient, reference, i18n)}
                        </p>
                      ))}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
