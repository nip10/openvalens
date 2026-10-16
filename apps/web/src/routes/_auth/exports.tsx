import {
  decodeBase64,
  exportBundleArtifact,
  exportCsvArtifacts,
  formatBytes,
  pickClinicalPdfDomains,
  pickExportDomains,
  utf8ByteLength,
  type ClinicalPdfDomain,
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
        <CardTitle>Download a bundle</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Download your clinical record as a single JSON bundle.
        </p>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setArtifacts([]);
              bundle.mutate({ limit: 200 });
            }}
            disabled={bundle.isPending}
          >
            {bundle.isPending ? "Downloading…" : "Download bundle"}
          </Button>
          <Badge variant="secondary">JSON</Badge>
        </div>
        {bundle.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {bundle.isError ? (
          <p className="text-sm text-destructive">Could not export. Try again.</p>
        ) : null}
        <ArtifactList artifacts={artifacts} />
      </CardContent>
    </Card>
  );
}

function DomainCard() {
  const options = useMemo(() => pickExportDomains(), []);
  const [selected, setSelected] = useState<Set<ExportDomain>>(
    () =>
      new Set(options.filter((option) => option.defaultSelected).map((option) => option.domain)),
  );
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
    csv.mutate({ domains: [...selected], format: "csv" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download CSV by domain</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Choose domains, then download one CSV file per domain.
        </p>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Domains</span>
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
                  {option.label}
                </Button>
              );
            })}
          </div>
          {selected.size === 0 ? (
            <span className="text-sm text-destructive">Select at least one domain.</span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={selected.size === 0 || csv.isPending}>
            {csv.isPending ? "Downloading…" : "Download"}
          </Button>
          <Badge variant="secondary">CSV</Badge>
        </div>

        {csv.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {csv.isError ? (
          <p className="text-sm text-destructive">Could not export. Try again.</p>
        ) : null}
        <ArtifactList artifacts={artifacts} />
      </CardContent>
    </Card>
  );
}

function downloadPdf(fileName: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Issue #132 — clinical PDF. Generated on request and handed straight to the
 * browser; the server keeps no copy and the object URL is revoked at once.
 */
function ClinicalPdfCard() {
  const options = useMemo(() => pickClinicalPdfDomains(), []);
  const [selected, setSelected] = useState<Set<ClinicalPdfDomain>>(
    () =>
      new Set(options.filter((option) => option.defaultSelected).map((option) => option.domain)),
  );
  const [file, setFile] = useState<{ fileName: string; byteLength: number } | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);

  const pdf = useMutation(
    orpc.exports.clinicalPdf.mutationOptions({
      onSuccess: (data) => {
        const bytes = decodeBase64(data.contentBase64);
        if (!bytes) {
          setDecodeFailed(true);
          return;
        }
        downloadPdf(data.fileName, bytes);
        setFile({ fileName: data.fileName, byteLength: bytes.byteLength });
      },
    }),
  );

  const toggle = (domain: ClinicalPdfDomain) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download a PDF summary</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          A printable copy of the selected records, with the source and date of each entry. Values
          are shown as stored, without interpretation. It is not medical advice. The file is created
          when you download it and is not kept on the server.
        </p>
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
                {option.label}
              </Button>
            );
          })}
        </div>
        {selected.size === 0 ? (
          <span className="text-sm text-destructive">Select at least one section.</span>
        ) : null}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setFile(null);
              setDecodeFailed(false);
              pdf.mutate({ domains: [...selected] });
            }}
            disabled={selected.size === 0 || pdf.isPending}
          >
            {pdf.isPending ? "Preparing…" : "Download PDF"}
          </Button>
          <Badge variant="secondary">PDF</Badge>
        </div>
        {pdf.isPending ? <Skeleton className="h-4 w-48" /> : null}
        {pdf.isError || decodeFailed ? (
          <p className="text-sm text-destructive">Could not export. Try again.</p>
        ) : null}
        {file ? (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-mono">{file.fileName}</span>
            <Badge variant="outline">{formatBytes(file.byteLength)}</Badge>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExportsPage() {
  return (
    <div className="container mx-auto grid max-w-3xl gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Clinical export</h1>
      <ClinicalPdfCard />
      <BundleCard />
      <DomainCard />
    </div>
  );
}
