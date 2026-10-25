import { Trans, useLingui } from "@lingui/react/macro";
import {
  EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
  INSIGHT_CHANNELS,
  type InsightPreferences,
  type InsightPreferencesUpdate,
} from "@openvalens/api/insight-contract";
import {
  GENERIC_DELIVERY_KINDS,
  INSIGHT_CHANNEL_LABELS,
  INSIGHT_DELIVERY_COPY,
  INSIGHT_KIND_LABELS,
} from "@openvalens/api/presenters/insights";
import { Button } from "@openvalens/ui/components/button";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

const SELECT =
  "h-9 rounded-sm border border-input bg-card px-2 text-sm text-ink outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55";

/**
 * Issue #92 — insight notification settings. Push and email are off until
 * the person turns them on; only the workspace owner can. Turning the weekly
 * email on requires ticking the disclosure that it contains values and that
 * email is not private. Per-kind × per-channel switches apply from the next
 * delivery run. Nutrition observations are deliberately not listed here: they
 * are opted in only through the dedicated observation card. Daily
 * supplement/medication/event reminders by email have their own switch, off
 * by default and open to every member (they are the member's own items).
 * Same controls and copy as the native settings screen.
 */
/**
 * When the day's reminders go out: the member's own local hour, in the same
 * time zone as the insight settings (shown, and switchable to this browser's
 * zone the same way).
 */
function DailyReminderTime({
  preferences,
  browserZone,
  onUpdate,
}: {
  preferences: InsightPreferences;
  browserZone: string | undefined;
  onUpdate: (patch: InsightPreferencesUpdate) => void;
}) {
  const { i18n } = useLingui();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-ink-3">
          {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHour)}
          <select
            className={SELECT}
            aria-describedby="daily-reminder-hour-note"
            value={preferences.dailyReminders.hour}
            onChange={(event) => onUpdate({ dailyReminders: { hour: Number(event.target.value) } })}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <span className="text-ink-3">
          {i18n._(INSIGHT_DELIVERY_COPY.timeZone)}:{" "}
          <span className="text-ink">{preferences.timeZone}</span>
        </span>
        {browserZone && browserZone !== preferences.timeZone ? (
          <Button size="sm" variant="outline" onClick={() => onUpdate({ timeZone: browserZone })}>
            <Trans>Use {browserZone}</Trans>
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-ink-3" id="daily-reminder-hour-note">
        {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHourNote)}
      </p>
    </div>
  );
}

export function InsightNotificationsForm({
  preferences,
  pending,
  onUpdate,
}: {
  preferences: InsightPreferences;
  pending: boolean;
  onUpdate: (patch: InsightPreferencesUpdate) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(
    preferences.email.acknowledgedVersion === EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
  );
  const canDeliver = preferences.canConfigureDelivery;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { t, i18n } = useLingui();
  const pushTitle = i18n._(INSIGHT_DELIVERY_COPY.pushTitle);

  return (
    <section
      role="region"
      aria-labelledby="insight-notifications-title"
      className="grid min-w-0 content-start gap-4"
    >
      <div className="grid min-w-0 gap-1">
        <h2 id="insight-notifications-title" className="text-xl leading-tight text-ink">
          {i18n._(INSIGHT_DELIVERY_COPY.settingsTitle)}
        </h2>
        <p className="max-w-[65ch] text-sm text-ink-3">
          {i18n._(INSIGHT_DELIVERY_COPY.settingsIntro)}
        </p>
      </div>
      <div className="sheet grid divide-y divide-rule px-5 [&>*]:py-5">
        {!canDeliver ? (
          <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.ownerOnly)}</p>
        ) : null}

        <fieldset className="grid min-w-0 gap-3" disabled={pending || !canDeliver}>
          <legend className="mb-1 font-display font-medium text-ink">
            {i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}
          </legend>
          <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.pushDescription)}</p>
          {!preferences.pushAvailable ? (
            <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.pushUnavailable)}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Switch
                  id="insight-push"
                  checked={preferences.push.enabled}
                  onCheckedChange={(enabled) => onUpdate({ push: { enabled } })}
                />
                <Label htmlFor="insight-push" className="text-ink">
                  {pushTitle}
                </Label>
                <span className="text-sm text-ink-3">
                  {preferences.push.enabled ? t`On` : t`Off`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="insight-push-topic"
                  checked={preferences.push.showTopic}
                  onCheckedChange={(showTopic) => onUpdate({ push: { showTopic } })}
                />
                <Label htmlFor="insight-push-topic" className="text-ink">
                  {i18n._(INSIGHT_DELIVERY_COPY.pushShowTopic)}
                </Label>
              </div>
              {preferences.push.enabled && preferences.push.registeredDevices === 0 ? (
                <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.pushNoDevice)}</p>
              ) : null}
            </>
          )}
        </fieldset>

        <fieldset className="grid min-w-0 gap-3" disabled={pending || !canDeliver}>
          <legend className="mb-1 font-display font-medium text-ink">
            {i18n._(INSIGHT_DELIVERY_COPY.emailTitle)}
          </legend>
          <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.emailDescription)}</p>
          {!preferences.emailAvailable ? (
            <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}</p>
          ) : preferences.email.enabled ? (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate({ email: { enabled: false } })}
              >
                <Trans>Turn off the weekly email</Trans>
              </Button>
              <span className="text-sm font-medium text-success">
                <Trans>On</Trans>
              </span>
            </div>
          ) : (
            <>
              <p className="max-w-[65ch] text-sm text-ink-2" id="insight-email-disclosure">
                {i18n._(INSIGHT_DELIVERY_COPY.emailDisclosure)}
              </p>
              <label className="flex items-start gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
                  checked={acknowledged}
                  aria-describedby="insight-email-disclosure"
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                {i18n._(INSIGHT_DELIVERY_COPY.emailAcknowledge)}
              </label>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!acknowledged}
                  onClick={() =>
                    onUpdate({
                      email: {
                        enabled: true,
                        acknowledgement: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
                      },
                    })
                  }
                >
                  <Trans>Turn on the weekly email</Trans>
                </Button>
              </div>
            </>
          )}
        </fieldset>

        <fieldset className="grid min-w-0 gap-3" disabled={pending}>
          <legend className="mb-1 font-display font-medium text-ink">
            {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTitle)}
          </legend>
          {!preferences.emailAvailable ? (
            <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}</p>
          ) : (
            <div className="flex items-center gap-3">
              <Switch
                id="daily-reminder-email"
                checked={preferences.dailyReminders.email}
                aria-describedby="daily-reminder-email-note"
                onCheckedChange={(email) => onUpdate({ dailyReminders: { email } })}
              />
              <Label htmlFor="daily-reminder-email" className="text-ink">
                {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmail)}
              </Label>
            </div>
          )}
          <p className="text-sm text-ink-3" id="daily-reminder-email-note">
            {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmailNote)}
          </p>
          <p className="text-sm text-ink-3">
            {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTelegram)}
          </p>
          {preferences.dailyReminders.email || preferences.dailyReminders.telegramConnected ? (
            <DailyReminderTime
              preferences={preferences}
              browserZone={browserZone}
              onUpdate={onUpdate}
            />
          ) : null}
        </fieldset>

        <fieldset className="grid min-w-0 gap-3" disabled={pending}>
          <legend className="mb-1 font-display font-medium text-ink">
            {i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}
          </legend>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-ink-3">
              {i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}
              <select
                className={SELECT}
                value={preferences.deliveryHour}
                onChange={(event) => onUpdate({ deliveryHour: Number(event.target.value) })}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <span className="text-ink-3">
              {i18n._(INSIGHT_DELIVERY_COPY.timeZone)}:{" "}
              <span className="text-ink">{preferences.timeZone}</span>
            </span>
            {browserZone && browserZone !== preferences.timeZone ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate({ timeZone: browserZone })}
              >
                <Trans>Use {browserZone}</Trans>
              </Button>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="grid min-w-0 gap-3" disabled={pending}>
          <legend className="mb-1 font-display font-medium text-ink">
            {i18n._(INSIGHT_DELIVERY_COPY.kindsTitle)}
          </legend>
          <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.kindsIntro)}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-rule-2">
                <th scope="col" className="pb-2 text-left font-medium text-ink-3">
                  <Trans>Kind</Trans>
                </th>
                {INSIGHT_CHANNELS.map((channel) => (
                  <th
                    key={channel}
                    scope="col"
                    className="px-2 pb-2 text-left font-medium text-ink-3"
                  >
                    {i18n._(INSIGHT_CHANNEL_LABELS[channel])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {GENERIC_DELIVERY_KINDS.map((kind) => (
                <tr key={kind}>
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
                    {i18n._(INSIGHT_KIND_LABELS[kind])}
                  </th>
                  {INSIGHT_CHANNELS.map((channel) => (
                    <td key={channel} className="px-2 py-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={`${i18n._(INSIGHT_KIND_LABELS[kind])} — ${i18n._(INSIGHT_CHANNEL_LABELS[channel])}`}
                        checked={preferences.channels[kind][channel]}
                        onChange={(event) =>
                          onUpdate({ channels: { [kind]: { [channel]: event.target.checked } } })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      </div>
    </section>
  );
}

export function InsightNotificationsSection() {
  const queryClient = useQueryClient();
  const { t } = useLingui();
  const preferences = useQuery(orpc.insights.preferences.get.queryOptions({ input: {} }));
  const update = useMutation(
    orpc.insights.preferences.update.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() }),
      onError: () => toast.error(t`Could not update notification settings.`),
    }),
  );
  if (preferences.isPending) return <Skeleton className="h-48 w-full" />;
  if (preferences.isError || !preferences.data) return null;
  return (
    <InsightNotificationsForm
      preferences={preferences.data}
      pending={update.isPending}
      onUpdate={(patch) => update.mutate(patch)}
    />
  );
}
