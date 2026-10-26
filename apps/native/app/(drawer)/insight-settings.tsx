import { Trans, useLingui } from "@lingui/react/macro";
import {
  EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
  INSIGHT_CHANNELS,
  type InsightPreferencesUpdate,
} from "@openvalens/api/insight-contract";
import {
  GENERIC_DELIVERY_KINDS,
  INSIGHT_CHANNEL_LABELS,
  INSIGHT_DELIVERY_COPY,
  INSIGHT_KIND_LABELS,
} from "@openvalens/api/presenters/insights";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { BellRing, Clock, Mail, Smartphone } from "lucide-react-native";
import { useState } from "react";
import { Switch, Text, View } from "react-native";

import {
  Details,
  ErrorState,
  Page,
  PageHeader,
  Prose,
  Sheet,
  StatusPill,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import { describePushRegistration, enablePushOnThisPhone } from "@/lib/push-notifications";
import { client, orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Issue #92 — insight notification settings on mobile, parity with the web
 * settings card: push (with "show topic"), the weekly email behind its
 * disclosure, daily reminders by email (its own opt-in, off by default), the
 * earliest delivery hour, and per-kind × per-channel switches.
 * Push and email stay off until turned on, and only the workspace owner can.
 * Nutrition observations are excluded from the kind matrix: they are opted in
 * only through the dedicated observation card, not per delivery channel.
 */

function Toggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const signal = useThemeColor("signal");
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <Text className="flex-1 font-sans text-sm text-ink-2">{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        trackColor={{ true: signal }}
      />
    </View>
  );
}

/** An hour of the day, one step earlier or later, with the time set as a figure. */
function HourStepper({
  hour,
  label,
  disabled,
  onChange,
}: {
  hour: number;
  label: string;
  disabled: boolean;
  onChange: (hour: number) => void;
}) {
  const { t } = useLingui();
  return (
    <View className="flex-row items-center gap-4">
      <Button
        size="sm"
        variant="outline"
        isDisabled={disabled || hour === 0}
        accessibilityLabel={t`Earlier`}
        onPress={() => onChange(hour - 1)}
      >
        <Button.Label>−</Button.Label>
      </Button>
      <Text
        className="font-display text-2xl font-medium text-ink"
        style={{ fontVariant: ["tabular-nums"] }}
        accessibilityLabel={`${label} ${hour}:00`}
      >
        {String(hour).padStart(2, "0")}:00
      </Text>
      <Button
        size="sm"
        variant="outline"
        isDisabled={disabled || hour === 23}
        accessibilityLabel={t`Later`}
        onPress={() => onChange(hour + 1)}
      >
        <Button.Label>+</Button.Label>
      </Button>
    </View>
  );
}

export default function InsightSettingsScreen() {
  const queryClient = useQueryClient();
  const preferences = useQuery(orpc.insights.preferences.get.queryOptions({ input: {} }));
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { t, i18n } = useLingui();
  const update = useMutation({
    mutationFn: (patch: InsightPreferencesUpdate) => client.insights.preferences.update(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() }),
    onError: () => setMessage(t`Could not update notification settings.`),
  });
  const enablePush = useMutation({
    mutationFn: async () => {
      const registration = await enablePushOnThisPhone();
      await client.insights.preferences.update({ push: { enabled: true } });
      return i18n._(describePushRegistration(registration));
    },
    onSuccess: (text) => {
      setMessage(text);
      void queryClient.invalidateQueries({ queryKey: orpc.insights.key() });
    },
    onError: () => setMessage(t`Could not turn on notifications.`),
  });

  if (preferences.isPending)
    return (
      <Container>
        <Page>
          <PageHeader title={i18n._(INSIGHT_DELIVERY_COPY.settingsTitle)} />
          <Sheet className="h-48" />
        </Page>
      </Container>
    );
  if (preferences.isError || !preferences.data)
    return (
      <Container>
        <Page>
          <PageHeader title={i18n._(INSIGHT_DELIVERY_COPY.settingsTitle)} />
          <ErrorState
            title={<Trans>Could not load notification settings.</Trans>}
            action={
              <Button variant="outline" size="sm" onPress={() => void preferences.refetch()}>
                <Button.Label>
                  <Trans>Retry</Trans>
                </Button.Label>
              </Button>
            }
          />
        </Page>
      </Container>
    );

  const prefs = preferences.data;
  const busy = update.isPending || enablePush.isPending;
  const canDeliver = prefs.canConfigureDelivery;
  const ack =
    acknowledged || prefs.email.acknowledgedVersion === EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const timeZoneNote = (
    <View className="gap-2">
      <Text className="font-sans text-sm text-ink-3">
        {i18n._(INSIGHT_DELIVERY_COPY.timeZone)}: {prefs.timeZone}
      </Text>
      {zone && zone !== prefs.timeZone ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          isDisabled={busy}
          onPress={() => update.mutate({ timeZone: zone })}
        >
          <Button.Label>
            <Trans>Use {zone}</Trans>
          </Button.Label>
        </Button>
      ) : null}
    </View>
  );

  return (
    <Container>
      <Page>
        <PageHeader
          title={i18n._(INSIGHT_DELIVERY_COPY.settingsTitle)}
          info={i18n._(INSIGHT_DELIVERY_COPY.settingsIntro)}
        />

        <SettingsGroup>
          {!canDeliver ? (
            <Text className="py-4 font-sans text-sm text-ink-2">
              {i18n._(INSIGHT_DELIVERY_COPY.ownerOnly)}
            </Text>
          ) : null}

          <SettingsRow
            icon={Smartphone}
            label={i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}
            info={i18n._(INSIGHT_DELIVERY_COPY.pushDescription)}
            divider={!canDeliver}
            trailing={
              prefs.pushAvailable ? (
                <StatusPill tone={prefs.push.enabled ? "good" : "neutral"}>
                  {prefs.push.enabled ? t`On` : t`Off`}
                </StatusPill>
              ) : undefined
            }
          >
            {!prefs.pushAvailable ? (
              <Text className="font-sans text-sm text-ink-2">
                {i18n._(INSIGHT_DELIVERY_COPY.pushUnavailable)}
              </Text>
            ) : (
              <View>
                <Toggle
                  label={i18n._(INSIGHT_DELIVERY_COPY.pushTitle)}
                  value={prefs.push.enabled}
                  disabled={busy || !canDeliver}
                  onChange={(enabled) =>
                    enabled ? enablePush.mutate() : update.mutate({ push: { enabled: false } })
                  }
                />
                <Toggle
                  label={i18n._(INSIGHT_DELIVERY_COPY.pushShowTopic)}
                  value={prefs.push.showTopic}
                  disabled={busy || !canDeliver}
                  onChange={(showTopic) => update.mutate({ push: { showTopic } })}
                />
                {prefs.push.enabled && prefs.push.registeredDevices === 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1 self-start"
                    onPress={() => enablePush.mutate()}
                    isDisabled={busy}
                  >
                    <Button.Label>
                      <Trans>Allow notifications on this phone</Trans>
                    </Button.Label>
                  </Button>
                ) : null}
              </View>
            )}
          </SettingsRow>

          <SettingsRow
            icon={Mail}
            label={i18n._(INSIGHT_DELIVERY_COPY.emailTitle)}
            info={i18n._(INSIGHT_DELIVERY_COPY.emailDescription)}
            divider
            trailing={
              prefs.emailAvailable && prefs.email.enabled ? (
                <StatusPill tone="good">{t`On`}</StatusPill>
              ) : undefined
            }
          >
            {!prefs.emailAvailable ? (
              <Text className="font-sans text-sm text-ink-2">
                {i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}
              </Text>
            ) : prefs.email.enabled ? (
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                isDisabled={busy || !canDeliver}
                onPress={() => update.mutate({ email: { enabled: false } })}
              >
                <Button.Label>
                  <Trans>Turn off the weekly email</Trans>
                </Button.Label>
              </Button>
            ) : (
              <View className="gap-2">
                <Text className="font-sans text-sm leading-relaxed text-ink-3">
                  {i18n._(INSIGHT_DELIVERY_COPY.emailDisclosure)}
                </Text>
                <Toggle
                  label={i18n._(INSIGHT_DELIVERY_COPY.emailAcknowledge)}
                  value={ack}
                  disabled={busy || !canDeliver}
                  onChange={setAcknowledged}
                />
                <Button
                  size="sm"
                  className="self-start"
                  isDisabled={busy || !canDeliver || !ack}
                  onPress={() =>
                    update.mutate({
                      email: {
                        enabled: true,
                        acknowledgement: EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION,
                      },
                    })
                  }
                >
                  <Button.Label>
                    <Trans>Turn on the weekly email</Trans>
                  </Button.Label>
                </Button>
              </View>
            )}
          </SettingsRow>

          <SettingsRow
            icon={BellRing}
            label={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTitle)}
            info={
              <>
                <Prose>{i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmailNote)}</Prose>
                <Prose>{i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersTelegram)}</Prose>
              </>
            }
            divider
          >
            {!prefs.emailAvailable ? (
              <Text className="font-sans text-sm text-ink-2">
                {i18n._(INSIGHT_DELIVERY_COPY.emailUnavailable)}
              </Text>
            ) : (
              <Toggle
                label={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersEmail)}
                value={prefs.dailyReminders.email}
                disabled={busy}
                onChange={(email) => update.mutate({ dailyReminders: { email } })}
              />
            )}
            {prefs.dailyReminders.email || prefs.dailyReminders.telegramConnected ? (
              <View className="gap-3 rounded-2xl bg-paper-2 p-3">
                <Text className="font-sans text-sm font-medium text-ink-2">
                  {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHour)}
                </Text>
                <HourStepper
                  hour={prefs.dailyReminders.hour}
                  label={i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHour)}
                  disabled={busy}
                  onChange={(hour) => update.mutate({ dailyReminders: { hour } })}
                />
                {timeZoneNote}
                <Text className="font-sans text-sm text-ink-3">
                  {i18n._(INSIGHT_DELIVERY_COPY.dailyRemindersHourNote)}
                </Text>
              </View>
            ) : null}
          </SettingsRow>

          <SettingsRow icon={Clock} label={i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)} divider>
            <HourStepper
              hour={prefs.deliveryHour}
              label={i18n._(INSIGHT_DELIVERY_COPY.deliveryHour)}
              disabled={busy}
              onChange={(deliveryHour) => update.mutate({ deliveryHour })}
            />
            {timeZoneNote}
          </SettingsRow>

          <View className="border-t border-rule py-3">
            <Details summary={i18n._(INSIGHT_DELIVERY_COPY.kindsTitle)}>
              <View className="gap-3">
                <Text className="font-sans text-sm text-ink-3">
                  {i18n._(INSIGHT_DELIVERY_COPY.kindsIntro)}
                </Text>
                {GENERIC_DELIVERY_KINDS.map((kind) => (
                  <View key={kind} className="gap-1 border-t border-rule pt-2">
                    <Text className="font-sans text-sm font-semibold text-ink">
                      {i18n._(INSIGHT_KIND_LABELS[kind])}
                    </Text>
                    {INSIGHT_CHANNELS.map((channel) => (
                      <Toggle
                        key={channel}
                        label={`${i18n._(INSIGHT_KIND_LABELS[kind])}, ${i18n._(INSIGHT_CHANNEL_LABELS[channel])}`}
                        value={prefs.channels[kind][channel]}
                        disabled={busy}
                        onChange={(value) =>
                          update.mutate({ channels: { [kind]: { [channel]: value } } })
                        }
                      />
                    ))}
                  </View>
                ))}
              </View>
            </Details>
          </View>
        </SettingsGroup>

        {message ? (
          <Text className="font-sans text-sm text-ink-2" accessibilityRole="alert">
            {message}
          </Text>
        ) : null}
      </Page>
    </Container>
  );
}
