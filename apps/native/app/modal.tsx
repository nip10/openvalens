import { Trans } from "@lingui/react/macro";
import { router } from "expo-router";
import { Button } from "heroui-native";
import { Check } from "lucide-react-native";
import { Text, View } from "react-native";

import { Sheet, ToneIcon } from "@/components/bloom";
import { Container } from "@/components/container";

function Modal() {
  function handleClose() {
    router.back();
  }

  return (
    <Container>
      <View className="flex-1 items-center justify-center p-4">
        <Sheet className="w-full max-w-sm gap-4 p-6">
          <View className="items-center gap-3">
            <ToneIcon icon={Check} tone="signal" size="lg" />
            <Text
              className="text-center font-display text-2xl font-semibold text-ink"
              accessibilityRole="header"
            >
              <Trans>Modal Screen</Trans>
            </Text>
            <Text className="text-center font-sans text-base text-ink-3">
              <Trans>This is an example modal screen for dialogs and confirmations.</Trans>
            </Text>
          </View>
          <Button onPress={handleClose} className="w-full">
            <Button.Label>
              <Trans>Close</Trans>
            </Button.Label>
          </Button>
        </Sheet>
      </View>
    </Container>
  );
}

export default Modal;
