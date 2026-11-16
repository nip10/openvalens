import {
  coverageText,
  describeReference,
  formatMicronutrientAmount,
  MICRONUTRIENT_COPY,
  MICRONUTRIENT_LABELS,
} from "@openvalens/api/presenters/micronutrients";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SlidersHorizontal, Sprout } from "lucide-react";

import { controlLinkClass, textLinkClass } from "@/components/food-classes";
import { MicronutrientReference } from "@/components/micronutrient-reference";
import { InfoTip, ToneIcon } from "@/components/page";
import { client } from "@/utils/orpc";
import { useNutritionSettings } from "@/utils/nutrition-settings";

const COPY = Object.freeze({
  title: msg`Vitamins and minerals`,
  turnOnWhy: msg`See vitamins and minerals from the foods you logged against EFSA or NASEM references. A value a food does not report counts as unknown, never as zero.`,
  turnOn: msg`Turn on micronutrient summary`,
});

/**
 * The opt-in micronutrient summary for one diary day (#78), inside the Meal
 * diary's "All nutrients" (micronutrients#4). Unknown values are never zero,
 * every amount says how many foods reported it, and a day is compared with
 * the accepted reference only when every food reported the nutrient. While
 * the summary is off, it offers the button that turns it on.
 */
export function MicronutrientSummary({ localDate }: { localDate: string }) {
  const summary = useQuery({
    queryKey: ["nutritionMicronutrients", "summary", localDate],
    queryFn: () => client.nutritionMicronutrients.summary({ localDate }),
  });
  const data = summary.data;
  const nutritionSettings = useNutritionSettings();
  const { t, i18n } = useLingui();
  const reference = data?.reference ?? null;
  const sourceOrg = reference?.sourceOrg ?? "";
  const populationLabel = reference?.populationLabel ?? "";
  const licenceNote = reference?.licenceNote ?? "";
  const datasetVersion = data?.datasetVersion ?? "";

  const heading = (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h3 className="flex items-center gap-2.5 font-display text-base font-medium text-ink">
        <ToneIcon icon={Sprout} tone="food" size="sm" />
        {i18n._(COPY.title)}
        {data && data.status !== "off" ? (
          <InfoTip label={t`About vitamins and minerals`}>
            {reference ? (
              <p>
                <Trans>
                  Reference: {sourceOrg}, {populationLabel}.{" "}
                  <a
                    className={textLinkClass}
                    href={reference.sourceUrl}
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
          </InfoTip>
        ) : null}
      </h3>
      {data && data.status !== "off" ? (
        <Link
          to="/settings/nutrition"
          hash="micronutrients"
          className={`inline-flex items-center gap-1.5 ${controlLinkClass}`}
        >
          <SlidersHorizontal className="size-4 text-food" aria-hidden="true" />
          <Trans>Nutrition settings</Trans>
        </Link>
      ) : null}
    </div>
  );

  if (summary.isPending)
    return (
      <section className="sheet grid min-w-0 gap-3 px-5 py-4" role="status">
        <span className="sr-only">
          <Trans>Loading…</Trans>
        </span>
        <Skeleton className="h-6 w-48 rounded-full" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </section>
    );
  if (summary.isError || !data)
    return (
      <section className="sheet grid min-w-0 gap-2 px-5 py-4">
        {heading}
        <p className="text-sm text-ink-3">
          <Trans>Could not load the summary.</Trans>
        </p>
      </section>
    );
  if (data.status === "off")
    return (
      <section className="sheet grid min-w-0 justify-items-start gap-3 px-5 py-4">
        {heading}
        <p className="max-w-[60ch] text-sm text-ink-2">{i18n._(COPY.turnOnWhy)}</p>
        <Button
          variant="outline"
          disabled={!nutritionSettings.settings || nutritionSettings.saving}
          onClick={() => void nutritionSettings.save({ micronutrientsEnabled: true })}
        >
          {i18n._(COPY.turnOn)}
        </Button>
      </section>
    );

  return (
    <section className="sheet grid min-w-0 gap-3 px-5 py-4" aria-label={i18n._(COPY.title)}>
      {heading}
      {data.status === "hidden" ? (
        <p className="text-sm text-ink-3">{i18n._(MICRONUTRIENT_COPY.hidden)}</p>
      ) : (
        <>
          {!data.reference && data.referenceNote !== "adults_only" && nutritionSettings.settings ? (
            <MicronutrientReference
              settings={nutritionSettings.settings}
              save={nutritionSettings.save}
              className="grid gap-2 rounded-2xl bg-paper-2 p-4 text-sm"
            />
          ) : null}
          {data.totalEntries === 0 ? (
            <p className="text-sm text-ink-3">
              <Trans>Nothing logged on this day.</Trans>
            </p>
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full text-left text-sm text-ink-2">
                <thead>
                  <tr className="border-b border-rule">
                    <th scope="col" className="pb-2 font-medium text-ink-3">
                      <Trans>Nutrient</Trans>
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium text-ink-3">
                      <Trans>Total</Trans>
                    </th>
                    <th scope="col" className="pb-2 pl-4 font-medium text-ink-3">
                      <Trans>Coverage</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    const label = i18n._(MICRONUTRIENT_LABELS[row.nutrient]);
                    const notCompared =
                      row.percentOfReference === null &&
                      row.references.length > 0 &&
                      row.knownEntries < row.totalEntries;
                    const percent = row.percentOfReference;
                    return (
                      <tr key={row.nutrient} className="border-b border-rule last:border-0">
                        <th scope="row" className="py-2 font-normal text-ink">
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {row.references.length > 0 || row.atLeast ? (
                              <InfoTip label={t`About ${label}`} align="end">
                                {row.atLeast ? (
                                  <p>{i18n._(MICRONUTRIENT_COPY.incomplete)}</p>
                                ) : null}
                                {notCompared ? (
                                  <p>{i18n._(MICRONUTRIENT_COPY.notCompared)}</p>
                                ) : null}
                                {row.references.map((item) => (
                                  <p key={item.type} className="text-ink-3">
                                    {describeReference(row.nutrient, item, i18n)}
                                  </p>
                                ))}
                              </InfoTip>
                            ) : null}
                          </span>
                        </th>
                        <td className="py-2 text-right whitespace-nowrap text-ink tabular-nums">
                          {row.amount === null
                            ? data.hideNumbers
                              ? t`Hidden`
                              : t`Unknown`
                            : `${row.atLeast ? "≥ " : ""}${formatMicronutrientAmount(row.nutrient, row.amount)}`}
                        </td>
                        <td className="py-2 pl-4 text-ink-3">
                          {i18n._(coverageText(row))}
                          {/* The comparison sits under the coverage, so phones need no fourth column. */}
                          {percent !== null ? (
                            <span className="block tabular-nums">{t`${percent}% of reference`}</span>
                          ) : notCompared ? (
                            <span className="block">{t`Not compared`}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
