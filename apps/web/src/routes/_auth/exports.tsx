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
import { Check, Download, FileCheck, Send, Stethoscope } from "lucide-react";
import { useMemo, useState } from "react";

import { Page, PageHeader, Section } from "@/components/page";
import { orpc } from "@/utils/orpc";
import { ModuleHiddenNote } from "@/components/module-hidden-note";
import { CompleteExportCard } from "@/components/complete-export-card";

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
        <li
          key={artifact.fileName}
          className="flex items-center gap-3 rounded-2xl bg-paper-2 px-3 py-2 text-sm"
        >
          <FileCheck className="size-4 shrink-0 text-water" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-ink-2">{artifact.fileName}</span>
          <span className="num shrink-0 text-right text-ink-3">
            {formatBytes(utf8ByteLength(artifact.content))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** #exports-6 "Move to another app": the clinical record as one JSON bundle. */
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
      sheet
      icon={Send}
      tone="water"
      title={<Trans>Move to another app</Trans>}
      info={
        <Trans>
          Your most recent health events and measurements in one structured file that another health
          app can read. For everything, use the full backup.
        </Trans>
      }
    >
      <div className="grid gap-4">
        <p className="max-w-2xl text-sm text-ink-2">
          <Trans>One JSON file for another health app.</Trans>
        </p>
        <div>
          <Button
            variant="outline"
            onClick={() => {
              setArtifacts([]);
              bundle.mutate({ limit: 200 });
            }}
            disabled={bundle.isPending}
          >
            <Download aria-hidden="true" />
            {bundle.isPending ? <Trans>Downloading…</Trans> : <Trans>Download JSON</Trans>}
          </Button>
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

/**
 * #exports-6 "Bring to an appointment": the parts to show a doctor, as a
 * printable page (chosen first) or spreadsheets.
 */
function AppointmentCard() {
  const { i18n } = useLingui();
  const options = useMemo(() => pickExportDomains(), []);
  const [selected, setSelected] = useState<Set<ExportDomain>>(
    () =>
      new Set(options.filter((option) => option.defaultSelected).map((option) => option.domain)),
  );
  const [format, setFormat] = useState<"csv" | "pdf">("pdf");
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
      icon={Stethoscope}
      tone="water"
      title={<Trans>Bring to an appointment</Trans>}
      info={<Trans>Choose what to include and a format, then download.</Trans>}
      sheet
    >
      <div className="grid gap-6">
        <p className="max-w-2xl text-sm text-ink-2">
          <Trans>
            A printable page or spreadsheets with the parts you choose, for your clinician.
          </Trans>
        </p>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-3">
            <Trans>What to include</Trans>
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
                    isSelected
                      ? "border-water/40 bg-water-soft text-ink hover:bg-water-soft"
                      : "border-rule text-ink-2",
                  )}
                  onClick={() => toggle(option.domain)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 items-center justify-center rounded-full border",
                      isSelected ? "border-water bg-water text-card" : "border-ink-3",
                    )}
                  >
                    {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  {i18n._(option.label)}
                </Button>
              );
            })}
          </div>
          {/* #exports-1 — say where the rest of the record is. */}
          <p className="text-sm text-ink-3">
            <Trans>Sleep, activity, vitals, cycle and meals are in the full backup below.</Trans>
          </p>
          {selected.size === 0 ? (
            <span className="text-sm text-destructive">
              <Trans>Select at least one.</Trans>
            </span>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-3">
            <Trans>Format</Trans>
          </legend>
          <div className="flex w-fit gap-1 rounded-full bg-paper-2 p-1">
            {(["pdf", "csv"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={format === value}
                className={cn(
                  "border-transparent",
                  format === value
                    ? "bg-card text-ink shadow-sm hover:bg-card"
                    : "bg-transparent text-ink-2",
                )}
                onClick={() => setFormat(value)}
              >
                {value === "csv" ? (
                  <Trans>Spreadsheets (CSV)</Trans>
                ) : (
                  <Trans>Printable page</Trans>
                )}
              </Button>
            ))}
          </div>
        </fieldset>

        {/* #exports-3 — the format is in the button, not in a chip beside it. */}
        <div>
          <Button
            onClick={submit}
            disabled={selected.size === 0 || active.isPending}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Download aria-hidden="true" />
            {active.isPending ? (
              <Trans>Downloading…</Trans>
            ) : format === "csv" ? (
              <Trans>Download CSV</Trans>
            ) : (
              <Trans>Download printable page</Trans>
            )}
          </Button>
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

/** #exports-5, #exports-6 — one column of three purposes: a doctor, a backup, another app. */
function ExportsPage() {
  return (
    <Page width="narrow">
      <ModuleHiddenNote module="labs" />
      <PageHeader
        title={<Trans>Export your data</Trans>}
        description={<Trans>Choose what the export is for.</Trans>}
      />
      <AppointmentCard />
      <CompleteExportCard primary={false} />
      <BundleCard />
    </Page>
  );
}
