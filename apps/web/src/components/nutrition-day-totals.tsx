import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import {
  ALL_NUTRIENTS,
  DIARY_COPY,
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  formatCoverage,
  formatSources,
} from "@openvalens/api/presenters/nutrition-diary";
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
  const sourceLine = sources ? formatSources(sources) : null;
  return (
    <section aria-label={DIARY_COPY.totalsTitle} className="grid gap-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {SUMMARY_NUTRIENTS.map((key) => (
          <div key={key} aria-label={describeDisplayedTotal(key, totals[key], hideNumbers)}>
            <dt className="text-xs text-muted-foreground">{NUTRIENT_LABELS[key].label}</dt>
            <dd className="font-mono text-sm">
              {displayTotalValue(key, totals[key], hideNumbers)}
            </dd>
            <dd className="text-xs text-muted-foreground">{formatCoverage(totals[key])}</dd>
          </div>
        ))}
      </dl>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {DIARY_COPY.allNutrients}
        </summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-normal">
                Nutrient
              </th>
              <th scope="col" className="py-1 font-normal">
                Total
              </th>
              <th scope="col" className="py-1 font-normal">
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {ALL_NUTRIENTS.map((key) => (
              <tr key={key} className="border-t border-border">
                <th scope="row" className="py-1 font-normal">
                  {NUTRIENT_LABELS[key].label} ({NUTRIENT_LABELS[key].unit})
                </th>
                <td className="py-1 font-mono">
                  {displayTotalValue(key, totals[key], hideNumbers)}
                </td>
                <td className="py-1 text-muted-foreground">{formatCoverage(totals[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {sourceLine ? (
        <p className="text-xs text-muted-foreground">
          {DIARY_COPY.sourcesLabel}: {sourceLine}
        </p>
      ) : null}
      {hideNumbers ? (
        <p className="text-xs text-muted-foreground">{TARGET_COPY.numbersHidden}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {DIARY_COPY.totalsNote} {DIARY_COPY.unknownNote}
      </p>
    </section>
  );
}
