import { Linking, Pressable, Text, View } from "react-native";

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function canonicalTranslationLicenseUrl(license: string | null | undefined): string | null {
  switch (license) {
    case "CC0-1.0":
      return "https://creativecommons.org/publicdomain/zero/1.0/";
    case "CC-BY-SA-3.0":
      return "https://creativecommons.org/licenses/by-sa/3.0/";
    case "CC-BY-SA-4.0":
      return "https://creativecommons.org/licenses/by-sa/4.0/";
    default:
      return null;
  }
}

export function ExerciseAttribution({
  title,
  license,
  author,
  attribution,
  sourceUrl,
  licenseUrl,
  licenseLinkLabel = "License details",
}: {
  title: string;
  license?: string | null;
  author?: string | null;
  attribution?: string | null;
  sourceUrl?: string | null;
  licenseUrl?: string | null;
  licenseLinkLabel?: string;
}) {
  const licenseHref = safeHttpUrl(licenseUrl);
  const sourceHref = safeHttpUrl(sourceUrl);
  return (
    <View className="gap-1 rounded-lg border border-border p-3" accessibilityLabel={title}>
      <Text className="text-sm font-medium text-foreground">{title}</Text>
      <Text className="text-xs text-muted-foreground">
        {license ? `License: ${license}${author ? ` · ${author}` : ""}` : "License not listed."}
      </Text>
      {attribution ? <Text className="text-xs text-muted-foreground">{attribution}</Text> : null}
      {licenseHref ? (
        <Pressable
          onPress={() => void Linking.openURL(licenseHref)}
          accessibilityRole="link"
          accessibilityLabel={licenseLinkLabel}
          className="min-h-11 justify-center"
        >
          <Text className="text-sm text-foreground underline">{licenseLinkLabel}</Text>
        </Pressable>
      ) : null}
      {sourceHref ? (
        <Pressable
          onPress={() => void Linking.openURL(sourceHref)}
          accessibilityRole="link"
          accessibilityLabel="Source record"
          className="min-h-11 justify-center"
        >
          <Text className="text-sm text-foreground underline">Source record</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TranslationAttribution({
  language,
  requestedLanguage,
  attribution,
}: {
  language: string | null;
  requestedLanguage: string;
  attribution: {
    license: string | null;
    author: string | null;
    sourceUrl: string | null;
    rawAttribution: string | null;
  };
}) {
  const title = `Selected translation${language?.toLowerCase() === "en" && requestedLanguage.toLowerCase() !== "en" ? " (English fallback)" : language ? ` (${language})` : ""}`;
  return (
    <ExerciseAttribution
      title={title}
      license={attribution.license}
      author={attribution.author}
      attribution={attribution.rawAttribution}
      sourceUrl={attribution.sourceUrl}
      licenseUrl={canonicalTranslationLicenseUrl(attribution.license)}
      licenseLinkLabel="Selected translation license details"
    />
  );
}
