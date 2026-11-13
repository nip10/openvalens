import { Trans, useLingui } from "@lingui/react/macro";
import {
  defaultManualSleepWindow,
  MANUAL_SLEEP_DUPLICATE_NOTE,
  MANUAL_SLEEP_ERROR_MESSAGES,
  parseManualSleepForm,
  SLEEP_QUALITY_LABELS,
  SLEEP_QUALITY_VALUES,
} from "@openvalens/api/presenters/manual-sleep";
import type { ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";
import { formatClockTime, formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BedDouble, Trash2 } from "lucide-react";
import { useState } from "react";

import { Section, StatusPill } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

/**
 * Manual sleep (#440): bedtime, wake time and an optional quality from 1 to 5.
 * A typed-in night is kept apart from device sleep: when they overlap it is
 * marked "Possible duplicate" and the device night counts in the totals.
 */
export function ManualSleepSection({ settings }: { settings?: ProductDisplaySettings | null }) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const sessions = useQuery(orpc.sleep.manualSessions.queryOptions({ input: { days: 30 } }));
  const [initial] = useState(() => defaultManualSleepWindow());
  const [bedtime, setBedtime] = useState(initial.bedtime);
  const [wakeAt, setWakeAt] = useState(initial.wakeAt);
  const [quality, setQuality] = useState<number | null>(null);

  const parsed = parseManualSleepForm(bedtime, wakeAt);
  const duration = parsed.ok ? formatSleepDuration(parsed.window.minutes) : "";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.sleep.key() });
  };

  const save = useMutation(
    orpc.sleep.logManualSession.mutationOptions({
      onSuccess: () => {
        setQuality(null);
        refresh();
      },
    }),
  );
  const remove = useMutation(
    orpc.sleep.deleteManualSession.mutationOptions({ onSuccess: refresh }),
  );

  return (
    <Section icon={BedDouble} tone="sleep" title={<Trans>Add a night</Trans>} sheet>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!parsed.ok) return;
          save.mutate({
            startAt: parsed.window.startAt,
            endAt: parsed.window.endAt,
            quality,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="sleep-bedtime" className="text-sm font-medium">
              <Trans>Bedtime</Trans>
            </Label>
            <Input
              id="sleep-bedtime"
              type="datetime-local"
              value={bedtime}
              onChange={(event) => setBedtime(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sleep-wake" className="text-sm font-medium">
              <Trans>Wake time</Trans>
            </Label>
            <Input
              id="sleep-wake"
              type="datetime-local"
              value={wakeAt}
              onChange={(event) => setWakeAt(event.target.value)}
            />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            <Trans>How did it feel? (optional)</Trans>
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t`Quality`}>
            {SLEEP_QUALITY_VALUES.map((value) => {
              const selected = quality === value;
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setQuality(selected ? null : value)}
                >
                  <span className="num">{value}</span>
                  <span>{i18n._(SLEEP_QUALITY_LABELS[value]!)}</span>
                </Button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!parsed.ok || save.isPending}>
            {save.isPending ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
          </Button>
          <span role="status" className="text-sm">
            {!parsed.ok ? (
              <span className="text-destructive">
                {i18n._(MANUAL_SLEEP_ERROR_MESSAGES[parsed.error])}
              </span>
            ) : save.isSuccess && save.data.possibleDuplicate ? (
              <span className="text-warning">{i18n._(MANUAL_SLEEP_DUPLICATE_NOTE)}</span>
            ) : save.isSuccess ? (
              <span className="text-success">
                <Trans>Saved · {duration}</Trans>
              </span>
            ) : save.isError ? (
              <span className="text-destructive">
                <Trans>Could not save.</Trans>
              </span>
            ) : (
              <span className="text-ink-3">{duration}</span>
            )}
          </span>
        </div>
      </form>

      {sessions.data && sessions.data.length > 0 ? (
        <div className="mt-5 grid gap-2 border-t border-rule pt-4">
          <h3 className="text-sm font-semibold text-ink-2">
            <Trans>Nights you added</Trans>
          </h3>
          <ul className="grid gap-2">
            {sessions.data.map((session) => {
              const minutes = Math.round(
                (Date.parse(session.endAt) - Date.parse(session.startAt)) / 60_000,
              );
              const range = `${formatClockTime(session.startAt, settings)} – ${formatClockTime(session.endAt, settings)}`;
              const day = friendlyDate(i18n, session.endAt);
              return (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                >
                  <span className="grid gap-0.5">
                    <span className="num font-semibold text-ink">
                      {formatSleepDuration(minutes)}
                    </span>
                    <span className="num text-sm text-ink-3">
                      {`${day} · ${range}`}
                      {session.quality !== null && SLEEP_QUALITY_LABELS[session.quality]
                        ? ` · ${i18n._(SLEEP_QUALITY_LABELS[session.quality]!)}`
                        : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {session.possibleDuplicate ? (
                      <StatusPill tone="warn">
                        <Trans>Possible duplicate</Trans>
                      </StatusPill>
                    ) : null}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t`Remove the night of ${day}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: session.id })}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          {sessions.data.some((session) => session.possibleDuplicate) ? (
            <p className="text-sm text-ink-3">{i18n._(MANUAL_SLEEP_DUPLICATE_NOTE)}</p>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
