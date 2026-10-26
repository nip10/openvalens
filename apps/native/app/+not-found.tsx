import { Trans, useLingui } from "@lingui/react/macro";
import { Link, Stack } from "expo-router";
import { Button } from "heroui-native";
import { Compass } from "lucide-react-native";
import { Text, View } from "react-native";

import { Sheet, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";

export default function NotFoundScreen() {
  const { t } = useLingui();
  return (
    <>
      <Stack.Screen options={{ title: t`Not Found` }} />
      <Container>
        <View className="flex-1 items-center justify-center p-4">
          <Sheet className="w-full max-w-sm items-center gap-3 p-6">
            <ToneIcon icon={Compass} tone="signal" size="lg" />
            <Text
              className="text-center font-display text-2xl font-semibold text-ink"
              accessibilityRole="header"
            >
              <Trans>Page Not Found</Trans>
            </Text>
            <Text className="text-center font-sans text-base text-ink-3">
              <Trans>The page you're looking for doesn't exist.</Trans>
            </Text>
            <Link href="/" asChild>
              <Button className="mt-1 self-stretch">
                <Button.Label>
                  <Trans>Go Home</Trans>
                </Button.Label>
              </Button>
            </Link>
          </Sheet>
        </View>
      </Container>
    </>
  );
}
