import { Trans, useLingui } from "@lingui/react/macro";
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
import { Button } from "@openvalens/ui/components/button";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { Page, PageHeader, Section } from "@/components/page";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/exports")({
  component: ExportsPage,
});

function triggerDownload(artifact: ExportArtifact) {
  const blob = new Blob([artifact.content], { type: `${artifact.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ArtifactList({ artifacts }: { artifacts: ExportArtifact[] }) {
  if (artifacts.length === 0) return null;

  return (
    <ul className="divide-y divide-rule border-t border-rule">
      {artifacts.map((artifact) => (
        <li
          key={artifact.fileName}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-2 text-sm"
        >
          <span className="min-w-0 truncate font-mono text-ink-2">{artifact.fileName}</span>
          <span className="num text-right text-ink-3">
            {formatBytes(utf8ByteLength(artifact.content))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BundleCard() {
  const [artifacts, setArtifacts] = useState<ExportArtifact[]>([]);
  const bundle = useMutation(
    orpc.exports.clinicalBundle.mutationOptions({
      onSuccess: (data) => {
        const artifact = exportBundleArtifact(data);
        triggerDownload(artifact);
        setArtifacts([artifact]);
      },
    }),
  );

  return (
    <Section
      title={<Trans>Download a bundle</Trans>}
      description={<Trans>Download your clinical record as a single JSON bundle.</Trans>}
    >
      <div className="well grid gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setArtifacts([]);
              bundle.mutate({ limit: 200 });
            }}
            disabled={bundle.isPending}
          >
            {bundle.isPending ? <Trans>Downloading…</Trans> : <Trans>Download bundle</Trans>}
          </Button>
          <span className="text-sm text-ink-3">JSON</span>
        </div>
        {bundle.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {bundle.isError ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not export. Try again.</Trans>
          </p>
        ) : null}
        <ArtifactList artifacts={artifacts} />
      </div>
    </Section>
  );
}

function DomainCard() {
  const { i18n } = useLingui();
  const options = useMemo(() => pickExportDomains(), []);
  const [selected, setSelected] = useState<Set<ExportDomain>>(
    () =>
      new Set(options.filter((option) => option.defaultSelected).map((option) => option.domain)),
  );
  const [format, setFormat] = useState<"csv" | "pdf">("csv");
  const [artifacts, setArtifacts] = useState<ExportArtifact[]>([]);

  const csv = useMutation(
    orpc.exports.legacyDownload.mutationOptions({
      onSuccess: (data) => {
        const files = exportCsvArtifacts(data.files);
        files.forEach(triggerDownload);
        setArtifacts(files);
      },
    }),
  );
  const pdf = useMutation(
    orpc.exports.legacyPdfDownload.mutationOptions({
      onSuccess: (data) => {
        const artifact = exportPdfArtifact(data);
        triggerDownload(artifact);
        setArtifacts([artifact]);
      },
    }),
  );

  const active = format === "csv" ? csv : pdf;

  const toggle = (domain: ExportDomain) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const submit = () => {
    if (selected.size === 0) return;
    setArtifacts([]);
    const domains = [...selected];
    if (format === "csv") csv.mutate({ domains, format: "csv" });
    else pdf.mutate({ domains, format: "pdf" });
  };

  return (
    <Section
      title={<Trans>Download by domain</Trans>}
      description={<Trans>Choose domains and a format, then download.</Trans>}
      sheet
    >
      <div className="grid gap-6 py-1">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-3">
            <Trans>Domains</Trans>
          </legend>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => {
              const isSelected = selected.has(option.domain);
              return (
                <Button
                  key={option.domain}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={isSelected}
                  className={cn(
                    isSelected ? "bg-paper-3 hover:bg-paper-3" : "border-rule text-ink-2",
                  )}
                  onClick={() => toggle(option.domain)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-3.5 items-center justify-center rounded-sm border",
                      isSelected ? "border-ink bg-ink text-sheet" : "border-ink-3",
                    )}
                  >
                    {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  {i18n._(option.label)}
                </Button>
              );
            })}
          </div>
          {selected.size === 0 ? (
            <span className="text-sm text-destructive">
              <Trans>Select at least one domain.</Trans>
            </span>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-3">
            <Trans>Format</Trans>
          </legend>
          <div className="flex w-fit">
            {(["csv", "pdf"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={format === value}
                className={cn(
                  "not-first:-ml-px",
                  format === value ? "z-10 bg-paper-3 hover:bg-paper-3" : "text-ink-2",
                )}
                onClick={() => setFormat(value)}
              >
                {value.toUpperCase()}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3 border-t border-rule pt-4">
          <Button
            onClick={submit}
            disabled={selected.size === 0 || active.isPending}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {active.isPending ? <Trans>Downloading…</Trans> : <Trans>Download</Trans>}
          </Button>
          <span className="text-sm text-ink-3">{format.toUpperCase()}</span>
        </div>

        {active.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {active.isError ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not export. Try again.</Trans>
          </p>
        ) : null}
        <ArtifactList artifacts={artifacts} />
      </div>
    </Section>
  );
}

function ExportsPage() {
  return (
    <Page>
      <PageHeader title={<Trans>Clinical export</Trans>} />
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <DomainCard />
        <BundleCard />
      </div>
    </Page>
  );
}
