import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "heroui-native";
import { useFocusEffect } from "expo-router";
import { ChartNoAxesColumn, ChartPie } from "lucide-react-native";
import { Switch, Text, View } from "react-native";

import { useAnalyticsConsent } from "@openvalens/ui/hooks/use-analytics-consent";

import { Section } from "@/components/bloom";
import { SettingsGroup, SettingsRow } from "@/components/language-section";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

const analyticsApi = client.analytics;

export function AnalyticsConsentSection() {
  const { data: auth, isPending } = authClient.useSession();
  const user = auth?.user?.id;
  const org = auth?.session.activeOrganizationId;
  const scope = useMemo(
    () => (!isPending && user && org ? JSON.stringify([user, org]) : ""),
    [isPending, user, org],
  );
  const [focused, setFocused] = useState(false);
  const consent = useAnalyticsConsent({
    api: analyticsApi,
    scope,
    ownerId: user ?? "",
    active: false,
  });
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      consent.activate();
      return () => {
        consent.deactivate();
        setFocused(false);
      };
    }, [consent.activate, consent.deactivate]),
  );
  useEffect(() => {
    if (focused && scope) consent.activate();
  }, [focused, scope, consent.activate]);
  const { preference, pending, error, gate, locallyRevoked } = consent;
  const busy = pending !== null;
  const checked = preference?.enabled === true && !locallyRevoked;
  const { t } = useLingui();
  const signal = useThemeColor("signal");
  const stoppedLocally = t({
    message: "Stopped locally; server change unconfirmed. Retry turning it off.",
    comment: "safety",
  });
  const shareLabel = t({ message: "Share optional usage analytics", comment: "safety" });
  const status =
    isPending || !scope || (!preference && !error)
      ? t`Checking your account and server settings…`
      : error === "read"
        ? t`Could not load your preference.`
        : error === "revoke"
          ? stoppedLocally
          : error === "enable"
            ? t({ message: "Could not confirm enabling. Sharing remains off.", comment: "safety" })
            : !preference?.available
              ? t({
                  message:
                    "Analytics are unavailable on this server. You can still turn off sharing.",
                  comment: "safety",
                })
              : busy
                ? t`Updating your setting…`
                : gate
                  ? t({ message: "Sharing is on.", comment: "safety" })
                  : t({
                      message: "Sharing is off unless you explicitly opt in.",
                      comment: "safety",
                    });

  return (
    <Section
      title={t`Usage analytics`}
      icon={ChartPie}
      tone="signal"
      description={
        <Trans comment="safety">
          Optional usage analytics via PostHog EU. Sends approved settings-action names and a new
          random event ID for each event; events are not linked to your account, device, session, or
          workspace. No health records or free text are sent. PostHog retains events and their IDs
          and sees our server’s network IP, not your forwarded IP. Turning this off stops new sends;
          already-sent events cannot be recalled.
        </Trans>
      }
    >
      <SettingsGroup>
        <SettingsRow
          icon={ChartNoAxesColumn}
          label={shareLabel}
          description={
            <Text accessibilityRole="alert" className="font-sans text-sm text-ink-3">
              {status}
            </Text>
          }
          trailing={
            <Switch
              accessibilityLabel={shareLabel}
              value={checked}
              disabled={
                busy ||
                !scope ||
                isPending ||
                !preference ||
                (!preference.available && !preference.enabled && error !== "revoke")
              }
              onValueChange={(next) => void consent.setPreference(next)}
              trackColor={{ true: signal }}
            />
          }
        >
          {error || (pending === null && !preference) || error === "revoke" ? (
            <View className="items-start gap-2 pl-12">
              {(error || (pending === null && !preference)) && (
                <Button
                  variant="outline"
                  size="sm"
                  onPress={error ? consent.retry : consent.refresh}
                  isDisabled={busy}
                  accessibilityLabel={t`Retry loading analytics preference`}
                >
                  <Button.Label>{t`Retry`}</Button.Label>
                </Button>
              )}
              {error === "revoke" && (
                <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
                  {stoppedLocally}
                </Text>
              )}
            </View>
          ) : null}
        </SettingsRow>
      </SettingsGroup>
    </Section>
  );
}
