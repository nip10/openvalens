import { Trans, useLingui } from "@lingui/react/macro";
import {
  MANUAL_SLEEP_DUPLICATE_NOTE,
  SLEEP_QUALITY_LABELS,
} from "@openvalens/api/presenters/manual-sleep";
import type { ProductDisplaySettings } from "@openvalens/api/presenters/product-formatting";
import { formatClockTime, formatSleepDuration } from "@openvalens/api/presenters/sleep";
import { Button } from "@openvalens/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import { Details, StatusPill } from "@/components/page";
import { friendlyDate } from "@/utils/friendly";
import { orpc } from "@/utils/orpc";

/**
 * Nights the member typed in (#440), with a way to remove one. A night is
 * logged from the "+" (the quick log's sleep form); this list shows and
 * removes them. A typed-in night is kept apart from device sleep: when they
 * overlap it is marked "Possible duplicate" and the device night counts in the
 * totals.
 */
export function ManualSleepNights({ settings }: { settings?: ProductDisplaySettings | null }) {
  const { t, i18n } = useLingui();
  const queryClient = useQueryClient();
  const sessions = useQuery(orpc.sleep.manualSessions.queryOptions({ input: { days: 30 } }));
  const remove = useMutation(
    orpc.sleep.deleteManualSession.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.sleep.key() }),
    }),
  );

  if (!sessions.data || sessions.data.length === 0) return null;
  return (
    <Details summary={<Trans>Nights you added</Trans>}>
      <div className="sheet grid gap-2 p-5">
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
                  <span className="num font-semibold text-ink">{formatSleepDuration(minutes)}</span>
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
    </Details>
  );
}
