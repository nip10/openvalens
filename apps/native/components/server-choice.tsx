import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input, Label, Spinner, TextField } from "heroui-native";
import { Cloud, Server } from "lucide-react-native";
import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { BloomMark, Sheet, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";
import {
  CLOUD_SERVER_URL,
  normalizeServerAddress,
  serverLabel,
  type AddressProblem,
} from "@/lib/server/server-address";
import { probeServer, type ServerProblem } from "@/lib/server/server-meta";
import { allowsLocalHttp } from "@/lib/server/server-url";
import { switchServer } from "@/lib/server/switch-server";

export type ProblemCopy = { title: string; description: string };

/** One headline and one next step for each way a server check can fail. */
export function useServerProblemCopy(): (problem: ServerProblem, url: string) => ProblemCopy {
  const { t } = useLingui();
  return (problem, url) => {
    const host = serverLabel(url);
    switch (problem.kind) {
      case "unreachable":
        return {
          title: t`Could not reach ${host}`,
          description: t`Check the address and your network, then try again.`,
        };
      case "not-openvalens":
        return {
          title: t`${host} is not an OpenValens server`,
          description: t`Check the address. If it is right, the server may need an update.`,
        };
      case "not-https":
        return {
          title: t`${host} does not use HTTPS`,
          description: t`The app connects only over HTTPS. Use an address that starts with https://.`,
        };
      case "server-too-old": {
        const version = problem.serverVersion;
        return {
          title: t`This server needs an update`,
          description: t`${host} runs OpenValens ${version}, which this app no longer supports. Ask the server's administrator to update it.`,
        };
      }
      case "app-too-old": {
        const version = problem.serverVersion;
        return {
          title: t`Update the app`,
          description: t`${host} runs OpenValens ${version}, which needs a newer version of this app. Update it from your app store.`,
        };
      }
    }
  };
}

/**
 * Issue #295 — first launch, before sign-in: OpenValens Cloud in one tap, or
 * the address of a server the person (or their organization) runs. A typed
 * address is checked against the server before it is saved.
 */
export function ServerChoice() {
  const { t } = useLingui();
  const problemCopy = useServerProblemCopy();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<ProblemCopy | null>(null);
  const [busy, setBusy] = useState<"cloud" | "own" | null>(null);
  const inFlight = useRef(false);
  const cloudHost = serverLabel(CLOUD_SERVER_URL);

  const addressCopy: Record<AddressProblem, ProblemCopy> = {
    empty: {
      title: t`Enter your server's address`,
      description: t`For example https://health.example.org.`,
    },
    invalid: {
      title: t`This is not a server address`,
      description: t`Use an address such as https://health.example.org.`,
    },
    "not-https": {
      title: t`This address does not use HTTPS`,
      description: t`The app connects only over HTTPS. Use an address that starts with https://.`,
    },
  };

  const run = async (kind: "cloud" | "own", task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setError(null);
    try {
      await task();
    } catch {
      setError({
        title: t`Could not save the server`,
        description: t`Try again. If it keeps failing, restart the app.`,
      });
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const chooseCloud = () => run("cloud", () => switchServer(CLOUD_SERVER_URL));

  const connect = () =>
    run("own", async () => {
      const normalized = normalizeServerAddress(address, { allowLocalHttp: allowsLocalHttp() });
      if (!normalized.ok) {
        setError(addressCopy[normalized.problem]);
        return;
      }
      const check = await probeServer(normalized.url);
      if (!check.ok) {
        setError(problemCopy(check.problem, normalized.url));
        return;
      }
      await switchServer(normalized.url);
    });

  return (
    <Container>
      <View className="gap-7 px-4 pb-12 pt-16">
        <View className="items-center gap-3">
          <BloomMark size={56} />
          <Text
            className="font-display text-[34px] font-semibold leading-[40px] text-ink"
            accessibilityRole="header"
          >
            OpenValens
          </Text>
          <Text className="text-center font-sans text-base text-ink-3">
            <Trans>Where is your account?</Trans>
          </Text>
        </View>

        <Sheet className="gap-4 p-5">
          <View className="flex-row items-start gap-3">
            <ToneIcon icon={Cloud} tone="signal" />
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-display text-xl font-semibold text-ink">
                <Trans>OpenValens Cloud</Trans>
              </Text>
              <Text className="font-sans text-sm text-ink-3">
                <Trans>Hosted for you at {cloudHost}.</Trans>
              </Text>
            </View>
          </View>
          <Button
            onPress={() => void chooseCloud()}
            isDisabled={busy !== null}
            accessibilityLabel={t`Use OpenValens Cloud`}
          >
            {busy === "cloud" ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label>
                <Trans>Use OpenValens Cloud</Trans>
              </Button.Label>
            )}
          </Button>
        </Sheet>

        <Sheet className="gap-4 p-5">
          <View className="flex-row items-start gap-3">
            <ToneIcon icon={Server} tone="neutral" />
            <View className="min-w-0 flex-1 gap-1">
              <Text className="font-display text-xl font-semibold text-ink">
                <Trans>My own server</Trans>
              </Text>
              <Text className="font-sans text-sm text-ink-3">
                <Trans>An OpenValens server you or your organization runs.</Trans>
              </Text>
            </View>
          </View>
          <TextField isInvalid={!!error}>
            {/* heroui's Label takes a plain string; a <Trans> element is not one. */}
            <Label>{t`Server address`}</Label>
            <Input
              testID="server-address-input"
              value={address}
              onChangeText={(next) => {
                setAddress(next);
                if (error) setError(null);
              }}
              placeholder="https://health.example.org"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={() => void connect()}
              accessibilityLabel={t`Server address`}
            />
          </TextField>
          {error ? (
            <View accessibilityLiveRegion="polite" accessibilityRole="alert" className="gap-1">
              <Text className="font-sans text-sm font-semibold text-danger">{error.title}</Text>
              <Text className="font-sans text-sm text-ink-2">{error.description}</Text>
            </View>
          ) : null}
          <Button variant="outline" onPress={() => void connect()} isDisabled={busy !== null}>
            {busy === "own" ? (
              <Spinner size="sm" />
            ) : (
              <Button.Label>
                <Trans>Connect</Trans>
              </Button.Label>
            )}
          </Button>
        </Sheet>
      </View>
    </Container>
  );
}
