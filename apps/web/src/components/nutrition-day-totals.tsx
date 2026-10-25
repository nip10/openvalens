import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import {
  ALL_NUTRIENTS,
  DIARY_COPY,
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  formatCoverage,
  formatSources,
} from "@openvalens/api/presenters/nutrition-diary";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  TARGET_COPY,
  describeDisplayedTotal,
  displayTotalValue,
} from "@openvalens/api/presenters/nutrition-targets";

/**
 * Day totals with per-nutrient coverage (Issue #79), with hide-numbers mode
 * (#80). Values come from the server's `getDay.summary`; a nutrient no logged
 * food provided reads "Unknown", never 0, and every total states how many
 * entries it covers. With hide-numbers on, every numeric value is replaced
 * but the coverage line stays, so logging still works and a total is never
 * read as a verdict.
 */
export function NutritionDayTotals({
  totals,
  sources,
  hideNumbers = false,
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
  hideNumbers?: boolean;
}) {
  const { i18n } = useLingui();
  const sourceLine = sources ? formatSources(sources, i18n) : null;
  return (
    <section aria-label={i18n._(DIARY_COPY.totalsTitle)} className="grid gap-4">
      <dl className="grid grid-cols-2 gap-y-4 sm:grid-cols-5 sm:divide-x sm:divide-rule">
        {SUMMARY_NUTRIENTS.map((key) => (
          <div
            key={key}
            className="grid min-w-0 content-start gap-1 pr-4 sm:px-4 sm:first:pl-0"
            aria-label={describeDisplayedTotal(key, totals[key], hideNumbers, i18n)}
          >
            <dt className="text-sm font-medium text-ink-3">{i18n._(NUTRIENT_LABELS[key].label)}</dt>
            <dd className="num m-0 text-xl font-medium tracking-[-0.02em] text-ink">
              {displayTotalValue(key, totals[key], hideNumbers, i18n)}
            </dd>
            <dd className="m-0 text-sm text-ink-3">{i18n._(formatCoverage(totals[key]))}</dd>
          </div>
        ))}
      </dl>
      <details className="group border-t border-rule pt-3 text-sm">
        <summary className="cursor-pointer font-display font-medium text-ink-2 transition-colors duration-[var(--dur-short)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {i18n._(DIARY_COPY.allNutrients)}
        </summary>
        <table className="mt-3 w-full text-left text-sm text-ink-2">
          <thead>
            <tr className="border-b-2 border-rule-2">
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
            {ALL_NUTRIENTS.map((key) => (
              <tr key={key} className="border-b border-rule last:border-0">
                <th scope="row" className="py-1.5 font-normal text-ink">
                  {i18n._(NUTRIENT_LABELS[key].label)} ({i18n._(NUTRIENT_LABELS[key].unit)})
                </th>
                <td className="num py-1.5 text-ink">
                  {displayTotalValue(key, totals[key], hideNumbers, i18n)}
                </td>
                <td className="py-1.5 pl-4 text-ink-3">{i18n._(formatCoverage(totals[key]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <div className="grid gap-1 text-sm text-ink-3">
        {sourceLine ? (
          <p>
            {i18n._(DIARY_COPY.sourcesLabel)}: {sourceLine}
          </p>
        ) : null}
        {hideNumbers ? <p>{i18n._(TARGET_COPY.numbersHidden)}</p> : null}
        <p className="max-w-[70ch]">
          {i18n._(DIARY_COPY.totalsNote)} {i18n._(DIARY_COPY.unknownNote)}
        </p>
      </div>
    </section>
  );
}
