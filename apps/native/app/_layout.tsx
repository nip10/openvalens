// Intl polyfills must load before anything formats or pluralizes (#67).
import "@/lib/i18n/polyfills";
import "@/global.css";
import { useLingui } from "@lingui/react/macro";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Stack } from "expo-router";
import { HeroUINativeProvider, useToast } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { BloomFonts, DISPLAY_FONT } from "@/components/fonts";
import { LocaleSync } from "@/components/locale-sync";
import {
  installForegroundNotificationHandler,
  PushNotificationLifecycle,
} from "@/components/push-notification-lifecycle";
import { ServerChoice } from "@/components/server-choice";
import { AppThemeProvider } from "@/contexts/app-theme-context";
import { DisplayPreferencesProvider } from "@/lib/display-preferences";
import { AppI18nProvider } from "@/lib/i18n/provider";
import { getAuthClient } from "@/lib/auth-client";
import { initErrorReporting } from "@/lib/error-reporting";
// Defines the background sync task on every launch, including headless ones.
import "@/lib/health-sync/scheduler";
import { acceptMagicLinkUrl } from "@/lib/magic-link";
import { useServer } from "@/lib/server/server-url";
import { queryClient } from "@/utils/orpc";

// Issue #54 — optional, PHI-scrubbed error reporting; off without a DSN.
initErrorReporting();
// Show pushes that arrive while the app is open (quietly); taps are handled below.
installForegroundNotificationHandler();

export const unstable_settings = {
  initialRouteName: "(drawer)",
};

function MagicLinkLifecycle() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  const initialUrlStarted = useRef(false);
  toastRef.current = toast;
  const { t } = useLingui();
  const failedRef = useRef("");
  failedRef.current = t`Could not complete sign-in. Please try again.`;

  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      try {
        await acceptMagicLinkUrl(url);
      } catch {
        toastRef.current.show({ variant: "danger", label: failedRef.current });
      }
    };
    if (!initialUrlStarted.current) {
      initialUrlStarted.current = true;
      void Linking.getInitialURL()
        .then(handle)
        .catch(() => {
          toastRef.current.show({ variant: "danger", label: failedRef.current });
        });
    }
    const subscription = Linking.addEventListener("url", ({ url }) => void handle(url));
    return () => subscription.remove();
  }, []);
  return null;
}

/**
 * Issue #295 — nothing that talks to a server renders before one is chosen.
 * Keyed on the server, so a switch remounts every screen and hook against
 * the new one.
 */
function ServerGate({ children }: { children: ReactNode }) {
  const server = useServer();
  if (server.status === "loading") return null;
  if (server.status === "unset") return <ServerChoice />;
  // Create the auth client up front: a magic link that cold-starts the app
  // installs its session into this client's store.
  getAuthClient();
  return <Fragment key={server.url}>{children}</Fragment>;
}

function StackLayout() {
  const { t } = useLingui();
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontFamily: DISPLAY_FONT } }}>
      <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
      <Stack.Screen
        name="log-food"
        options={{ headerShown: false, presentation: "fullScreenModal" }}
      />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ title: t`Modal`, presentation: "modal" }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <AppI18nProvider>
      <DisplayPreferencesProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppThemeProvider>
                <HeroUINativeProvider>
                  <BloomFonts>
                    <ServerGate>
                      <MagicLinkLifecycle />
                      <LocaleSync />
                      <StackLayout />
                      <PushNotificationLifecycle />
                    </ServerGate>
                  </BloomFonts>
                </HeroUINativeProvider>
              </AppThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </DisplayPreferencesProvider>
    </AppI18nProvider>
  );
}
