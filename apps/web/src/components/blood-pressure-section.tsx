import { Trans, useLingui } from "@lingui/react/macro";
import {
  bloodPressureSamples,
  defaultObservedAt,
  MANUAL_ENTRY_FIELDS,
  parseBloodPressure,
} from "@openvalens/api/presenters/manual-entry";
import {
  BLOOD_PRESSURE_DUPLICATE_NOTE,
  bloodPressureSourceLabel,
  formatBloodPressure,
  formatBpm,
} from "@openvalens/api/presenters/vitals";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { useState } from "react";

import { Section, StatusPill } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { client, orpc } from "@/utils/orpc";
import { enqueueMetricSample } from "@/utils/sync-engine";

/**
 * Manual blood pressure (#440): systolic, diastolic and an optional pulse,
 * written through `healthRecord.ingestMetricSample` with the same metric codes
 * a Bluetooth monitor writes (and queued offline like other readings). Recent
 * readings show device and typed-in values side by side; nothing is merged.
 */
export function BloodPressureSection() {
  const { t, i18n } = useLingui();
  const readings = useQuery(
    orpc.vitals.bloodPressureReadings.queryOptions({ input: { limit: 10 } }),
  );
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [observedAt, setObservedAt] = useState(defaultObservedAt);

  const parsed = parseBloodPressure({ systolic, diastolic, pulse });
  const touched = systolic.length > 0 && diastolic.length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed.ok) return;
      const samples = bloodPressureSamples(parsed.reading, observedAt);
      const results = await Promise.allSettled(
        samples.map((sample) => client.healthRecord.ingestMetricSample(sample)),
      );
      let failure: unknown = null;
      results.forEach((result, index) => {
        if (result.status === "fulfilled") return;
        enqueueMetricSample(samples[index]!, result.reason);
        failure ??= result.reason;
      });
      if (failure) throw failure;
    },
    onSuccess: () => {
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setObservedAt(defaultObservedAt());
    },
    onSettled: () => void readings.refetch(),
  });

  const { min: systolicMin, max: systolicMax } = MANUAL_ENTRY_FIELDS.blood_pressure_systolic;
  const { min: diastolicMin, max: diastolicMax } = MANUAL_ENTRY_FIELDS.blood_pressure_diastolic;
  const { min: pulseMin, max: pulseMax } = MANUAL_ENTRY_FIELDS.heart_rate;
  const errors = parsed.ok ? [] : parsed.errors;

  return (
    <Section icon={Gauge} tone="heart" title={<Trans>Blood pressure</Trans>} sheet>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (parsed.ok) save.mutate();
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="bp-systolic" className="text-sm font-medium">
              <Trans>Systolic (mmHg)</Trans>
            </Label>
            <Input
              id="bp-systolic"
              inputMode="numeric"
              value={systolic}
              onChange={(event) => setSystolic(event.target.value)}
              placeholder="120"
              aria-invalid={touched && errors.includes("systolic")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-diastolic" className="text-sm font-medium">
              <Trans>Diastolic (mmHg)</Trans>
            </Label>
            <Input
              id="bp-diastolic"
              inputMode="numeric"
              value={diastolic}
              onChange={(event) => setDiastolic(event.target.value)}
              placeholder="80"
              aria-invalid={touched && errors.includes("diastolic")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bp-pulse" className="text-sm font-medium">
              <Trans>Pulse (bpm)</Trans>
            </Label>
            <Input
              id="bp-pulse"
              inputMode="numeric"
              value={pulse}
              onChange={(event) => setPulse(event.target.value)}
              placeholder={t`Optional`}
              aria-invalid={errors.includes("pulse")}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bp-observed-at" className="text-sm font-medium">
            <Trans>Observed at</Trans>
          </Label>
          <Input
            id="bp-observed-at"
            type="datetime-local"
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!parsed.ok || save.isPending}>
            {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
          <span role="status" className="text-sm">
            {touched && errors.includes("order") ? (
              <span className="text-destructive">
                <Trans>Systolic must be higher than diastolic.</Trans>
              </span>
            ) : touched && errors.length > 0 ? (
              <span className="text-destructive">
                <Trans>
                  Systolic {systolicMin}–{systolicMax}, diastolic {diastolicMin}–{diastolicMax},
                  pulse {pulseMin}–{pulseMax}.
                </Trans>
              </span>
            ) : save.isSuccess ? (
              <span className="text-success">
                <Trans>Saved</Trans>
              </span>
            ) : save.isError ? (
              <span className="text-destructive">
                <Trans>Could not save.</Trans>
              </span>
            ) : null}
          </span>
        </div>
      </form>

      {readings.data && readings.data.length > 0 ? (
        <ul className="mt-5 grid gap-2 border-t border-rule pt-4" aria-label={t`Recent readings`}>
          {readings.data.map((reading) => (
            <li
              key={`${reading.observedAt}-${reading.source ?? ""}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
            >
              <span className="num font-semibold text-ink">
                {formatBloodPressure(reading)}
                {reading.pulse !== null ? (
                  <span className="ml-2 font-normal text-ink-3">{formatBpm(reading.pulse)}</span>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <span className="num">
                  {`${friendlyDate(i18n, reading.observedAt)} ${new Date(reading.observedAt).toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" })}`}
                </span>
                <span>{bloodPressureSourceLabel(reading, i18n)}</span>
                {reading.possibleDuplicate ? (
                  <StatusPill tone="warn">
                    <Trans>Possible duplicate</Trans>
                  </StatusPill>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {readings.data?.some((reading) => reading.possibleDuplicate) ? (
        <p className="mt-3 text-sm text-ink-3">{i18n._(BLOOD_PRESSURE_DUPLICATE_NOTE)}</p>
      ) : null}
    </Section>
  );
}
