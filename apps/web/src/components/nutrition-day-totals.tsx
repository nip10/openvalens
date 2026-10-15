import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import {
  ALL_NUTRIENTS,
  DIARY_COPY,
  NUTRIENT_LABELS,
  SUMMARY_NUTRIENTS,
  describeNutrientTotal,
  formatCoverage,
  formatSources,
  formatTotalValue,
} from "@openvalens/api/presenters/nutrition-diary";

/**
 * Day totals with per-nutrient coverage (Issue #79). Values come from the
 * server's `getDay.summary`; a nutrient no logged food provided reads
 * "Unknown", never 0, and every total states how many entries it covers.
 */
export function NutritionDayTotals({
  totals,
  sources,
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
}) {
  const sourceLine = sources ? formatSources(sources) : null;
  return (
    <section aria-label={DIARY_COPY.totalsTitle} className="grid gap-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {SUMMARY_NUTRIENTS.map((key) => (
          <div key={key} aria-label={describeNutrientTotal(key, totals[key])}>
            <dt className="text-xs text-muted-foreground">{NUTRIENT_LABELS[key].label}</dt>
            <dd className="font-mono text-sm">{formatTotalValue(key, totals[key])}</dd>
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
                <td className="py-1 font-mono">{formatTotalValue(key, totals[key])}</td>
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
      <p className="text-xs text-muted-foreground">
        {DIARY_COPY.totalsNote} {DIARY_COPY.unknownNote}
      </p>
    </section>
  );
}
