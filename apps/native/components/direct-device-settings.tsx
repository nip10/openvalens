import { Button } from "heroui-native";
import { Bluetooth, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { Icon, Section, Sheet, StatusPill } from "@/components/bloom";
import { ListRow } from "@/components/list-row";
import { createHelioSetupController } from "@/lib/direct-devices/setup/controller";
import type { HelioSetupController, HelioSetupSnapshot } from "@/lib/direct-devices/setup/types";

const initialSnapshot: HelioSetupSnapshot = Object.freeze({
  phase: "idle", bluetooth: "unknown", devices: Object.freeze([]), connectedDeviceId: null,
  errorCode: null, crypto: Object.freeze({ status: "not_checked", code: null }),
});

export function DirectDeviceSettings({ scopeKey }: { scopeKey: string | null }) {
  const [controller, setController] = useState<HelioSetupController | null>(null);
  useEffect(() => {
    if (!__DEV__ || !scopeKey) return;
    const instance = createHelioSetupController();
    setController(instance);
    // Controller is memory-only; scope changes replace it, without creating identity or uploads.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void instance.disconnect();
    });
    return () => {
      subscription.remove();
      void instance.dispose();
    };
  }, [scopeKey]);
  useFocusEffect(useCallback(() => () => {
    if (controller) void controller.disconnect();
  }, [controller]));
  if (!__DEV__) return null;
  return <HelioPanel controller={controller} />;
}

function HelioPanel({ controller }: { controller: HelioSetupController | null }) {
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.getSnapshot ?? (() => initialSnapshot),
    () => initialSnapshot,
  );
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch { /* Fixed generic UI copy; never surface native exceptions. */ }
    finally { setBusy(false); }
  };
  const status = snapshot.phase === "scanning" ? "Looking for straps…"
    : snapshot.phase === "connecting" ? "Checking connection…"
      : snapshot.phase === "connected" ? "Connected; service found"
        : snapshot.bluetooth === "unsupported" ? "Bluetooth is not supported on this device"
          : snapshot.bluetooth === "unauthorized" ? "Bluetooth permission is needed"
            : snapshot.bluetooth === "powered_off" ? "Turn on Bluetooth to find a strap"
              : snapshot.phase === "error" ? friendlyError(snapshot.errorCode)
                : "Ready to check a nearby strap";

  return (
    <Section title="Direct device setup" icon={Bluetooth} tone="signal">
      <Sheet className="gap-3">
        <Text className="font-sans text-sm leading-relaxed text-ink-2">
          Development check for an Amazfit Helio Strap. Connection checks only. History sync is not available yet.
        </Text>
        <View className="flex-row items-center gap-2">
          <StatusPill tone={snapshot.phase === "connected" ? "good" : snapshot.phase === "error" ? "warn" : "neutral"}>{status}</StatusPill>
        </View>
        {snapshot.devices.length === 0 && snapshot.phase === "idle" ? (
          <Text className="font-sans text-sm text-ink-3">No straps found yet. Keep the strap nearby and try again.</Text>
        ) : null}
        {snapshot.devices.filter((device) => device.id !== snapshot.connectedDeviceId).map((device) => (
          <ListRow key={device.id} icon={<Icon icon={Bluetooth} size={18} color="ink-2" />} title="Helio Strap" subtitle="Nearby" onPress={() => controller && !busy && snapshot.phase === "idle" && void run(() => controller.connect(device.id))} trailing={<Text className="font-sans text-sm text-signal">Connect</Text>} />
        ))}
        <View className="flex-row flex-wrap gap-2">
          {snapshot.phase === "connected" ? (
            <Button variant="outline" onPress={() => controller && void run(() => controller.disconnect())} isDisabled={busy}><Button.Label>Disconnect</Button.Label></Button>
          ) : snapshot.phase === "scanning" ? (
            <Button variant="outline" onPress={() => controller && void run(() => controller.stopScan())}><Button.Label>Stop finding</Button.Label></Button>
          ) : (
            <Button onPress={() => controller && void run(() => controller.startScan())} isDisabled={!controller || busy || snapshot.phase === "connecting"}><Button.Label>{busy ? "Please wait…" : "Find strap"}</Button.Label></Button>
          )}
          <Button variant="outline" onPress={() => controller && void run(() => controller.runCryptoSelfTest())} isDisabled={!controller || busy || snapshot.crypto.status === "running"}>
            <Button.Label>{snapshot.crypto.status === "running" ? "Checking…" : "Check encryption support"}</Button.Label>
          </Button>
        </View>
        <View className="flex-row items-center gap-2">
          <Icon icon={ShieldCheck} size={16} color="ink-2" />
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
            Encryption check: {snapshot.crypto.status === "passed" ? "passed" : snapshot.crypto.status === "failed" ? "failed" : snapshot.crypto.status === "unavailable" ? "not available on this build" : snapshot.crypto.status === "running" ? "in progress" : "not run"}
          </Text>
        </View>
      </Sheet>
    </Section>
  );
}

function friendlyError(code: string | null) {
  if (code === "PERMISSION_DENIED") return "Bluetooth permission was not granted. Check app permissions and try again.";
  if (code === "BLUETOOTH_POWEREDOFF") return "Turn on Bluetooth to find a strap.";
  if (code === "BLUETOOTH_UNAUTHORIZED") return "Allow Bluetooth access in your device settings.";
  if (code === "BLUETOOTH_UNSUPPORTED") return "Bluetooth is not supported on this device.";
  if (code === "HUAMI_SERVICE_MISSING") return "This strap did not provide the expected service.";
  return "Could not check the connection. Try again.";
}
