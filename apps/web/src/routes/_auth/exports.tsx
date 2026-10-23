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
import { Badge } from "@openvalens/ui/components/badge";
import { Button } from "@openvalens/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

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
    <ul className="grid gap-2">
      {artifacts.map((artifact) => (
        <li key={artifact.fileName} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-mono">{artifact.fileName}</span>
          <Badge variant="outline">{formatBytes(utf8ByteLength(artifact.content))}</Badge>
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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Download a bundle</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          <Trans>Download your clinical record as a single JSON bundle.</Trans>
        </p>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setArtifacts([]);
              bundle.mutate({ limit: 200 });
            }}
            disabled={bundle.isPending}
          >
            {bundle.isPending ? <Trans>Downloading…</Trans> : <Trans>Download bundle</Trans>}
          </Button>
          <Badge variant="secondary">JSON</Badge>
        </div>
        {bundle.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {bundle.isError ? (
          <p className="text-sm text-destructive">
            <Trans>Could not export. Try again.</Trans>
          </p>
        ) : null}
        <ArtifactList artifacts={artifacts} />
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Download by domain</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          <Trans>Choose domains and a format, then download.</Trans>
        </p>

        <div className="grid gap-2">
          <span className="text-sm font-medium">
            <Trans>Domains</Trans>
          </span>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => {
              const isSelected = selected.has(option.domain);
              return (
                <Button
                  key={option.domain}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  aria-pressed={isSelected}
                  onClick={() => toggle(option.domain)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-3.5 items-center justify-center rounded-sm border text-[10px] leading-none",
                      isSelected ? "border-primary-foreground" : "border-muted-foreground",
                    )}
                  >
                    {isSelected ? "✓" : ""}
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
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium">
            <Trans>Format</Trans>
          </span>
          <div className="flex flex-wrap gap-2">
            {(["csv", "pdf"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={format === value ? "default" : "outline"}
                aria-pressed={format === value}
                onClick={() => setFormat(value)}
              >
                {value.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={selected.size === 0 || active.isPending}>
            {active.isPending ? <Trans>Downloading…</Trans> : <Trans>Download</Trans>}
          </Button>
          <Badge variant="secondary">{format.toUpperCase()}</Badge>
        </div>

        {active.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {active.isError ? (
          <p className="text-sm text-destructive">
            <Trans>Could not export. Try again.</Trans>
          </p>
        ) : null}
        <ArtifactList artifacts={artifacts} />
      </CardContent>
    </Card>
  );
}

function ExportsPage() {
  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">
        <Trans>Clinical export</Trans>
      </h1>
      <BundleCard />
      <DomainCard />
    </div>
  );
}
