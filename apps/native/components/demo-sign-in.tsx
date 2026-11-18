import { Trans, useLingui } from "@lingui/react/macro";
import { signInToDemo, type DemoSignInFetch } from "@openvalens/api/demo-sign-in";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { authClient } from "@/lib/auth-client";
import { orpc, queryClient } from "@/utils/orpc";

export function DemoSignIn() {
  const { t } = useLingui();
  const options = useQuery(orpc.signIn.options.queryOptions({ input: {} }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  if (!options.data?.demo) return null;
  async function open() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const outcome = await signInToDemo(authClient.$fetch as unknown as DemoSignInFetch);
    if (outcome === "signed-in") {
      queryClient.clear();
      await authClient.getSession();
      authClient.$store.notify("$sessionSignal");
    } else
      setError(
        outcome === "rate-limited"
          ? t`Too many attempts. Wait a moment, then try again.`
          : t`The demo is unavailable right now. Please try again later.`,
      );
    setBusy(false);
    inFlight.current = false;
  }
  return (
    <View className="gap-2">
      <Button variant="outline" isDisabled={busy} onPress={() => void open()} testID="try-demo">
        <Button.Label>{busy ? t`Opening demo…` : t`Try the demo`}</Button.Label>
      </Button>
      <Text className="text-center font-sans text-sm text-ink-3">
        <Trans>Explore synthetic data. Read-only, no sign-up needed.</Trans>
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
