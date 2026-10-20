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
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { describePushRegistration, enablePushOnThisPhone } from "@/lib/push-notifications";
import { client, orpc } from "@/utils/orpc";

/**
 * Issue #92 — insight notification settings on mobile, parity with the web
 * settings card: push (with "show topic"), the weekly email behind its
 * disclosure, the earliest delivery hour, and per-kind × per-channel switches.
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
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-sm text-foreground">{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
      />
    </View>
  );
}

export default function InsightSettingsScreen() {
  const queryClient = useQueryClient();
  const preferences = useQuery(orpc.insights.preferences.get.queryOptions({ input: {} }));
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (patch: InsightPreferencesUpdate) => client.insights.preferences.update(patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.insights.key() }),
    onError: () => setMessage("Could not update notification settings."),
  });
  const enablePush = useMutation({
    mutationFn: async () => {
      const registration = await enablePushOnThisPhone();
      await client.insights.preferences.update({ push: { enabled: true } });
      return describePushRegistration(registration);
    },
    onSuccess: (text) => {
      setMessage(text);
      void queryClient.invalidateQueries({ queryKey: orpc.insights.key() });
    },
    onError: () => setMessage("Could not turn on notifications."),
  });

  if (preferences.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );
  if (preferences.isError || !preferences.data)
    return (
      <Container className="items-center justify-center gap-3 p-6" isScrollable={false}>
        <Text className="text-base text-foreground">Could not load notification settings.</Text>
        <Pressable
          onPress={() => void preferences.refetch()}
          accessibilityRole="button"
          className="min-h-11 justify-center px-4"
        >
          <Text className="font-medium text-foreground underline">Retry</Text>
        </Pressable>
      </Container>
    );

  const prefs = preferences.data;
  const busy = update.isPending || enablePush.isPending;
  const canDeliver = prefs.canConfigureDelivery;
  const ack =
    acknowledged || prefs.email.acknowledgedVersion === EMAIL_DIGEST_ACKNOWLEDGEMENT_VERSION;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Container>
      <View className="gap-6 p-4">
        <View className="gap-1">
          <Text className="font-mono text-2xl text-foreground">
            {INSIGHT_DELIVERY_COPY.settingsTitle}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {INSIGHT_DELIVERY_COPY.settingsIntro}
          </Text>
          {!canDeliver ? (
            <Text className="text-sm text-foreground">{INSIGHT_DELIVERY_COPY.ownerOnly}</Text>
          ) : null}
        </View>

        <CardStack title={INSIGHT_DELIVERY_COPY.pushTitle}>
          <Card variant="secondary" className="gap-2 p-4">
            <Text className="text-sm text-muted-foreground">
              {INSIGHT_DELIVERY_COPY.pushDescription}
            </Text>
            {!prefs.pushAvailable ? (
              <Text className="text-sm text-foreground">
                {INSIGHT_DELIVERY_COPY.pushUnavailable}
              </Text>
            ) : (
              <>
                <Toggle
                  label={INSIGHT_DELIVERY_COPY.pushTitle}
                  value={prefs.push.enabled}
                  disabled={busy || !canDeliver}
                  onChange={(enabled) =>
                    enabled ? enablePush.mutate() : update.mutate({ push: { enabled: false } })
                  }
                />
                <Toggle
                  label={INSIGHT_DELIVERY_COPY.pushShowTopic}
                  value={prefs.push.showTopic}
                  disabled={busy || !canDeliver}
                  onChange={(showTopic) => update.mutate({ push: { showTopic } })}
                />
                {prefs.push.enabled && prefs.push.registeredDevices === 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => enablePush.mutate()}
                    isDisabled={busy}
                  >
                    <Button.Label>Allow notifications on this phone</Button.Label>
                  </Button>
                ) : null}
              </>
            )}
          </Card>
        </CardStack>

        <CardStack title={INSIGHT_DELIVERY_COPY.emailTitle}>
          <Card variant="secondary" className="gap-2 p-4">
            <Text className="text-sm text-muted-foreground">
              {INSIGHT_DELIVERY_COPY.emailDescription}
            </Text>
            {!prefs.emailAvailable ? (
              <Text className="text-sm text-foreground">
                {INSIGHT_DELIVERY_COPY.emailUnavailable}
              </Text>
            ) : prefs.email.enabled ? (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy || !canDeliver}
                onPress={() => update.mutate({ email: { enabled: false } })}
              >
                <Button.Label>Turn off the weekly email</Button.Label>
              </Button>
            ) : (
              <>
                <Text className="text-sm text-foreground">
                  {INSIGHT_DELIVERY_COPY.emailDisclosure}
                </Text>
                <Toggle
                  label={INSIGHT_DELIVERY_COPY.emailAcknowledge}
                  value={ack}
                  disabled={busy || !canDeliver}
                  onChange={setAcknowledged}
                />
                <Button
                  size="sm"
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
                  <Button.Label>Turn on the weekly email</Button.Label>
                </Button>
              </>
            )}
          </Card>
        </CardStack>

        <CardStack title={INSIGHT_DELIVERY_COPY.deliveryHour}>
          <Card variant="secondary" className="gap-2 p-4">
            <View className="flex-row items-center justify-between">
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy || prefs.deliveryHour === 0}
                accessibilityLabel="Earlier"
                onPress={() => update.mutate({ deliveryHour: prefs.deliveryHour - 1 })}
              >
                <Button.Label>−</Button.Label>
              </Button>
              <Text
                className="font-mono text-lg text-foreground"
                accessibilityLabel={`${INSIGHT_DELIVERY_COPY.deliveryHour} ${prefs.deliveryHour}:00`}
              >
                {String(prefs.deliveryHour).padStart(2, "0")}:00
              </Text>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy || prefs.deliveryHour === 23}
                accessibilityLabel="Later"
                onPress={() => update.mutate({ deliveryHour: prefs.deliveryHour + 1 })}
              >
                <Button.Label>+</Button.Label>
              </Button>
            </View>
            <Text className="text-sm text-muted-foreground">
              {INSIGHT_DELIVERY_COPY.timeZone}: {prefs.timeZone}
            </Text>
            {zone && zone !== prefs.timeZone ? (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={busy}
                onPress={() => update.mutate({ timeZone: zone })}
              >
                <Button.Label>Use {zone}</Button.Label>
              </Button>
            ) : null}
          </Card>
        </CardStack>

        <CardStack title={INSIGHT_DELIVERY_COPY.kindsTitle}>
          <Card variant="secondary" className="gap-3 p-4">
            <Text className="text-sm text-muted-foreground">
              {INSIGHT_DELIVERY_COPY.kindsIntro}
            </Text>
            {GENERIC_DELIVERY_KINDS.map((kind) => (
              <View key={kind} className="gap-1 border-t border-border pt-2">
                <Text className="text-sm font-medium text-foreground">
                  {INSIGHT_KIND_LABELS[kind]}
                </Text>
                {INSIGHT_CHANNELS.map((channel) => (
                  <Toggle
                    key={channel}
                    label={`${INSIGHT_KIND_LABELS[kind]} — ${INSIGHT_CHANNEL_LABELS[channel]}`}
                    value={prefs.channels[kind][channel]}
                    disabled={busy}
                    onChange={(value) =>
                      update.mutate({ channels: { [kind]: { [channel]: value } } })
                    }
                  />
                ))}
              </View>
            ))}
          </Card>
        </CardStack>

        {message ? (
          <Text className="text-sm text-foreground" accessibilityRole="alert">
            {message}
          </Text>
        ) : null}
      </View>
    </Container>
  );
}
