import type { NutrientKey, NutrientTotal } from "@openvalens/api/contracts/nutrition-diary";
import type { NutritionTargetWire } from "@openvalens/api/contracts/nutrition-targets";
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
  formatTarget,
  targetBand,
  type TargetBand,
} from "@openvalens/api/presenters/nutrition-targets";
import { Beef, Droplet, Leaf, type LucideIcon, Wheat, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Details, InfoTip, StatTile } from "@/components/page";

const NUTRIENT_ICONS: Partial<Record<NutrientKey, LucideIcon>> = {
  energyKcal: Zap,
  proteinG: Beef,
  carbohydrateG: Wheat,
  fatG: Droplet,
  fiberG: Leaf,
};

/** Each macro's identity colour for its band's fill; energy and fibre take the food tone. */
const BAND_FILL: Partial<Record<NutrientKey, string>> = {
  proteinG: "bg-protein",
  carbohydrateG: "bg-carbs",
  fatG: "bg-fat",
};

/**
 * nutrition#10: a thin band under a total. The target range is shaded with a
 * tick at each edge, and the fill runs from 0 to today's total, so the room
 * left before the range ends shows without arithmetic. Position only: the
 * same colours whether the total is below, inside or past the range.
 */
export function TargetBandBar({ band, nutrient }: { band: TargetBand; nutrient: NutrientKey }) {
  const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
  const edges = [band.bandStart, band.bandEnd].filter((edge) => edge > 0 && edge < 1);
  return (
    <div
      role="img"
      aria-label={band.label}
      data-testid={`target-band-${nutrient}`}
      className="relative h-2 w-full rounded-full bg-paper-2"
    >
      <div
        className="absolute inset-y-0 rounded-full bg-rule-2"
        style={{ left: pct(band.bandStart), width: pct(band.bandEnd - band.bandStart) }}
      />
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${BAND_FILL[nutrient] ?? "bg-food"}`}
        style={{ width: pct(band.position) }}
      />
      {edges.map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink-3"
          style={{ left: pct(edge) }}
        />
      ))}
    </div>
  );
}

/**
 * Day totals with per-nutrient coverage (Issue #79), with hide-numbers mode
 * (#80). Values come from the server's `getDay.summary`; a nutrient no logged
 * food provided reads "Unknown", never 0, and every total states how many
 * entries it covers. With hide-numbers on, every numeric value is replaced
 * but the coverage line stays, so logging still works and a total is never
 * read as a verdict. A target that applies on the day is shown on its tile as
 * text and a thin band (nutrition#10), never as a judgement; the band is left
 * out while numbers are hidden. "All nutrients" also holds the day's vitamins
 * and minerals (micronutrients#4), mounted only once it is opened so their
 * summary loads on demand.
 */
export function NutritionDayTotals({
  totals,
  sources,
  hideNumbers = false,
  targets = [],
  micronutrients,
  allNutrientsOpen = false,
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
  hideNumbers?: boolean;
  targets?: readonly NutritionTargetWire[];
  /** The day's micronutrient summary, shown under the table once "All nutrients" is open. */
  micronutrients?: ReactNode;
  /** Open "All nutrients" from the start, e.g. arriving from the old Micronutrients link. */
  allNutrientsOpen?: boolean;
}) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(allNutrientsOpen);
  const sourceLine = sources ? formatSources(sources, i18n) : null;
  return (
    <section aria-label={i18n._(DIARY_COPY.totalsTitle)} className="grid min-w-0 gap-4">
      {/* nutrition#8: energy leads on its own row until all five fit, so no tile sits alone. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 xl:grid-cols-5">
        {SUMMARY_NUTRIENTS.map((key) => {
          const total = totals[key];
          const target = targets.find((item) => item.nutrient === key);
          const targetText = target ? formatTarget(target, hideNumbers, i18n) : null;
          const band = targetBand(key, total, target, hideNumbers, i18n);
          return (
            <div
              key={key}
              role="group"
              className={
                key === "energyKcal"
                  ? "col-span-2 grid min-w-0 sm:col-span-4 xl:col-span-1"
                  : "grid min-w-0"
              }
              aria-label={describeDisplayedTotal(key, total, hideNumbers, i18n)}
            >
              <StatTile
                icon={NUTRIENT_ICONS[key] ?? Zap}
                tone="food"
                label={i18n._(NUTRIENT_LABELS[key].label)}
                value={
                  <span className="text-[1.625rem]">
                    {displayTotalValue(key, total, hideNumbers, i18n)}
                  </span>
                }
                bar={band ? <TargetBandBar band={band} nutrient={key} /> : null}
                note={
                  <>
                    {i18n._(formatCoverage(total))}
                    {targetText ? <span className="block">{t`Target: ${targetText}`}</span> : null}
                  </>
                }
              />
            </div>
          );
        })}
      </div>
      {hideNumbers ? (
        <p className="text-sm text-ink-3">{i18n._(TARGET_COPY.numbersHidden)}</p>
      ) : null}
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <Details
          summary={i18n._(DIARY_COPY.allNutrients)}
          className="flex-1"
          defaultOpen={allNutrientsOpen}
          onOpenChange={setOpen}
        >
          <div className="grid min-w-0 gap-3">
            <div className="sheet min-w-0 overflow-x-auto px-5 py-3">
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
                  {ALL_NUTRIENTS.map((key) => (
                    <tr key={key} className="border-b border-rule last:border-0">
                      <th scope="row" className="py-2 font-normal text-ink">
                        {i18n._(NUTRIENT_LABELS[key].label)} ({i18n._(NUTRIENT_LABELS[key].unit)})
                      </th>
                      <td className="py-2 text-right text-ink tabular-nums">
                        {displayTotalValue(key, totals[key], hideNumbers, i18n)}
                      </td>
                      <td className="py-2 pl-4 text-ink-3">
                        {i18n._(formatCoverage(totals[key]))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {open ? micronutrients : null}
          </div>
        </Details>
        <InfoTip label={t`About these totals`} align="end">
          {sourceLine ? (
            <p>
              {i18n._(DIARY_COPY.sourcesLabel)}: {sourceLine}
            </p>
          ) : null}
          <p>
            {i18n._(DIARY_COPY.totalsNote)} {i18n._(DIARY_COPY.unknownNote)}
          </p>
        </InfoTip>
      </div>
    </section>
  );
}
