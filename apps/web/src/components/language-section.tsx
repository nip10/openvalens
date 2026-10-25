import { Trans, useLingui } from "@lingui/react/macro";
import { LAB_UNIT_CHOICES, type LabUnitChoice } from "@openvalens/api/presenters/clinical-units";
import {
  formatProductDate,
  formatProductNumber,
} from "@openvalens/api/presenters/product-formatting";
import { PRODUCT_LOCALES, type ProductLocale } from "@openvalens/api/product-settings-contract";
import { LOCALE_NAMES, LOCALES, isLocale, reviewStatusOf } from "@openvalens/i18n";
import { Badge } from "@openvalens/ui/components/badge";
import { useId } from "react";

import { Section } from "@/components/page";

import { useDisplayPreferences } from "@/lib/display-preferences";
import { useAppLocale } from "@/lib/i18n";

const SELECT =
  "h-9 w-fit max-w-full rounded-sm border border-input bg-card px-2 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring";

/**
 * Interface language (#67). Applies immediately, without a reload. A
 * community translation is marked as such; its safety-critical strings
 * (units, reference ranges, medication and consent text) stay in English
 * until a reviewer approves them.
 */
export function LanguageSection() {
  const { locale, setLocale } = useAppLocale();
  const id = useId();
  const formatId = useId();
  const unitsId = useId();
  const { t } = useLingui();
  const { formatLocale, setFormatLocale, labUnits, setLabUnits } = useDisplayPreferences();
  const regionNames: Record<ProductLocale, string> = {
    "en-US": t`United States`,
    "en-GB": t`United Kingdom`,
    "en-CA": t`Canada`,
    "pt-PT": t`Portugal`,
  };
  const unitNames: Record<LabUnitChoice, string> = {
    as_reported: t({ message: "As reported by the lab", comment: "safety" }),
    mg_dl: "mg/dL",
    mmol_l: t({ message: "mmol/L (µmol/L for creatinine)", comment: "safety" }),
  };
  const sample = (value: ProductLocale) =>
    `${formatProductDate(new Date(Date.UTC(2026, 0, 15)), value, undefined, "UTC")}; ${formatProductNumber(1234.5, value)}`;
  return (
    <Section title={<Trans>Language</Trans>} sheet>
      <div className="grid gap-5 text-sm">
        <label htmlFor={id} className="grid gap-1.5 text-ink-3">
          <Trans>Interface language</Trans>
          <select
            id={id}
            className={SELECT}
            value={locale}
            onChange={(event) => {
              if (isLocale(event.target.value)) setLocale(event.target.value);
            }}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option} lang={option}>
                {LOCALE_NAMES[option]}
              </option>
            ))}
          </select>
        </label>
        {reviewStatusOf(locale) === "community" ? (
          <p className="flex flex-wrap items-baseline gap-2">
            <Badge variant="outline">
              <Trans>Community translation</Trans>
            </Badge>
            <span className="text-ink-3">
              <Trans>
                Not yet reviewed. Units, reference ranges, medication and consent text stay in
                English until a reviewer approves them.
              </Trans>
            </span>
          </p>
        ) : null}
        <label htmlFor={formatId} className="grid gap-1.5 border-t border-rule pt-4 text-ink-3">
          <Trans>Date and number format</Trans>
          <select
            id={formatId}
            className={SELECT}
            value={formatLocale ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setFormatLocale(
                (PRODUCT_LOCALES as readonly string[]).includes(value)
                  ? (value as ProductLocale)
                  : null,
              );
            }}
          >
            <option value="">{t`App default`}</option>
            {PRODUCT_LOCALES.map((value) => (
              <option key={value} value={value}>
                {`${regionNames[value]} (${sample(value)})`}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={unitsId} className="grid gap-1.5 border-t border-rule pt-4 text-ink-3">
          <Trans>Lab concentration units</Trans>
          <select
            id={unitsId}
            className={SELECT}
            value={labUnits}
            onChange={(event) => {
              const value = event.target.value;
              if ((LAB_UNIT_CHOICES as readonly string[]).includes(value))
                setLabUnits(value as LabUnitChoice);
            }}
          >
            {LAB_UNIT_CHOICES.map((value) => (
              <option key={value} value={value}>
                {unitNames[value]}
              </option>
            ))}
          </select>
          <span className="max-w-[65ch]">
            <Trans comment="safety">
              Changes only how glucose, cholesterol, triglycerides and creatinine are shown. Your
              stored results and the lab&apos;s units are never changed.
            </Trans>
          </span>
        </label>
      </div>
    </Section>
  );
}
