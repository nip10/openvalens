import { Trans, useLingui } from "@lingui/react/macro";
import { painRegionLabel } from "@openvalens/api/presenters/body-map";
import {
  PAIN_COPY,
  PAIN_TYPE_LABELS,
  PAIN_TYPE_OPTIONS,
  painEntrySummary,
  painRegionText,
  painWorkoutFact,
} from "@openvalens/api/presenters/pain";
import {
  browserTimeZone,
  localInputToIso,
  nowLocalInput,
} from "@openvalens/api/presenters/tracker-draft";
import { PAIN_LIMITS, PAIN_REGION_IDS, type PainType } from "@openvalens/pain/model";
import { Button } from "@openvalens/ui/components/button";
import { Label } from "@openvalens/ui/components/label";
import { Switch } from "@openvalens/ui/components/switch";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, History, Info, Lock, NotebookPen, X } from "lucide-react";
import { useId, useState } from "react";

import { PAIN_KEYS } from "@/components/pain/pain-keys";
import { ErrorState, Section, ToneIcon } from "@/components/page";
import { SettingsGroup, SettingsRow } from "@/components/settings-rows";
import { client } from "@/utils/orpc";

/**
 * The pain layer's side panel (#442): the fixed notice, the opt-in, the log
 * form, a region's history and the settings. The copy is a record of what the
 * member rated: nothing here changes with the value.
 */

export { PAIN_KEYS };

const NATIVE_SELECT =
  "h-9 rounded-md border border-input bg-card px-3 text-ink hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";

/** Always shown on the pain layer, whatever the ratings. */
export function PainNotice() {
  const { i18n } = useLingui();
  return (
    <aside className="sheet flex items-start gap-3 p-5 text-sm text-ink-2">
      <ToneIcon icon={Info} tone="signal" />
      <p className="pt-1.5">{i18n._(PAIN_COPY.notice)}</p>
    </aside>
  );
}

export function PainOff({
  onTurnOn,
  saving,
  failed,
}: {
  onTurnOn: () => void;
  saving: boolean;
  failed: boolean;
}) {
  const { i18n } = useLingui();
  return (
    <Section icon={Lock} tone="weight" title={i18n._(PAIN_COPY.offTitle)} sheet>
      <div className="grid justify-items-start gap-4">
        <p className="max-w-[65ch] text-ink-2">{i18n._(PAIN_COPY.offBody)}</p>
        <Button onClick={onTurnOn} disabled={saving}>
          {saving ? <Trans>Saving…</Trans> : i18n._(PAIN_COPY.turnOn)}
        </Button>
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            <Trans>Could not update this setting. Try again.</Trans>
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function RatingPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  const { i18n } = useLingui();
  return (
    <div role="radiogroup" aria-label={i18n._(PAIN_COPY.rating)} className="flex flex-wrap gap-1">
      {Array.from({ length: 11 }, (_, rating) => (
        <button
          key={rating}
          type="button"
          role="radio"
          aria-checked={value === rating}
          onClick={() => onChange(rating)}
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight" || event.key === "ArrowUp"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowDown"
                  ? -1
                  : 0;
            if (!step) return;
            event.preventDefault();
            const next = Math.min(10, Math.max(0, (value ?? rating) + step));
            onChange(next);
            const group = event.currentTarget.parentElement;
            (group?.children[next] as HTMLElement | undefined)?.focus();
          }}
          tabIndex={value === rating || (value === null && rating === 0) ? 0 : -1}
          className={`num size-9 cursor-pointer rounded-full text-sm font-semibold transition-colors duration-[var(--dur-short)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${value === rating ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink"}`}
        >
          {rating}
        </button>
      ))}
    </div>
  );
}

/**
 * Logs one rating for one or more regions: one entry each. Starts with the
 * region selected on the map; more can be added from the list.
 */
export function PainLogForm({ selected }: { selected: string | null }) {
  const { t, i18n } = useLingui();
  const id = useId();
  const qc = useQueryClient();
  const [regions, setRegions] = useState<string[]>(selected ? [selected] : []);
  const [rating, setRating] = useState<number | null>(null);
  const [type, setType] = useState<PainType | "">("");
  const [when, setWhen] = useState(nowLocalInput);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const others = PAIN_REGION_IDS.filter((region) => !regions.includes(region));

  const save = useMutation({
    mutationFn: () =>
      client.pain.log({
        regions,
        rating: rating!,
        type: type || null,
        timeZone: browserTimeZone(),
        note: note.trim() ? note.trim() : null,
        ...(localInputToIso(when) ? { loggedAt: localInputToIso(when)! } : {}),
      }),
    onSuccess: (created) => {
      const count = created.length;
      setStatus(count === 1 ? t`Saved.` : t`Saved for ${count} regions.`);
      setRating(null);
      setNote("");
      setWhen(nowLocalInput());
      void qc.invalidateQueries({ queryKey: PAIN_KEYS.all });
    },
    onError: () => setStatus(t`Could not save. Check your connection and try again.`),
  });

  const canSave = regions.length > 0 && rating !== null && !save.isPending;

  return (
    <Section icon={NotebookPen} tone="weight" title={<Trans>Log pain</Trans>} sheet>
      <form
        className="grid gap-4 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-semibold text-ink-2">
            <Trans>Where</Trans>
          </legend>
          {regions.length ? (
            <ul className="flex flex-wrap gap-2">
              {regions.map((region) => {
                const name = painRegionText(region, i18n);
                return (
                  <li
                    key={region}
                    className="flex items-center gap-1 rounded-full bg-paper-2 py-1 pr-1 pl-3"
                  >
                    {name}
                    <button
                      type="button"
                      className="grid size-6 cursor-pointer place-items-center rounded-full text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label={t`Remove ${name}`}
                      onClick={() => setRegions(regions.filter((item) => item !== region))}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-3">
              <Trans>Select a region on the map, or add one from the list.</Trans>
            </p>
          )}
          {regions.length < PAIN_LIMITS.regionsPerLog ? (
            <label className="grid gap-1.5 text-ink-3">
              <Trans>Add a region</Trans>
              <select
                className={NATIVE_SELECT}
                value=""
                onChange={(event) => {
                  if (event.target.value) setRegions([...regions, event.target.value]);
                }}
              >
                <option value="">{t`Choose a region`}</option>
                {others.map((region) => (
                  <option key={region} value={region}>
                    {painRegionText(region, i18n)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </fieldset>

        <div className="grid gap-2">
          <p className="font-semibold text-ink-2">{i18n._(PAIN_COPY.rating)}</p>
          <RatingPicker value={rating} onChange={setRating} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-ink-3">
            <Trans>Type (optional)</Trans>
            <select
              className={NATIVE_SELECT}
              value={type}
              onChange={(event) => setType(event.target.value as PainType | "")}
            >
              <option value="">{t`No type`}</option>
              {PAIN_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {i18n._(PAIN_TYPE_LABELS[option])}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-ink-3">
            <Trans>When</Trans>
            <input
              type="datetime-local"
              className={NATIVE_SELECT}
              value={when}
              max={nowLocalInput()}
              onChange={(event) => setWhen(event.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-note`} className="text-ink-3">
            <Trans>Note (optional)</Trans>
          </Label>
          <Textarea
            id={`${id}-note`}
            value={note}
            maxLength={PAIN_LIMITS.noteLength}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canSave}>
            {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
          <p role="status" aria-live="polite" className="text-ink-3">
            {status}
          </p>
        </div>
      </form>
    </Section>
  );
}

function formatWhen(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** One region's ratings over time, with the workouts near each as plain facts. */
export function PainHistory({ region }: { region: string }) {
  const { t, i18n } = useLingui();
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: PAIN_KEYS.history(region),
    queryFn: () => client.pain.history({ region, days: 90, timeZone: browserTimeZone() }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.pain.delete({ id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: PAIN_KEYS.all }),
  });
  const label = painRegionLabel(region);
  const name = label ? i18n._(label) : region;

  return (
    <Section
      icon={History}
      tone="weight"
      title={<Trans>History: {name}</Trans>}
      info={i18n._(PAIN_COPY.history)}
    >
      {history.isPending ? (
        <p role="status" className="text-sm text-ink-3">
          <Trans>Loading…</Trans>
        </p>
      ) : history.isError ? (
        <ErrorState
          title={<Trans>Could not load this region's history.</Trans>}
          action={
            <Button variant="outline" onClick={() => void history.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      ) : !history.data.entries.length ? (
        <p className="text-sm text-ink-2">{i18n._(PAIN_COPY.noHistory)}</p>
      ) : (
        <ul className="sheet grid divide-y divide-rule px-5 text-sm">
          {history.data.entries.map((entry) => (
            <li key={entry.id} className="grid gap-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">{painEntrySummary(entry, i18n)}</p>
                <p className="text-ink-3">{formatWhen(entry.loggedAt, i18n.locale)}</p>
              </div>
              {entry.note ? <p className="text-ink-2">{entry.note}</p> : null}
              {entry.workoutsBefore.length ? (
                <ul
                  className="grid gap-0.5 text-ink-3"
                  aria-label={t`Workouts logged near this rating`}
                >
                  {entry.workoutsBefore.map((fact) => (
                    <li key={fact.id}>{painWorkoutFact(fact, i18n)}</li>
                  ))}
                </ul>
              ) : null}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(t`Delete this rating? This cannot be undone.`))
                      remove.mutate(entry.id);
                  }}
                >
                  <Trans>Delete</Trans>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {remove.isError ? (
        <p role="alert" className="text-sm text-destructive">
          <Trans>Could not delete this rating. Try again.</Trans>
        </p>
      ) : null}
    </Section>
  );
}

/** The opt-in and the separate AI switch (off by default). */
export function PainSettings({
  preference,
  saving,
  onChange,
}: {
  preference: { enabled: boolean; aiVisible: boolean };
  saving: boolean;
  onChange: (change: { enabled?: boolean; aiVisible?: boolean }) => void;
}) {
  const { i18n } = useLingui();
  return (
    <Section icon={Lock} tone="weight" title={<Trans>Pain log settings</Trans>}>
      <SettingsGroup>
        <SettingsRow
          icon={Lock}
          label={i18n._(PAIN_COPY.enabled)}
          description={i18n._(PAIN_COPY.enabledDetail)}
        >
          <Switch
            aria-label={i18n._(PAIN_COPY.enabled)}
            checked={preference.enabled}
            disabled={saving}
            onCheckedChange={(checked) => onChange({ enabled: checked })}
          />
        </SettingsRow>
        <SettingsRow
          icon={Bot}
          label={i18n._(PAIN_COPY.aiVisible)}
          description={i18n._(PAIN_COPY.aiVisibleDetail)}
        >
          <Switch
            aria-label={i18n._(PAIN_COPY.aiVisible)}
            checked={preference.aiVisible}
            disabled={saving}
            onCheckedChange={(checked) => onChange({ aiVisible: checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </Section>
  );
}
