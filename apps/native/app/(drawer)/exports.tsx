import { useLingui } from "@lingui/react/macro";
import {
  exportBundleArtifact,
  exportCsvArtifacts,
  exportPdfArtifact,
  formatBytes,
  pickExportDomains,
  utf8ByteLength,
  type ExportArtifact,
  type ExportDomain,
} from "@openvalens/api/presenters/clinical-export";
import { useMutation } from "@tanstack/react-query";
import { Button, Card, Chip, Spinner } from "heroui-native";
import { useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, Text, View } from "react-native";

import { Container } from "@/components/container";
import { CardStack } from "@/components/list-row";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

/** Hermes has no btoa/TextEncoder, so encode UTF-8 to base64 directly. */
function utf8ToBase64(text: string): string {
  const bytes = utf8Bytes(text);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64_ALPHABET[first >> 2] ?? "";
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)] ?? "";
    output +=
      second === undefined
        ? "="
        : (BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)] ?? "");
    output += third === undefined ? "=" : (BASE64_ALPHABET[third & 0x3f] ?? "");
  }
  return output;
}

function ArtifactRow({
  artifact,
  onOpen,
}: {
  artifact: ExportArtifact;
  onOpen: (artifact: ExportArtifact) => void;
}) {
  const { t } = useLingui();
  const fileName = artifact.fileName;
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1">
        <Text className="font-mono text-sm text-foreground" numberOfLines={1}>
          {artifact.fileName}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {formatBytes(utf8ByteLength(artifact.content))}
        </Text>
      </View>
      <Pressable
        onPress={() => onOpen(artifact)}
        className="min-h-11 justify-center px-3 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel={t`Open ${fileName}`}
      >
        <Text className="font-medium text-foreground underline">{t`Open`}</Text>
      </Pressable>
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useLingui();
  return (
    <View className="flex-row items-center gap-3">
      <Text className="text-sm text-destructive">{t`Could not export.`}</Text>
      <Pressable
        onPress={onRetry}
        className="min-h-11 justify-center active:opacity-70"
        accessibilityRole="button"
      >
        <Text className="font-medium text-foreground underline">{t`Retry`}</Text>
      </Pressable>
    </View>
  );
}

export default function ExportsScreen() {
  const foreground = useThemeColor("foreground");
  const { t, i18n } = useLingui();
  const options = useMemo(() => pickExportDomains(), []);
  const [selected, setSelected] = useState<Set<ExportDomain>>(
    () =>
      new Set(options.filter((option) => option.defaultSelected).map((option) => option.domain)),
  );
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [bundleArtifacts, setBundleArtifacts] = useState<ExportArtifact[]>([]);
  const [domainArtifacts, setDomainArtifacts] = useState<ExportArtifact[]>([]);

  const bundle = useMutation(
    orpc.exports.clinicalBundle.mutationOptions({
      onSuccess: (data) => {
        setBundleArtifacts([exportBundleArtifact(data)]);
      },
    }),
  );
  const csv = useMutation(
    orpc.exports.legacyDownload.mutationOptions({
      onSuccess: (data) => {
        setDomainArtifacts(exportCsvArtifacts(data.files));
      },
    }),
  );
  const pdf = useMutation(
    orpc.exports.legacyPdfDownload.mutationOptions({
      onSuccess: (data) => {
        setDomainArtifacts([exportPdfArtifact(data)]);
      },
    }),
  );

  const domainPending = csv.isPending || pdf.isPending;
  const domainError = csv.isError || pdf.isError;

  const runBundle = () => {
    setBundleArtifacts([]);
    bundle.mutate({ limit: 200 });
  };

  const runDomainExport = () => {
    if (selected.size === 0) return;
    setDomainArtifacts([]);
    const domains = [...selected];
    if (format === "csv") csv.mutate({ domains, format: "csv" });
    else pdf.mutate({ domains, format: "pdf" });
  };

  const toggle = (domain: ExportDomain) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const openArtifact = async (artifact: ExportArtifact) => {
    const url = `data:${artifact.mime};charset=utf-8;base64,${utf8ToBase64(artifact.content)}`;
    try {
      await Linking.openURL(url);
    } catch {
      // The filename and size stay on screen if the platform cannot open the URL.
    }
  };

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={bundle.isPending || domainPending}
            onRefresh={runDomainExport}
            tintColor={foreground}
          />
        ),
      }}
    >
      <View className="gap-6 p-4">
        <View>
          <Text className="text-sm text-muted-foreground">{t`Records`}</Text>
          <Text className="font-mono text-3xl text-foreground">{t`Clinical export`}</Text>
        </View>

        <CardStack title={t`Download a bundle`}>
          <Card variant="secondary" className="gap-3 p-4">
            <Text className="text-sm text-muted-foreground">
              {t`Download your clinical record as a single JSON bundle.`}
            </Text>
            <View className="flex-row items-center gap-3">
              <Button onPress={runBundle} isDisabled={bundle.isPending}>
                {bundle.isPending ? t`Downloading…` : t`Download bundle`}
              </Button>
              <Chip size="sm" variant="secondary">
                <Chip.Label>JSON</Chip.Label>
              </Chip>
            </View>
            {bundle.isPending ? <Spinner /> : null}
            {bundle.isError ? <ErrorState onRetry={runBundle} /> : null}
            {bundleArtifacts.map((artifact) => (
              <ArtifactRow key={artifact.fileName} artifact={artifact} onOpen={openArtifact} />
            ))}
          </Card>
        </CardStack>

        <CardStack title={t`Download by domain`}>
          <Card variant="secondary" className="gap-4 p-4">
            <Text className="text-sm text-muted-foreground">
              {t`Choose domains and a format, then download.`}
            </Text>

            <View className="gap-2">
              <Text className="text-sm font-medium text-foreground">{t`Domains`}</Text>
              <View className="flex-row flex-wrap gap-2">
                {options.map((option) => {
                  const isSelected = selected.has(option.domain);
                  return (
                    <Pressable
                      key={option.domain}
                      onPress={() => toggle(option.domain)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                        isSelected ? "border-primary bg-primary/15" : "border-border bg-card"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          isSelected ? "font-medium text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {i18n._(option.label)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {selected.size === 0 ? (
                <Text className="text-sm text-destructive">{t`Select at least one domain.`}</Text>
              ) : null}
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium text-foreground">{t`Format`}</Text>
              <View className="flex-row flex-wrap gap-2">
                {(["csv", "pdf"] as const).map((value) => {
                  const isSelected = format === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setFormat(value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                        isSelected ? "border-primary bg-primary/15" : "border-border bg-card"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          isSelected ? "font-medium text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {value.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="flex-row items-center gap-3">
              <Button onPress={runDomainExport} isDisabled={selected.size === 0 || domainPending}>
                {domainPending ? t`Downloading…` : t`Download`}
              </Button>
              <Chip size="sm" variant="secondary">
                <Chip.Label>{format.toUpperCase()}</Chip.Label>
              </Chip>
            </View>
            {domainPending ? <Spinner /> : null}
            {domainError ? <ErrorState onRetry={runDomainExport} /> : null}
            {domainArtifacts.map((artifact) => (
              <ArtifactRow key={artifact.fileName} artifact={artifact} onOpen={openArtifact} />
            ))}
          </Card>
        </CardStack>
      </View>
    </Container>
  );
}
