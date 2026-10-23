import { Trans, useLingui } from "@lingui/react/macro";
import { LAB_UNIT_CHOICES, type LabUnitChoice } from "@openvalens/api/presenters/clinical-units";
import { PRODUCT_LOCALES, type ProductLocale } from "@openvalens/api/product-settings-contract";
import { LOCALE_NAMES, LOCALES, reviewStatusOf } from "@openvalens/i18n";
import { Card } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useAppLocale } from "@/lib/i18n/provider";

/**
 * Interface language (#67). Applies immediately, without a restart. A
 * community translation is marked as such; its safety-critical strings stay
 * in English until a reviewer approves them.
 */
export function LanguageSection() {
  const { locale, setLocale } = useAppLocale();
  const { t } = useLingui();
  const { formatLocale, setFormatLocale, labUnits, setLabUnits } = useDisplayPreferences();
  const formats: { value: ProductLocale | null; label: string }[] = [
    { value: null, label: t`App default` },
    ...PRODUCT_LOCALES.map((value) => ({
      value,
      label: {
        "en-US": t`United States`,
        "en-GB": t`United Kingdom`,
        "en-CA": t`Canada`,
        "pt-PT": t`Portugal`,
      }[value],
    })),
  ];
  const unitNames: Record<LabUnitChoice, string> = {
    as_reported: t({ message: "As reported by the lab", comment: "safety" }),
    mg_dl: "mg/dL",
    mmol_l: t({ message: "mmol/L (µmol/L for creatinine)", comment: "safety" }),
  };
  const chip = (selected: boolean) =>
    `min-h-11 justify-center rounded-lg border px-3 ${selected ? "bg-accent" : "border-border"}`;
  return (
    <CardStack title={t`Language`}>
      <Card variant="secondary" className="gap-3 p-4">
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t`Interface language`}
          className="gap-2"
        >
          {LOCALES.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: locale === option }}
              accessibilityLanguage={option}
              onPress={() => setLocale(option)}
              className={`min-h-11 justify-center rounded-lg border px-3 ${locale === option ? "bg-accent" : "border-border"}`}
            >
              <Text className="text-base text-foreground">{LOCALE_NAMES[option]}</Text>
            </Pressable>
          ))}
        </View>
        {reviewStatusOf(locale) === "community" ? (
          <Text className="text-sm text-muted-foreground">
            <Trans>
              Community translation, not yet reviewed. Units, reference ranges, medication and
              consent text stay in English until a reviewer approves them.
            </Trans>
          </Text>
        ) : null}
        <Text className="text-sm font-medium text-foreground">
          <Trans>Date and number format</Trans>
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t`Date and number format`}
          className="flex-row flex-wrap gap-2"
        >
          {formats.map((option) => (
            <Pressable
              key={option.value ?? "default"}
              accessibilityRole="radio"
              accessibilityState={{ checked: formatLocale === option.value }}
              onPress={() => setFormatLocale(option.value)}
              className={chip(formatLocale === option.value)}
            >
              <Text className="text-sm text-foreground">{option.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-sm font-medium text-foreground">
          <Trans>Lab concentration units</Trans>
        </Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t`Lab concentration units`}
          className="flex-row flex-wrap gap-2"
        >
          {LAB_UNIT_CHOICES.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: labUnits === value }}
              onPress={() => setLabUnits(value)}
              className={chip(labUnits === value)}
            >
              <Text className="text-sm text-foreground">{unitNames[value]}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-xs text-muted-foreground">
          <Trans comment="safety">
            Changes only how glucose, cholesterol, triglycerides and creatinine are shown. Your
            stored results and the lab&apos;s units are never changed.
          </Trans>
        </Text>
      </Card>
    </CardStack>
  );
}
