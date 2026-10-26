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
import { Bell, BellRing, Clock, type LucideIcon, Mail, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Details, ErrorState, InfoTip, StatusPill, ToneIcon } from "@/components/page";
import { SETTINGS_SELECT, SettingsGroup, SettingsIcon } from "@/components/settings-rows";
import { orpc } from "@/utils/orpc";

/** A fieldset as one settings row: icon and legend (with an ⓘ), then its controls. */
function SettingsFieldset({
  icon,
  legend,
  info,
  disabled,
  children,
}: {
  icon: LucideIcon;
  legend: ReactNode;
  info?: ReactNode;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="grid min-w-0 gap-3 py-4" disabled={disabled}>
      <legend className="float-left flex w-full items-center gap-3 pb-1">
        <SettingsIcon icon={icon} />
        <span className="font-medium text-ink">{legend}</span>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </legend>
      <div className="clear-left grid min-w-0 gap-3 sm:pl-13">{children}</div>
    </fieldset>
  );
}

function TimeZoneNote({
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
    <>
      <span className="text-ink-3">
        {i18n._(INSIGHT_DELIVERY_COPY.timeZone)}:{" "}
        <span className="text-ink">{preferences.timeZone}</span>
      </span>
      {browserZone && browserZone !== preferences.timeZone ? (
        <Button size="sm" variant="outline" onClick={() => onUpdate({ timeZone: browserZone })}>
          <Trans>Use {browserZone}</Trans>
        </Button>
      ) : null}
    </>
  );
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

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
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2 text-ink-2">
        {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHour)}
        <select
          className={SETTINGS_SELECT}
          aria-describedby="daily-reminder-hour-note"
          value={preferences.dailyReminders.hour}
          onChange={(event) => onUpdate({ dailyReminders: { hour: Number(event.target.value) } })}
        >
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {String(hour).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </label>
      <InfoTip>
        <p id="daily-reminder-hour-note">{i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHourNote)}</p>
      </InfoTip>
      <TimeZoneNote preferences={preferences} browserZone={browserZone} onUpdate={onUpdate} />
    </div>
  );
}

/** A switch with its label on the left, the control on the right. */
function SwitchLine({ children }: { children: ReactNode }) {
  return <div className="flex min-h-10 items-center justify-between gap-4">{children}</div>;
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
      className="grid min-w-0 content-start gap-3"
    >
      <div className="flex items-center gap-2">
        <ToneIcon icon={Bell} tone="signal" size="sm" />
        <h2 id="insight-notifications-title" className="text-xl leading-tight text-ink">
          {i18n._(INSIGHT_DELIVERY_COPY.settingsTitle)}
        </h2>
        <InfoTip>{i18n._(INSIGHT_DELIVERY_COPY.settingsIntro)}</InfoTip>
      </div>
      <SettingsGroup>
        {!canDeliver ? (
          <p className="py-4 text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.ownerOnly)}</p>
        ) : null}

        <SettingsFieldset
          icon={Smartphone}
          legend={i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}
          info={i18n._(INSIGHT_DELIVERY_COPY.pushDescription)}
          disabled={pending || !canDeliver}
        >
          {!preferences.pushAvailable ? (
            <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.pushUnavailable)}</p>
          ) : (
            <>
              <SwitchLine>
                <span className="flex items-center gap-2">
                  <Label htmlFor="insight-push" className="text-ink-2">
                    {pushTitle}
                  </Label>
                  <StatusPill tone={preferences.push.enabled ? "good" : "neutral"}>
                    {preferences.push.enabled ? t`On` : t`Off`}
                  </StatusPill>
                </span>
                <Switch
                  id="insight-push"
                  checked={preferences.push.enabled}
                  onCheckedChange={(enabled) => onUpdate({ push: { enabled } })}
                />
              </SwitchLine>
              <SwitchLine>
                <Label htmlFor="insight-push-topic" className="text-ink-2">
                  {i18n._(INSIGHT_DELIVERY_COPY.pushShowTopic)}
                </Label>
                <Switch
                  id="insight-push-topic"
                  checked={preferences.push.showTopic}
                  onCheckedChange={(showTopic) => onUpdate({ push: { showTopic } })}
                />
              </SwitchLine>
              {preferences.push.enabled && preferences.push.registeredDevices === 0 ? (
                <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.pushNoDevice)}</p>
              ) : null}
            </>
          )}
        </SettingsFieldset>

        <SettingsFieldset
          icon={Mail}
          legend={i18n._(INSIGHT_DELIVERY_COPY.emailTitle)}
          info={i18n._(INSIGHT_DELIVERY_COPY.emailDescription)}
          disabled={pending || !canDeliver}
        >
          {!preferences.emailAvailable ? (
            <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}</p>
          ) : preferences.email.enabled ? (
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone="good">
                <Trans>On</Trans>
              </StatusPill>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate({ email: { enabled: false } })}
              >
                <Trans>Turn off the weekly email</Trans>
              </Button>
            </div>
          ) : (
            <>
              <p className="max-w-[60ch] text-sm text-ink-3" id="insight-email-disclosure">
                {i18n._(INSIGHT_DELIVERY_COPY.emailDisclosure)}
              </p>
              <label className="flex items-start gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
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
        </SettingsFieldset>

        <SettingsFieldset
          icon={BellRing}
          legend={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTitle)}
          info={
            <>
              <p id="daily-reminder-email-note">
                {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmailNote)}
              </p>
              <p>{i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTelegram)}</p>
            </>
          }
          disabled={pending}
        >
          {!preferences.emailAvailable ? (
            <p className="text-sm text-ink-2">{i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}</p>
          ) : (
            <SwitchLine>
              <Label htmlFor="daily-reminder-email" className="text-ink-2">
                {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmail)}
              </Label>
              <Switch
                id="daily-reminder-email"
                checked={preferences.dailyReminders.email}
                aria-describedby="daily-reminder-email-note"
                onCheckedChange={(email) => onUpdate({ dailyReminders: { email } })}
              />
            </SwitchLine>
          )}
          {preferences.dailyReminders.email || preferences.dailyReminders.telegramConnected ? (
            <DailyReminderTime
              preferences={preferences}
              browserZone={browserZone}
              onUpdate={onUpdate}
            />
          ) : null}
        </SettingsFieldset>

        <SettingsFieldset
          icon={Clock}
          legend={i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}
          disabled={pending}
        >
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-ink-2">
              <span className="sr-only">{i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}</span>
              <select
                className={SETTINGS_SELECT}
                value={preferences.deliveryHour}
                onChange={(event) => onUpdate({ deliveryHour: Number(event.target.value) })}
              >
                {HOURS.map((hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </label>
            <TimeZoneNote preferences={preferences} browserZone={browserZone} onUpdate={onUpdate} />
          </div>
        </SettingsFieldset>

        <div className="py-3">
          <Details summary={i18n._(INSIGHT_DELIVERY_COPY.kindsTitle)}>
            <fieldset className="grid min-w-0 gap-3" disabled={pending}>
              <legend className="sr-only">{i18n._(INSIGHT_DELIVERY_COPY.kindsTitle)}</legend>
              <p className="text-sm text-ink-3">{i18n._(INSIGHT_DELIVERY_COPY.kindsIntro)}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule">
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
                              aria-label={`${i18n._(INSIGHT_KIND_LABELS[kind])}, ${i18n._(INSIGHT_CHANNEL_LABELS[channel])}`}
                              checked={preferences.channels[kind][channel]}
                              onChange={(event) =>
                                onUpdate({
                                  channels: { [kind]: { [channel]: event.target.checked } },
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
          </Details>
        </div>
      </SettingsGroup>
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
  if (preferences.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (preferences.isError || !preferences.data) {
    return (
      <ErrorState
        title={<Trans>Could not load your notification settings.</Trans>}
        action={
          <Button variant="outline" onClick={() => void preferences.refetch()}>
            <Trans>Retry</Trans>
          </Button>
        }
      />
    );
  }
  return (
    <InsightNotificationsForm
      preferences={preferences.data}
      pending={update.isPending}
      onUpdate={(patch) => update.mutate(patch)}
    />
  );
}
