import { Trans, useLingui } from "@lingui/react/macro";
import { formatTrackerValue, parseTrackerInput } from "@openvalens/api/presenters/trackers";
import {
  findTrackerTemplate,
  TRACKER_LIMITS,
  type TrackerTemplateId,
  type TrackerType,
} from "@openvalens/trackers/model";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import { Textarea } from "@openvalens/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import { client } from "@/utils/orpc";

import { browserTimeZone, localInputToIso, nowLocalInput } from "./tracker-draft";
import { TrackerValueInput } from "./tracker-value-input";

export type LoggableTracker = {
  id: string;
  name: string;
  type: TrackerType;
  unit: string | null;
  decimals: number;
  template: TrackerTemplateId | null;
};

/**
 * Logs one entry into a custom tracker (#441): the value, an optional time
 * (now by default) and an optional note. Several entries a day combine by
 * the tracker's rule. Saves at once and offers an undo.
 */
export function TrackerLogForm({
  tracker,
  onLogged,
  compact = false,
}: {
  tracker: LoggableTracker;
  onLogged: () => void;
  compact?: boolean;
}) {
  const { t, i18n } = useLingui();
  const id = useId();
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [showMore, setShowMore] = useState(
    () => findTrackerTemplate(tracker.template)?.promptsNote === true,
  );
  const [touched, setTouched] = useState(false);
  const value = parseTrackerInput(tracker, text, i18n.locale);
  const invalid = touched && value === null;

  const undo = useMutation({
    mutationFn: (entryId: string) => client.trackers.deleteEntry({ id: entryId }),
    onSuccess: onLogged,
  });
  const save = useMutation({
    mutationFn: () =>
      client.trackers.log({
        trackerId: tracker.id,
        value: value!,
        timeZone: browserTimeZone(),
        ...(localInputToIso(when) ? { loggedAt: localInputToIso(when) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (entry) => {
      setText("");
      setNote("");
      setWhen("");
      setTouched(false);
      onLogged();
      const logged = formatTrackerValue(i18n, tracker, entry.value);
      toast.success(t`Logged ${logged}.`, {
        action: { label: t`Undo`, onClick: () => undo.mutate(entry.id) },
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t`Could not save. Try again.`),
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (value !== null && !save.isPending) save.mutate();
      }}
    >
      <div className="grid gap-1.5">
        <Label
          id={`${id}-value-label`}
          htmlFor={`${id}-value`}
          className={compact ? "sr-only" : ""}
        >
          <Trans>Value for {tracker.name}</Trans>
        </Label>
        <TrackerValueInput
          id={`${id}-value`}
          type={tracker.type}
          unit={tracker.unit}
          template={tracker.template}
          text={text}
          onText={setText}
          invalid={invalid}
          describedBy={invalid ? `${id}-error` : undefined}
        />
        {invalid ? (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {tracker.type === "duration" ? (
              <Trans>Enter a duration such as 20 min, 1:30 or 45 s.</Trans>
            ) : tracker.type === "number" ? (
              <Trans>Enter a number.</Trans>
            ) : (
              <Trans>Choose a value.</Trans>
            )}
          </p>
        ) : null}
      </div>
      {showMore ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-when`}>
              <Trans>Time</Trans>
            </Label>
            <Input
              id={`${id}-when`}
              type="datetime-local"
              value={when}
              max={nowLocalInput()}
              onChange={(event) => setWhen(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor={`${id}-note`}>
              <Trans>Note (optional)</Trans>
            </Label>
            <Textarea
              id={`${id}-note`}
              value={note}
              maxLength={TRACKER_LIMITS.noteLength}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Trans>Saving…</Trans> : <Trans>Log</Trans>}
        </Button>
        {!showMore ? (
          <Button type="button" variant="ghost" onClick={() => setShowMore(true)}>
            <Trans>Time and note</Trans>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
