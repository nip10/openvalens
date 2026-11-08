import { Button } from "heroui-native";
import { Bluetooth, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, Linking, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useLingui } from "@lingui/react/macro";

import { Icon, Section, Sheet, StatusPill } from "@/components/bloom";
import { ListRow } from "@/components/list-row";
import { getZeppOsModel } from "@/lib/direct-devices/models/zepp-os";
import type { ZeppOsModel, ZeppOsModelId } from "@/lib/direct-devices/models/zepp-os";
import { createHelioSyncController } from "@/lib/direct-devices/sync/controller";
import type {
  HelioSyncContext,
  HelioSyncController,
  HelioSyncSnapshot,
} from "@/lib/direct-devices/sync/types";

const initialSnapshot: HelioSyncSnapshot = Object.freeze({
  phase: "idle",
  bindings: Object.freeze([]),
  selectedBindingId: null,
  nearbyDevices: Object.freeze([]),
  connectedDeviceId: null,
  connectedModelId: null,
  bluetooth: "unknown",
  errorCode: null,
  capturedMinutes: 0,
  pendingEnvelopes: 0,
  acceptedEnvelopes: 0,
  queuedEnvelopes: 0,
  publication: null,
  isBusy: false,
  canSync: false,
});

/**
 * Registry lookup for a snapshot model id. The sync snapshot types the field as
 * a plain string, so the cast to `ZeppOsModelId` lives here at the boundary.
 */
function lookupModel(modelId: string | null | undefined): ZeppOsModel | undefined {
  return modelId ? getZeppOsModel(modelId as ZeppOsModelId) : undefined;
}

/** Registry display name for a matched model, falling back to the raw label. */
function modelLabel(modelId: string | null | undefined, fallback: string): string {
  return lookupModel(modelId)?.displayName ?? fallback;
}

export function DirectDeviceSettings({ context }: { context: HelioSyncContext | null }) {
  const scopeKey = context
    ? `${context.serverUrl}:${context.sessionId}:${context.userId}:${context.organizationId}`
    : null;
  const controller = useMemo(() => {
    if (!__DEV__ || !context) return null;
    return createHelioSyncController(context);
  }, [scopeKey]);

  useEffect(() => {
    if (!controller) return;
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void controller.cancel().catch(() => {});
      }
    });
    void controller.refreshBindings().catch(() => {});
    return () => {
      appState.remove();
      void controller.dispose().catch(() => {});
    };
  }, [controller]);
  useFocusEffect(
    useCallback(
      () => () => {
        if (controller) void controller.cancel().catch(() => {});
      },
      [controller],
    ),
  );

  if (!__DEV__) return null;
  return <HelioPanel controller={controller} />;
}

function HelioPanel({ controller }: { controller: HelioSyncController | null }) {
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? (() => () => {}),
    controller?.getSnapshot ?? (() => initialSnapshot),
    () => initialSnapshot,
  );
  const { t } = useLingui();
  const [authKey, setAuthKey] = useState("");
  const [working, setWorking] = useState(false);
  const validKey = /^(?:0x)?[0-9a-fA-F]{32}$/.test(authKey.trim());
  const busy = working || snapshot.isBusy;
  const run = (action: () => Promise<void>, allowWhileBusy = false) => {
    if (busy && !allowWhileBusy) return;
    setWorking(true);
    void action()
      .catch(() => {})
      .finally(() => setWorking(false));
  };
  const handoff = () => {
    if (!controller || !validKey || busy || !snapshot.canSync) return;
    const key = authKey.trim();
    setAuthKey("");
    if (working) return;
    setWorking(true);
    void controller
      .syncSteps(key)
      .catch(() => {})
      .finally(() => setWorking(false));
  };
  const phaseLabel: Record<HelioSyncSnapshot["phase"], string> = {
    idle: t`Ready`,
    loading_bindings: t`Loading saved devices…`,
    scanning: t`Finding nearby devices…`,
    connecting: t`Connecting…`,
    connected: t`Device connected`,
    authenticating: t`Authenticating…`,
    discovering_services: t`Checking device services…`,
    fetching: t`Reading step history…`,
    capturing: t`Saving captured minutes…`,
    uploading: t`Sending saved minutes…`,
    processing: t`Server is processing minutes…`,
    cancelled: t`Sync cancelled`,
    error: t`Sync needs attention`,
  };
  const selected = snapshot.bindings.find(
    (binding) => binding.deviceId === snapshot.selectedBindingId,
  );
  const statusTone =
    snapshot.phase === "error"
      ? "warn"
      : snapshot.phase === "connected" || snapshot.phase === "processing"
        ? "good"
        : "neutral";
  const policy = snapshot.publication;
  const connectedStatus = (() => {
    if (!snapshot.connectedDeviceId) return null;
    const model = lookupModel(snapshot.connectedModelId);
    if (!model)
      return t`Connected device — shared Zepp OS transport, not yet device-validated for a specific model`;
    const detail = model.transportValidated
      ? t`connection checks validated end-to-end at source level for this model; not hardware-verified`
      : t`shared Zepp OS transport, not yet device-validated for this model`;
    const experimental = model.experimental
      ? ` · ${t`upstream lists this model as experimental`}`
      : "";
    return `${model.displayName} — ${detail}${experimental}`;
  })();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") setAuthKey("");
    });
    return () => sub.remove();
  }, []);
  useFocusEffect(useCallback(() => () => setAuthKey(""), []));
  useEffect(() => {
    setAuthKey("");
  }, [controller, snapshot.selectedBindingId, snapshot.connectedDeviceId]);

  return (
    <Section title={t`Direct device steps`} icon={Bluetooth} tone="signal">
      <Sheet className="gap-3">
        <Text className="font-sans text-sm leading-relaxed text-ink-2">
          {t`Experimental foreground steps sync for an already-paired Zepp OS Amazfit family device (36 registered models). No vendor login is requested. The first sync asks for the last 24 hours; later syncs resume from the saved checkpoint. Only the Amazfit Helio Strap has connection checks validated end-to-end at source level; nothing is hardware-verified.`}
        </Text>
        <Text className="font-sans text-sm leading-relaxed text-ink-3">
          {t`Use the same saved device on both phones. Choose an existing binding to avoid duplicates, or add another only when you mean to create a separate binding. Nearby connection is a separate step.`}
        </Text>
        <StatusPill tone={statusTone}>{phaseLabel[snapshot.phase]}</StatusPill>
        {connectedStatus ? (
          <Text className="font-sans text-sm text-ink-3">{connectedStatus}</Text>
        ) : null}

        {snapshot.bindings.map((binding) => (
          <ListRow
            key={binding.deviceId}
            icon={<Icon icon={Bluetooth} size={18} color="ink-2" />}
            title={`${modelLabel(binding.family, "Helio Strap")} #${binding.providerConnectionId}`}
            subtitle={t`Added ${new Date(binding.connectedAt).toLocaleDateString()}`}
            onPress={() => !busy && controller?.selectBinding(binding.deviceId)}
            trailing={
              <Text className="font-sans text-sm text-signal">
                {selected?.deviceId === binding.deviceId ? t`Selected` : t`Use existing`}
              </Text>
            }
          />
        ))}
        {controller && !busy ? (
          <Button variant="outline" onPress={() => run(() => controller.createBinding())}>
            <Button.Label>{t`Add another binding`}</Button.Label>
          </Button>
        ) : null}

        {snapshot.nearbyDevices.map((device) => (
          <ListRow
            key={device.id}
            icon={<Icon icon={Bluetooth} size={18} color="ink-2" />}
            title={modelLabel(device.modelId, device.name || t`Nearby device`)}
            subtitle={t`Nearby device`}
            onPress={() => controller && run(() => controller.connect(device.id))}
            trailing={<Text className="font-sans text-sm text-signal">{t`Connect`}</Text>}
          />
        ))}
        <View className="flex-row flex-wrap gap-2">
          {snapshot.phase === "scanning" ? (
            <Button
              variant="outline"
              onPress={() => controller && run(() => controller.stopScan(), true)}
            >
              <Button.Label>{t`Stop finding`}</Button.Label>
            </Button>
          ) : snapshot.isBusy && !snapshot.connectedDeviceId ? (
            <Button
              variant="outline"
              onPress={() => controller && run(() => controller.cancel(), true)}
            >
              <Button.Label>{t`Cancel`}</Button.Label>
            </Button>
          ) : snapshot.connectedDeviceId ? (
            <Button
              variant="outline"
              onPress={() => controller && run(() => controller.cancel(), true)}
            >
              <Button.Label>{t`Disconnect`}</Button.Label>
            </Button>
          ) : (
            <Button
              onPress={() => controller && run(() => controller.startScan())}
              isDisabled={!controller || busy}
            >
              <Button.Label>{t`Find nearby device`}</Button.Label>
            </Button>
          )}
        </View>
        {selected && snapshot.connectedDeviceId ? (
          <>
            <View className="gap-2">
              <Text className="font-sans text-sm font-medium text-ink-2">{t`Device authentication key`}</Text>
              <TextInput
                value={authKey}
                onChangeText={setAuthKey}
                maxLength={34}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
                accessibilityLabel={t`Device authentication key`}
                placeholder={t`32 hexadecimal characters (16 bytes)`}
                className="rounded-xl border border-rule bg-paper px-3 py-2.5 font-sans text-base text-ink"
              />
              <Text className="font-sans text-sm text-ink-3">{t`Enter the 16-byte (32 hexadecimal character) key already configured for this device. Do not enter your vendor account password.`}</Text>
              <Text
                onPress={() =>
                  void Linking.openURL(
                    "https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/",
                  )
                }
                className="font-sans text-sm font-medium text-signal underline"
              >{t`Gadgetbridge pairing help`}</Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button onPress={handoff} isDisabled={!validKey || !snapshot.canSync || busy}>
                <Button.Label>{t`Sync steps`}</Button.Label>
              </Button>
              {snapshot.isBusy || snapshot.phase === "scanning" || snapshot.connectedDeviceId ? (
                <Button
                  variant="outline"
                  onPress={() => controller && run(() => controller.cancel(), true)}
                >
                  <Button.Label>{t`Cancel / disconnect`}</Button.Label>
                </Button>
              ) : null}
            </View>
          </>
        ) : null}
        {snapshot.pendingEnvelopes > 0 && snapshot.phase !== "uploading" ? (
          <Button
            variant="outline"
            onPress={() => controller && run(() => controller.retryUpload())}
          >
            <Button.Label>{t`Retry upload`}</Button.Label>
          </Button>
        ) : null}
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
          {t`Captured minutes: ${snapshot.capturedMinutes} · Pending: ${snapshot.pendingEnvelopes} · Accepted: ${snapshot.acceptedEnvelopes} · Queued for processing: ${snapshot.queuedEnvelopes}`}
        </Text>
        {policy ? (
          <Text className="font-sans text-sm text-ink-3">
            {t`Published minute records: ${policy.publishedRecords} · Shadowed minute records (stored, not added to totals): ${policy.shadowedRecords}. Step publication follows UTC-day coverage: phone and cloud steps take priority for the whole day, including partial days. Of multiple direct devices, the earliest registered binding is used on uncovered days.`}
          </Text>
        ) : null}
        {snapshot.errorCode ? (
          <Text className="font-sans text-sm text-destructive">
            {friendlyError(snapshot.errorCode)}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-2">
          <Icon icon={ShieldCheck} size={16} color="ink-2" />
          <Text className="font-sans text-xs text-ink-3">{t`Experimental; foreground use only. Connection checks are source-validated for the Amazfit Helio Strap only; no model is hardware-verified.`}</Text>
        </View>
      </Sheet>
    </Section>
  );
}

function friendlyError(code: string) {
  if (code === "BLUETOOTH_UNAUTHORIZED") return "Allow Bluetooth access in device settings.";
  if (code === "BLUETOOTH_POWERED_OFF") return "Turn on Bluetooth and try again.";
  if (code === "INVALID_INPUT")
    return "The device key or captured data was not accepted. Check the key and try again.";
  if (code === "MINUTE_CONFLICT")
    return "This device reported different steps for a minute already stored. No duplicate was added.";
  return "Could not sync device steps. Try again.";
}
