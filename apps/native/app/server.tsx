import { Trans, useLingui } from "@lingui/react/macro";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { Button } from "heroui-native";
import { ArrowLeftRight, Server } from "lucide-react-native";
import { Text, View } from "react-native";

import { BloomMark, ListCard, Page, PageHeader } from "@/components/bloom";
import { useChangeServer } from "@/components/change-server";
import { Container } from "@/components/container";
import { useServerProblemCopy } from "@/components/server-choice";
import { normalizeServerAddress, serverLabel } from "@/lib/server/server-address";
import { wasLinkOffered } from "@/lib/server/server-link";
import { allowsLocalHttp, useServer } from "@/lib/server/server-url";

/**
 * #444 — `openvalens://server?url=…` (the web's "Get the phone app" QR code)
 * while this phone already uses a server. The same server opens the app as
 * usual; another one is shown next to the current one, and switching goes
 * through "Change server" (its own confirmation), then the server choice with
 * the link's address filled in. Nothing switches without the person's say.
 */
export default function ServerLinkScreen() {
  const { t } = useLingui();
  const params = useLocalSearchParams<{ url?: string }>();
  const server = useServer();
  const problemCopy = useServerProblemCopy();
  const raw = typeof params.url === "string" ? params.url.trim() : "";
  const parsed = raw ? normalizeServerAddress(raw, { allowLocalHttp: allowsLocalHttp() }) : null;
  const changeServer = useChangeServer({ nextServer: parsed?.ok ? parsed.url : undefined });

  if (server.status !== "set" || !parsed) return <Redirect href="/" />;
  // Already here, or already offered on the server choice before one was set.
  if ((parsed.ok && parsed.url === server.url) || wasLinkOffered(raw)) {
    return <Redirect href="/" />;
  }

  const current = serverLabel(server.url);
  const linked = parsed.ok ? serverLabel(parsed.url) : raw;
  const stay = () => router.replace("/");
  const problem = parsed.ok
    ? null
    : parsed.problem === "not-https"
      ? problemCopy({ kind: "not-https" }, raw)
      : {
          title: t`This is not a server address`,
          description: t`Use an address such as https://health.example.org.`,
        };

  return (
    <Container>
      <Stack.Screen options={{ headerShown: false }} />
      <Page className="pt-16">
        <BloomMark size={48} />
        <PageHeader
          title={<Trans>Open another server?</Trans>}
          description={
            <Trans>
              This link is for a different OpenValens server than the one this phone uses.
            </Trans>
          }
        />
        <View className="gap-3">
          <ListCard
            icon={ArrowLeftRight}
            tone="signal"
            title={linked}
            subtitle={parsed.ok ? parsed.url : t`From the link`}
            testID="server-link-address"
          />
          <ListCard
            icon={Server}
            tone="neutral"
            title={current}
            subtitle={t`This phone uses this server now`}
          />
        </View>
        {problem ? (
          <View accessibilityRole="alert" className="gap-1">
            <Text className="font-sans text-sm font-semibold text-danger">{problem.title}</Text>
            <Text className="font-sans text-sm text-ink-2">{problem.description}</Text>
          </View>
        ) : server.locked ? (
          <Text className="font-sans text-sm text-ink-2">
            <Trans>This app is set up for {current} only.</Trans>
          </Text>
        ) : (
          <Text className="font-sans text-sm text-ink-2">
            <Trans>
              Switching signs you out of {current}. You then check the new address and connect.
            </Trans>
          </Text>
        )}
        <View className="gap-2">
          {!problem && !server.locked ? (
            <Button onPress={changeServer} testID="server-link-switch">
              <Button.Label>{t`Switch to ${linked}`}</Button.Label>
            </Button>
          ) : null}
          <Button variant="outline" onPress={stay} testID="server-link-stay">
            <Button.Label>{t`Stay on ${current}`}</Button.Label>
          </Button>
        </View>
      </Page>
    </Container>
  );
}
