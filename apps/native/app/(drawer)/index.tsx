import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "expo-router";
import { Button } from "heroui-native";
import {
  CircleCheck,
  CircleX,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Server,
} from "lucide-react-native";
import { Text, View } from "react-native";

import { BloomMark, Details, Icon, Page, Sheet, StatusPill, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";
import { SignIn } from "@/components/sign-in";
import { authClient } from "@/lib/auth-client";
import { signOutOfThisPhone } from "@/lib/sign-out";
import { orpc } from "@/utils/orpc";

export default function Home() {
  const readiness = useQuery(orpc.health.readiness.queryOptions({ input: {} }));
  const protectedEcho = useQuery(
    orpc.example.protectedEcho.queryOptions({ input: { message: "hello" } }),
  );
  const isConnected = readiness?.data?.status === "ok";
  const isLoading = readiness?.isLoading;
  const { data: session } = authClient.useSession();
  const { t } = useLingui();

  return (
    <Container>
      <Page className="pt-10">
        <View className="items-center gap-3">
          <BloomMark size={56} />
          <Text
            className="font-display text-[34px] font-semibold leading-[40px] text-ink"
            accessibilityRole="header"
          >
            OpenValens
          </Text>
          <Text className="text-center font-sans text-base text-ink-3">
            {t`An open-source, private health record.`}
          </Text>
        </View>

        {session?.user ? (
          <Sheet className="gap-4">
            <View className="gap-1">
              <Text className="font-display text-xl text-ink">
                <Trans>
                  Welcome, <Text className="font-display font-semibold">{session.user.name}</Text>
                </Trans>
              </Text>
              <Text className="font-sans text-sm text-ink-3">{session.user.email}</Text>
            </View>
            <Link href="/(drawer)/(tabs)" asChild>
              <Button accessibilityLabel={t`Cockpit`}>
                <Icon icon={LayoutDashboard} size={18} color="primary-foreground" />
                <Button.Label>{t`Cockpit`}</Button.Label>
              </Button>
            </Link>
            <Button variant="danger-soft" onPress={() => void signOutOfThisPhone()}>
              <Icon icon={LogOut} size={18} color="danger" />
              <Button.Label>{t`Sign Out`}</Button.Label>
            </Button>
          </Sheet>
        ) : (
          <SignIn />
        )}

        <Details summary={t`System Status`}>
          <View className="gap-3">
            <Sheet className="gap-3 p-4">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="font-display text-lg font-semibold text-ink">{t`System Status`}</Text>
                <StatusPill tone={isConnected ? "good" : "bad"}>
                  {isConnected ? t`LIVE` : t`OFFLINE`}
                </StatusPill>
              </View>
              <View className="flex-row items-center gap-3">
                <ToneIcon icon={Server} tone="neutral" size="sm" />
                <View className="flex-1">
                  <Text className="font-sans text-base font-medium text-ink">ORPC Backend</Text>
                  <Text className="font-sans text-sm text-ink-3">
                    {isLoading
                      ? t`Checking connection...`
                      : isConnected
                        ? t`Connected to API`
                        : t`API Disconnected`}
                  </Text>
                </View>
                {isLoading && <Icon icon={Hourglass} size={20} color="ink-3" />}
                {!isLoading && isConnected && <Icon icon={CircleCheck} size={20} color="success" />}
                {!isLoading && !isConnected && <Icon icon={CircleX} size={20} color="danger" />}
              </View>
            </Sheet>

            <Sheet className="gap-2 p-4">
              <Text className="font-display text-lg font-semibold text-ink">{t`Private Data`}</Text>
              {protectedEcho && (
                <Text className="font-sans text-sm text-ink-3">{protectedEcho.data?.message}</Text>
              )}
            </Sheet>
          </View>
        </Details>
      </Page>
    </Container>
  );
}
