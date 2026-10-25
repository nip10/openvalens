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
} from "@openvalens/api/presenters/nutrition-targets";
import { Beef, Droplet, Leaf, type LucideIcon, Wheat, Zap } from "lucide-react";

import { Details, InfoTip, StatTile } from "@/components/page";

const NUTRIENT_ICONS: Partial<Record<NutrientKey, LucideIcon>> = {
  energyKcal: Zap,
  proteinG: Beef,
  carbohydrateG: Wheat,
  fatG: Droplet,
  fiberG: Leaf,
};

/**
 * Day totals with per-nutrient coverage (Issue #79), with hide-numbers mode
 * (#80). Values come from the server's `getDay.summary`; a nutrient no logged
 * food provided reads "Unknown", never 0, and every total states how many
 * entries it covers. With hide-numbers on, every numeric value is replaced
 * but the coverage line stays, so logging still works and a total is never
 * read as a verdict. A target that applies on the day is shown on its tile as
 * a soft bar, never as a judgement; the bar is left out while numbers are hidden.
 */
export function NutritionDayTotals({
  totals,
  sources,
  hideNumbers = false,
  targets = [],
}: {
  totals: Record<NutrientKey, NutrientTotal>;
  sources: { fdc: number; off: number; custom: number; manual: number } | null;
  hideNumbers?: boolean;
  targets?: readonly NutritionTargetWire[];
}) {
  const { t, i18n } = useLingui();
  const sourceLine = sources ? formatSources(sources, i18n) : null;
  return (
    <section aria-label={i18n._(DIARY_COPY.totalsTitle)} className="grid min-w-0 gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {SUMMARY_NUTRIENTS.map((key) => {
          const total = totals[key];
          const target = targets.find((item) => item.nutrient === key);
          const targetText = target ? formatTarget(target, hideNumbers, i18n) : null;
          return (
            <div
              key={key}
              role="group"
              className="grid min-w-0"
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
        <Details summary={i18n._(DIARY_COPY.allNutrients)} className="flex-1">
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
                    <td className="py-2 pl-4 text-ink-3">{i18n._(formatCoverage(totals[key]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
