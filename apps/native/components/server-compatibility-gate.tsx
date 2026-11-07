import { useLingui } from "@lingui/react/macro";
import { Button, Spinner } from "heroui-native";
import { AppState, Modal } from "react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { Container } from "./container";
import { Sheet, ToneIcon } from "./bloom";
import { useChangeServer } from "./change-server";
import { useServerProblemCopy } from "./server-choice";
import {
  compatibilityAllowsChildren,
  createCompatibilityController,
  type CompatibilityState,
} from "../lib/server/compatibility-controller";
import { probeServer } from "../lib/server/server-meta";
import { isServerLocked } from "../lib/server/server-url";
import { Server } from "lucide-react-native";

export type CompatibilityAppStateSource = {
  currentState: string;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};
type CompatibilityProbe = Parameters<typeof createCompatibilityController>[0];

/** Server-dependent screens are not mounted until the current server passes its API probe. */
export function ServerCompatibilityGate({
  url,
  children,
  probe = probeServer,
  appState = AppState,
}: {
  url: string;
  children: ReactNode;
  probe?: CompatibilityProbe;
  appState?: CompatibilityAppStateSource;
}) {
  const { t } = useLingui();
  const problemCopy = useServerProblemCopy();
  const changeServer = useChangeServer({ pendingDataPolicy: "preserve" });
  const [state, setState] = useState<CompatibilityState>({
    status: "checking",
    url,
    generation: 0,
  });
  const [admitted, setAdmitted] = useState(false);
  const controllerRef = useRef<ReturnType<typeof createCompatibilityController> | null>(null);

  useEffect(() => {
    const controller = createCompatibilityController(probe, (next) => {
      setState(next);
      if (next.status === "ready") setAdmitted(true);
    });
    controllerRef.current = controller;
    void controller.check(url);
    let previous = appState.currentState;
    const subscription = appState.addEventListener("change", (next) => {
      const becameActive = previous !== "active" && next === "active";
      previous = next;
      if (becameActive) void controller.check(url);
    });
    return () => {
      subscription.remove();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [appState, probe, url]);

  const retry = useCallback(() => {
    if (controllerRef.current) void controllerRef.current.check(url);
  }, [url]);

  const readyForUrl = compatibilityAllowsChildren(state, url);
  const overlayVisible = admitted && !readyForUrl;
  const problem = state.url === url && state.status === "blocked" ? state.problem : null;
  const copy = problem ? problemCopy(problem, url) : null;

  const gateMessage = copy ? (
    <>
      <View className="items-center">
        <ToneIcon icon={Server} tone="signal" size="lg" />
      </View>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="gap-2">
        <Text className="font-display text-xl font-semibold text-ink" accessibilityRole="header">
          {copy.title}
        </Text>
        <Text className="font-sans text-sm text-ink-3">{copy.description}</Text>
      </View>
      <Button onPress={retry} accessibilityLabel={t`Retry server check`}>
        <Button.Label>{t`Retry`}</Button.Label>
      </Button>
      {!isServerLocked() ? (
        <Button variant="outline" onPress={changeServer} accessibilityLabel={t`Change server`}>
          <Button.Label>{t`Change server`}</Button.Label>
        </Button>
      ) : null}
    </>
  ) : (
    <View className="items-center gap-3">
      <Spinner />
      <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
        {t`Checking your server…`}
      </Text>
    </View>
  );

  if (!admitted) {
    if (readyForUrl) return <>{children}</>;
    return (
      <Container>
        <View className="flex-1 justify-center gap-5 px-4 py-10">
          <Sheet className="gap-4">{gateMessage}</Sheet>
        </View>
      </Container>
    );
  }

  return (
    <>
      {children}
      <Modal
        visible={overlayVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
        statusBarTranslucent
      >
        <View
          className="flex-1 justify-center bg-background/95 px-4 py-10"
          accessibilityViewIsModal
          importantForAccessibility="yes"
          accessibilityLabel={copy?.title ?? t`Checking your server…`}
        >
          <Sheet className="gap-4">{gateMessage}</Sheet>
        </View>
      </Modal>
    </>
  );
}
