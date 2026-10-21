import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "heroui-native";
import { useFocusEffect } from "expo-router";
import { Pressable, Switch, Text, View } from "react-native";

import { useAnalyticsConsent } from "@openvalens/ui/hooks/use-analytics-consent";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

const analyticsApi = client.analytics;

export function AnalyticsConsentSection() {
  const { data: auth, isPending } = authClient.useSession();
  const user = auth?.user?.id;
  const org = auth?.session.activeOrganizationId;
  const scope = useMemo(() => !isPending && user && org ? JSON.stringify([user, org]) : "", [isPending, user, org]);
  const [focused, setFocused] = useState(false);
  const consent = useAnalyticsConsent({ api: analyticsApi, scope, ownerId: user ?? "", active: false });
  useFocusEffect(useCallback(() => {
    setFocused(true);
    consent.activate();
    return () => { consent.deactivate(); setFocused(false); };
  }, [consent.activate, consent.deactivate]));
  useEffect(() => { if (focused && scope) consent.activate(); }, [focused, scope, consent.activate]);
  const { preference, pending, error, gate, locallyRevoked } = consent;
  const busy = pending !== null;
  const checked = preference?.enabled === true && !locallyRevoked;
  const status = isPending || !scope || !preference && !error
    ? "Checking your account and server settings…"
    : error === "read" ? "Could not load your preference."
    : error === "revoke" ? "Stopped locally; server change unconfirmed. Retry turning it off."
    : error === "enable" ? "Could not confirm enabling. Sharing remains off."
    : !preference?.available ? "Analytics are unavailable on this server. You can still turn off sharing."
    : busy ? "Updating your setting…"
    : gate ? "Sharing is on." : "Sharing is off unless you explicitly opt in.";

  return <Card className="gap-3 p-4"><Text className="text-base font-semibold text-foreground">Usage analytics</Text>
    <Text className="text-sm leading-5 text-muted-foreground">Optional usage analytics via PostHog EU. Sends approved settings-action names and a new random event ID for each event; events are not linked to your account, device, session, or workspace. No health records or free text are sent. PostHog retains events and their IDs and sees our server’s network IP, not your forwarded IP. Turning this off stops new sends; already-sent events cannot be recalled.</Text>
    <Text accessibilityRole="alert" className="text-sm text-muted-foreground">{status}</Text>
    {(error || pending === null && !preference) && <Pressable onPress={error ? consent.retry : consent.refresh} disabled={busy} accessibilityRole="button" accessibilityLabel="Retry loading analytics preference" className="min-h-11 justify-center"><Text className="text-foreground underline">Retry</Text></Pressable>}
    <View className="min-h-12 flex-row items-center justify-between"><Text className="flex-1 text-sm text-foreground">Share optional usage analytics</Text><Switch accessibilityLabel="Share optional usage analytics" value={checked} disabled={busy || !scope || isPending || !preference || (!preference.available && !preference.enabled && error !== "revoke")} onValueChange={(next) => void consent.setPreference(next)} /></View>
    {error === "revoke" && <Text accessibilityRole="alert" className="text-sm text-destructive">Stopped locally; server change unconfirmed. Retry turning it off.</Text>}
  </Card>;
}
