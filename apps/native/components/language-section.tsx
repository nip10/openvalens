import { Trans, useLingui } from "@lingui/react/macro";
import { LAB_UNIT_CHOICES, type LabUnitChoice } from "@openvalens/api/presenters/clinical-units";
import { PRODUCT_LOCALES, type ProductLocale } from "@openvalens/api/product-settings-contract";
import { LOCALE_NAMES, LOCALES, reviewStatusOf } from "@openvalens/i18n";
import { cn } from "heroui-native";
import { CalendarClock, FlaskConical, Globe, Languages } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon, InfoTip, type LucideIcon, Section, Sheet, StatusPill } from "@/components/bloom";
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
  return (
    <Section title={t`Language`} icon={Globe} tone="signal">
      <SettingsGroup>
        <SettingsRow
          icon={Languages}
          label={t`Interface language`}
          description={
            reviewStatusOf(locale) === "community" ? (
              <View className="flex-row flex-wrap items-center gap-1">
                <StatusPill tone="neutral">{t`Community translation`}</StatusPill>
                <InfoTip>
                  <Trans>
                    Community translation, not yet reviewed. Units, reference ranges, medication and
                    consent text stay in English until a reviewer approves them.
                  </Trans>
                </InfoTip>
              </View>
            ) : undefined
          }
        >
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t`Interface language`}
            className="flex-row flex-wrap gap-2"
          >
            {LOCALES.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: locale === option }}
                accessibilityLanguage={option}
                onPress={() => setLocale(option)}
                className={choiceChip(locale === option)}
              >
                <Text className={choiceText(locale === option)}>{LOCALE_NAMES[option]}</Text>
              </Pressable>
            ))}
          </View>
        </SettingsRow>
        <SettingsRow icon={CalendarClock} label={t`Date and number format`} divider>
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
                className={choiceChip(formatLocale === option.value)}
              >
                <Text className={choiceText(formatLocale === option.value)}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </SettingsRow>
        <SettingsRow
          icon={FlaskConical}
          label={t`Lab concentration units`}
          divider
          info={
            <Trans comment="safety">
              Changes only how glucose, cholesterol, triglycerides and creatinine are shown. Your
              stored results and the lab&apos;s units are never changed.
            </Trans>
          }
        >
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
                className={choiceChip(labUnits === value)}
              >
                <Text className={choiceText(labUnits === value)}>{unitNames[value]}</Text>
              </Pressable>
            ))}
          </View>
        </SettingsRow>
      </SettingsGroup>
    </Section>
  );
}

/**
 * Settings read like a phone's (the native twin of web `settings-rows.tsx`):
 * a quiet card of rows, each a neutral icon, a label with an optional short
 * line and an ⓘ, then its value on the right or its control underneath.
 */
export function SettingsGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <Sheet className={cn("px-5 py-1", className)}>{children}</Sheet>;
}

/** A soft neutral circle for a settings row's icon (measure tints stay with their measure). */
export function SettingsIcon({ icon }: { icon: LucideIcon }) {
  return (
    <View
      className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-2"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon icon={icon} size={18} color="ink-2" />
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  description,
  info,
  trailing,
  children,
  divider = false,
}: {
  icon: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  info?: ReactNode;
  /** The current value or a switch, on the right. */
  trailing?: ReactNode;
  /** A control that needs the row's width, underneath. */
  children?: ReactNode;
  /** A hairline above, for every row after the first. */
  divider?: boolean;
}) {
  return (
    <View className={cn("gap-3 py-4", divider && "border-t border-rule")}>
      <View className="min-h-9 flex-row items-center gap-3">
        <SettingsIcon icon={icon} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-1">
            <Text className="shrink font-sans text-base font-medium text-ink">{label}</Text>
            {info ? <InfoTip>{info}</InfoTip> : null}
          </View>
          {typeof description === "string" ? (
            <Text className="font-sans text-sm text-ink-3">{description}</Text>
          ) : (
            description
          )}
        </View>
        {trailing ? <View className="shrink-0">{trailing}</View> : null}
      </View>
      {children}
    </View>
  );
}

/** A choice pill in a radio group; the chosen one sits on the soft terracotta tint. */
export function choiceChip(selected: boolean): string {
  return `min-h-11 justify-center rounded-full border px-4 active:opacity-70 ${
    selected ? "border-signal bg-sidebar-accent" : "border-rule bg-paper"
  }`;
}

export function choiceText(selected: boolean): string {
  return `font-sans text-sm ${selected ? "font-semibold text-ink" : "text-ink-2"}`;
}
