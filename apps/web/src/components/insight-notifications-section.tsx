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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Label } from "@openvalens/ui/components/label";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { Switch } from "@openvalens/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

/**
 * Issue #92 — insight notification settings. Push and email are off until
 * the person turns them on; only the workspace owner can. Turning the weekly
 * email on requires ticking the disclosure that it contains values and that
 * email is not private. Per-kind × per-channel switches apply from the next
 * delivery run. Nutrition observations are deliberately not listed here: they
 * are opted in only through the dedicated observation card. Same controls and
 * copy as the native settings screen.
 */
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
    <Card role="region" aria-labelledby="insight-notifications-title">
      <CardHeader>
        <CardTitle id="insight-notifications-title">
          {i18n._(INSIGHT_DELIVERY_COPY.settingsTitle)}
        </CardTitle>
        <CardDescription>{i18n._(INSIGHT_DELIVERY_COPY.settingsIntro)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {!canDeliver ? <p className="text-sm">{i18n._(INSIGHT_DELIVERY_COPY.ownerOnly)}</p> : null}

        <fieldset className="grid gap-2" disabled={pending || !canDeliver}>
          <legend className="font-medium">{i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}</legend>
          <p className="text-sm text-muted-foreground">
            {i18n._(INSIGHT_DELIVERY_COPY.pushDescription)}
          </p>
          {!preferences.pushAvailable ? (
            <p className="text-sm">{i18n._(INSIGHT_DELIVERY_COPY.pushUnavailable)}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Switch
                  id="insight-push"
                  checked={preferences.push.enabled}
                  onCheckedChange={(enabled) => onUpdate({ push: { enabled } })}
                />
                <Label htmlFor="insight-push">
                  {preferences.push.enabled ? t`On — ${pushTitle}` : t`Off — ${pushTitle}`}
                </Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="insight-push-topic"
                  checked={preferences.push.showTopic}
                  onCheckedChange={(showTopic) => onUpdate({ push: { showTopic } })}
                />
                <Label htmlFor="insight-push-topic">
                  {i18n._(INSIGHT_DELIVERY_COPY.pushShowTopic)}
                </Label>
              </div>
              {preferences.push.enabled && preferences.push.registeredDevices === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {i18n._(INSIGHT_DELIVERY_COPY.pushNoDevice)}
                </p>
              ) : null}
            </>
          )}
        </fieldset>

        <fieldset className="grid gap-2" disabled={pending || !canDeliver}>
          <legend className="font-medium">{i18n._(INSIGHT_DELIVERY_COPY.emailTitle)}</legend>
          <p className="text-sm text-muted-foreground">
            {i18n._(INSIGHT_DELIVERY_COPY.emailDescription)}
          </p>
          {!preferences.emailAvailable ? (
            <p className="text-sm">{i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}</p>
          ) : preferences.email.enabled ? (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdate({ email: { enabled: false } })}
              >
                <Trans>Turn off the weekly email</Trans>
              </Button>
              <span className="text-sm">
                <Trans>On</Trans>
              </span>
            </div>
          ) : (
            <>
              <p className="text-sm" id="insight-email-disclosure">
                {i18n._(INSIGHT_DELIVERY_COPY.emailDisclosure)}
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={acknowledged}
                  aria-describedby="insight-email-disclosure"
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                {i18n._(INSIGHT_DELIVERY_COPY.emailAcknowledge)}
              </label>
              <div>
                <Button
                  size="sm"
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

        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="font-medium">{i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}</legend>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              {i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}
              <select
                className="rounded-md border border-input bg-background px-2 py-1"
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
            <span>
              {i18n._(INSIGHT_DELIVERY_COPY.timeZone)}: {preferences.timeZone}
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

        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="font-medium">{i18n._(INSIGHT_DELIVERY_COPY.kindsTitle)}</legend>
          <p className="text-sm text-muted-foreground">
            {i18n._(INSIGHT_DELIVERY_COPY.kindsIntro)}
          </p>
          <table className="text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-left font-medium">
                  <Trans>Kind</Trans>
                </th>
                {INSIGHT_CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className="px-2 text-left font-medium">
                    {i18n._(INSIGHT_CHANNEL_LABELS[channel])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GENERIC_DELIVERY_KINDS.map((kind) => (
                <tr key={kind}>
                  <th scope="row" className="py-1 text-left font-normal">
                    {i18n._(INSIGHT_KIND_LABELS[kind])}
                  </th>
                  {INSIGHT_CHANNELS.map((channel) => (
                    <td key={channel} className="px-2">
                      <input
                        type="checkbox"
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
      </CardContent>
    </Card>
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
