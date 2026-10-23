import { Trans, useLingui } from "@lingui/react/macro";
import { LOCALE_NAMES, LOCALES, reviewStatusOf } from "@openvalens/i18n";
import { Card } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { useAppLocale } from "@/lib/i18n/provider";

/**
 * Interface language (#67). Applies immediately, without a restart. A
 * community translation is marked as such; its safety-critical strings stay
 * in English until a reviewer approves them.
 */
export function LanguageSection() {
  const { locale, setLocale } = useAppLocale();
  const { t } = useLingui();
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
      </Card>
    </CardStack>
  );
}
