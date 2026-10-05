import "@/global.css";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Stack } from "expo-router";
import { HeroUINativeProvider, useToast } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useEffect, useRef } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { AppThemeProvider } from "@/contexts/app-theme-context";
// Defines the background sync task on every launch, including headless ones.
import "@/lib/health-sync/scheduler";
import { acceptMagicLinkUrl } from "@/lib/magic-link";
import { queryClient } from "@/utils/orpc";

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

function MagicLinkLifecycle() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  const initialUrlStarted = useRef(false);
  toastRef.current = toast;

  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      try {
        await acceptMagicLinkUrl(url);
      } catch {
        toastRef.current.show({
          variant: "danger",
          label: "Could not complete sign-in. Please try again.",
        });
      }
    };
    if (!initialUrlStarted.current) {
      initialUrlStarted.current = true;
      void Linking.getInitialURL()
        .then(handle)
        .catch(() => {
          toastRef.current.show({
            variant: "danger",
            label: "Could not complete sign-in. Please try again.",
          });
        });
    }
    const subscription = Linking.addEventListener("url", ({ url }) => void handle(url));
    return () => subscription.remove();
  }, []);
  return null;
}

function StackLayout() {
  return (
    <Stack screenOptions={{}}>
      <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ title: "Modal", presentation: "modal" }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <AppThemeProvider>
            <HeroUINativeProvider>
              <MagicLinkLifecycle />
              <StackLayout />
            </HeroUINativeProvider>
          </AppThemeProvider>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
