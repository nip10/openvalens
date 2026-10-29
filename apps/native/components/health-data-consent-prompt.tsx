import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Button, Spinner } from "heroui-native";

import { Sheet } from "@/components/bloom";
import { authClient } from "@/lib/auth-client";
import { useServer } from "@/lib/server/server-url";
import { client } from "@/utils/orpc";
import { needsHealthConsent } from "@/lib/health-consent";

export function HealthDataConsentPrompt() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const server = useServer();
  const serverUrl = server.status === "set" ? server.url : null;
  const userId = session.data?.user?.id ?? null;
  const statusKey = ["healthConsent", "status", serverUrl, userId] as const;
  const [checked, setChecked] = useState(false);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => client.healthConsent.status({}),
    enabled: !!serverUrl && !!userId && !session.isPending,
    staleTime: 60_000,
  });
  const accept = useMutation({
    mutationFn: (version: string) =>
      client.healthConsent.accept({ acceptedHealthDataConsent: true, version }),
    onSuccess: (next) => {
      queryClient.setQueryData(statusKey, next);
      setChecked(false);
    },
    onError: () => {
      setChecked(false);
      void queryClient.invalidateQueries({ queryKey: statusKey });
    },
  });
  useEffect(() => setChecked(false), [status.data?.currentVersion]);

  if (session.isPending || !session.data || status.isPending) return null;
  if (status.isError) {
    return (
      <Sheet className="mx-3 mt-2 gap-2 border border-rule p-3">
        <Text className="font-sans text-sm text-ink-2">{t`Could not check health data consent.`}</Text>
        <Button variant="secondary" onPress={() => void status.refetch()}>
          <Button.Label>{t`Try again`}</Button.Label>
        </Button>
      </Sheet>
    );
  }
  if (!needsHealthConsent(status.data) || !status.data?.currentVersion) return null;
  const version = status.data.currentVersion;

  return (
    <Sheet className="mx-3 mt-2 gap-3 border border-signal/30 p-4">
      <View className="gap-1">
        <Text className="font-display text-lg font-semibold text-ink">
          {t`Health data consent`}
        </Text>
        <Text className="font-sans text-sm leading-relaxed text-ink-2">
          {t`I consent to OpenValens processing my health data to provide the service.`}{" "}
          {status.data.privacyUrl ? (
            <Text
              accessibilityRole="link"
              className="font-semibold text-signal underline"
              onPress={() => void Linking.openURL(status.data!.privacyUrl!)}
            >
              {t`Read the privacy policy`}
            </Text>
          ) : null}
        </Text>
        <Text className="font-sans text-xs text-ink-3">{t`Consent version: ${version}`}</Text>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => setChecked((value) => !value)}
        className="flex-row items-start gap-2"
      >
        <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${checked ? "border-primary bg-primary" : "border-rule bg-paper"}`}>
          {checked ? <Text className="text-xs font-bold text-primary-foreground">✓</Text> : null}
        </View>
        <Text className="flex-1 font-sans text-sm text-ink-2">
          {t`I agree to this health data processing.`}
        </Text>
      </Pressable>
      {accept.isError ? (
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
          {t`Consent could not be saved. The version may have changed; review it and try again.`}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button isDisabled={!checked || accept.isPending} onPress={() => accept.mutate(version)}>
          {accept.isPending ? <Spinner size="sm" /> : null}
          <Button.Label>{t`I consent`}</Button.Label>
        </Button>
        <Link href="/exports" asChild>
          <Button variant="secondary"><Button.Label>{t`Export records`}</Button.Label></Button>
        </Link>
        <Link href="/(drawer)/(tabs)/settings" asChild>
          <Button variant="secondary"><Button.Label>{t`Settings and account deletion`}</Button.Label></Button>
        </Link>
      </View>
    </Sheet>
  );
}
