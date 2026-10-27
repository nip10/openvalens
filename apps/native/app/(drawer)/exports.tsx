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
import { Button, cn, Spinner } from "heroui-native";
import { Download, FileArchive, FileText, Layers } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, Text, View } from "react-native";

import {
  ErrorState,
  Icon,
  ListCard,
  Page,
  PageHeader,
  Section,
  Sheet,
  ToneChip,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";
import { ModuleHiddenNote } from "@/components/module-hidden-note";

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
    <ListCard
      icon={FileText}
      tone="water"
      title={fileName}
      subtitle={formatBytes(utf8ByteLength(artifact.content))}
      trailing={
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onOpen(artifact)}
          accessibilityRole="button"
          accessibilityLabel={t`Open ${fileName}`}
        >
          <Button.Label>{t`Open`}</Button.Label>
        </Button>
      }
    />
  );
}

function ExportError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLingui();
  return (
    <ErrorState
      title={t`Could not export.`}
      action={
        <Button variant="outline" size="sm" onPress={onRetry}>
          <Button.Label>{t`Retry`}</Button.Label>
        </Button>
      }
    />
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
      <Page>
        <ModuleHiddenNote module="labs" />
        <PageHeader eyebrow={t`Records`} title={t`Clinical export`} />

        <Section
          icon={FileArchive}
          tone="water"
          title={t`Download a bundle`}
          description={t`Download your clinical record as a single JSON bundle.`}
        >
          <Sheet className="gap-3">
            <View className="flex-row items-center gap-3">
              <Button className="flex-1" onPress={runBundle} isDisabled={bundle.isPending}>
                <Icon icon={Download} size={18} color="primary-foreground" />
                <Button.Label>
                  {bundle.isPending ? t`Downloading…` : t`Download bundle`}
                </Button.Label>
              </Button>
              <ToneChip tone="water">JSON</ToneChip>
            </View>
            {bundle.isPending ? <Spinner /> : null}
            {bundle.isError ? <ExportError onRetry={runBundle} /> : null}
          </Sheet>
          {bundleArtifacts.map((artifact) => (
            <ArtifactRow key={artifact.fileName} artifact={artifact} onOpen={openArtifact} />
          ))}
        </Section>

        <Section
          icon={Layers}
          tone="water"
          title={t`Download by domain`}
          description={t`Choose domains and a format, then download.`}
        >
          <Sheet className="gap-5">
            <View className="gap-2">
              <Text className="font-sans text-sm font-medium text-ink-2">{t`Domains`}</Text>
              <View className="flex-row flex-wrap gap-2">
                {options.map((option) => {
                  const isSelected = selected.has(option.domain);
                  return (
                    <Pressable
                      key={option.domain}
                      onPress={() => toggle(option.domain)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      className={cn(
                        "min-h-9 justify-center rounded-full border px-3.5 py-1.5 active:opacity-70",
                        isSelected ? "border-water bg-water-soft" : "border-rule-2 bg-card",
                      )}
                    >
                      <Text
                        className={cn(
                          "font-sans text-sm",
                          isSelected ? "font-semibold text-ink" : "text-ink-3",
                        )}
                      >
                        {i18n._(option.label)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {selected.size === 0 ? (
                <Text className="font-sans text-sm text-destructive">
                  {t`Select at least one domain.`}
                </Text>
              ) : null}
            </View>

            <View className="gap-2">
              <Text className="font-sans text-sm font-medium text-ink-2">{t`Format`}</Text>
              <View className="flex-row flex-wrap gap-2">
                {(["csv", "pdf"] as const).map((value) => {
                  const isSelected = format === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setFormat(value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      className={cn(
                        "min-h-9 justify-center rounded-full border px-3.5 py-1.5 active:opacity-70",
                        isSelected ? "border-water bg-water-soft" : "border-rule-2 bg-card",
                      )}
                    >
                      <Text
                        className={cn(
                          "font-sans text-sm",
                          isSelected ? "font-semibold text-ink" : "text-ink-3",
                        )}
                      >
                        {value.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="flex-row items-center gap-3">
              <Button
                className="flex-1"
                variant="secondary"
                onPress={runDomainExport}
                isDisabled={selected.size === 0 || domainPending}
              >
                <Icon icon={Download} size={18} color="ink" />
                <Button.Label>{domainPending ? t`Downloading…` : t`Download`}</Button.Label>
              </Button>
              <ToneChip tone="water">{format.toUpperCase()}</ToneChip>
            </View>
            {domainPending ? <Spinner /> : null}
            {domainError ? <ExportError onRetry={runDomainExport} /> : null}
          </Sheet>
          {domainArtifacts.map((artifact) => (
            <ArtifactRow key={artifact.fileName} artifact={artifact} onOpen={openArtifact} />
          ))}
        </Section>
      </Page>
    </Container>
  );
}
