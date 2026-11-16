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
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { cn } from "@openvalens/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, FileCheck, Send, Stethoscope } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Page, PageHeader, Section } from "@/components/page";
import { EXPORT_PERIODS, exportPeriodRange, type ExportPeriodChoice } from "@/utils/export-period";
import { orpc } from "@/utils/orpc";

const DATE_INPUT =
  "h-9 rounded-xl border border-input bg-card px-3 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring";
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
  const [periodChoice, setPeriodChoice] = useState<ExportPeriodChoice>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const period = exportPeriodRange(periodChoice, custom);
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
    if (selected.size === 0 || period === null) return;
    setArtifacts([]);
    const domains = [...selected];
    const range = period ? { period } : {};
    if (format === "csv") csv.mutate({ domains, format: "csv", ...range });
    else pdf.mutate({ domains, format: "pdf", ...range });
  };

  const periodLabels: Record<ExportPeriodChoice, ReactNode> = {
    "3m": <Trans>Last 3 months</Trans>,
    "1y": <Trans>Last year</Trans>,
    all: <Trans>All time</Trans>,
    custom: <Trans>Custom</Trans>,
  };

  return (
    <Section
      icon={Stethoscope}
      tone="water"
      title={<Trans>Bring to an appointment</Trans>}
      info={
        <>
          <p>
            <Trans>Choose what to include, a period and a format, then download.</Trans>
          </p>
          <p>
            <Trans>
              Lab results, scans, workouts, weigh-ins and appointments are limited to the period.
              Current medications, supplements, goals and family history are always included in
              full.
            </Trans>
          </p>
        </>
      }
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

        {/* exports#4 — the period dated records cover; current lists stay whole. */}
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium text-ink-3">
            <Trans>Period</Trans>
          </legend>
          <div className="grid w-full grid-cols-2 gap-1 rounded-3xl bg-paper-2 p-1 sm:flex sm:w-fit sm:rounded-full">
            {EXPORT_PERIODS.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={periodChoice === value}
                className={cn(
                  "border-transparent",
                  periodChoice === value
                    ? "bg-card text-ink shadow-sm hover:bg-card"
                    : "bg-transparent text-ink-2",
                )}
                onClick={() => setPeriodChoice(value)}
              >
                {periodLabels[value]}
              </Button>
            ))}
          </div>
          {periodChoice === "custom" ? (
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div className="grid gap-1">
                <Label htmlFor="export-period-from" className="text-sm text-ink-3">
                  <Trans>From</Trans>
                </Label>
                <input
                  id="export-period-from"
                  type="date"
                  max={custom.to || undefined}
                  value={custom.from}
                  onChange={(event) =>
                    setCustom((previous) => ({ ...previous, from: event.target.value }))
                  }
                  className={DATE_INPUT}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="export-period-to" className="text-sm text-ink-3">
                  <Trans>To</Trans>
                </Label>
                <input
                  id="export-period-to"
                  type="date"
                  min={custom.from || undefined}
                  value={custom.to}
                  onChange={(event) =>
                    setCustom((previous) => ({ ...previous, to: event.target.value }))
                  }
                  className={DATE_INPUT}
                />
              </div>
            </div>
          ) : null}
          {period === null ? (
            <span className="text-sm text-ink-3">
              <Trans>Choose a start or end date.</Trans>
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
            disabled={selected.size === 0 || period === null || active.isPending}
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
