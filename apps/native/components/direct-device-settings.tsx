import { Button } from "heroui-native";
import { Bluetooth, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, AppState, Linking, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useLingui } from "@lingui/react/macro";

import { Icon, Section, Sheet, StatusPill } from "@/components/bloom";
import { ListRow } from "@/components/list-row";
import { getHuaweiModel } from "@/lib/direct-devices/models/huawei";
import type { HuaweiModel, HuaweiModelId } from "@/lib/direct-devices/models/huawei";
import { getGarminModel } from "@/lib/direct-devices/models/garmin";
import type { GarminModel, GarminModelId } from "@/lib/direct-devices/models/garmin";
import { getBleGattModel } from "@/lib/direct-devices/models/ble-gatt";
import type { BleGattModel, BleGattModelId } from "@/lib/direct-devices/models/ble-gatt";
import { getBangleJsModel } from "@/lib/direct-devices/models/bangle-js";
import type { BangleJsModel, BangleJsModelId } from "@/lib/direct-devices/models/bangle-js";
import { getMoyoungModel } from "@/lib/direct-devices/models/moyoung";
import type { MoyoungModel, MoyoungModelId } from "@/lib/direct-devices/models/moyoung";
import { getBleScaleModel } from "@/lib/direct-devices/models/ble-scale";
import type { BleScaleModel, BleScaleModelId } from "@/lib/direct-devices/models/ble-scale";
import { getColmiRingModel } from "@/lib/direct-devices/models/colmi-ring";
import type { ColmiRingModel, ColmiRingModelId } from "@/lib/direct-devices/models/colmi-ring";
import { getGloryFitModel } from "@/lib/direct-devices/models/gloryfit";
import type { GloryFitModel, GloryFitModelId } from "@/lib/direct-devices/models/gloryfit";
import { getHuamiLegacyModel } from "@/lib/direct-devices/models/huami-legacy";
import type {
  HuamiLegacyModel,
  HuamiLegacyModelId,
} from "@/lib/direct-devices/models/huami-legacy";
import { getXiaomiModel } from "@/lib/direct-devices/models/xiaomi";
import type { XiaomiModel, XiaomiModelId } from "@/lib/direct-devices/models/xiaomi";
import { getZeppOsModel } from "@/lib/direct-devices/models/zepp-os";
import type { ZeppOsModel, ZeppOsModelId } from "@/lib/direct-devices/models/zepp-os";
import type { DirectDeviceFamily } from "@/lib/direct-devices/setup/types";
import { describeDeviceSupport } from "@/lib/direct-devices/support-status";
import type { OpenValensDeviceSupport } from "@/lib/direct-devices/support-status";
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
  connectedFamily: null,
  capabilities: Object.freeze({ stepsHistory: false, liveCapture: false, historySync: false }),
  bluetooth: "unknown",
  errorCode: null,
  capturedMinutes: 0,
  pendingEnvelopes: 0,
  blockedIdentityEnvelopes: 0,
  connectionGeneration: 0,
  acceptedEnvelopes: 0,
  queuedEnvelopes: 0,
  publication: null,
  isBusy: false,
  canSync: false,
});

type AnyDirectDeviceModel =
  | ZeppOsModel
  | XiaomiModel
  | HuaweiModel
  | GarminModel
  | BleGattModel
  | BangleJsModel
  | MoyoungModel
  | BleScaleModel
  | ColmiRingModel
  | GloryFitModel
  | HuamiLegacyModel;

/**
 * Registry lookup for a snapshot model id across all eight device families.
 * The sync snapshot types the field as a plain string, so the casts live here
 * at the boundary. Zepp OS is checked first, matching the setup controller's
 * matcher order (one Xiaomi-named model also ships a Zepp OS coordinator);
 * Bangle.js sits between the generic GATT sensors and the scales for the same
 * reason.
 */
function lookupModel(
  modelId: string | null | undefined,
): { model: AnyDirectDeviceModel; family: DirectDeviceFamily } | undefined {
  if (!modelId) return undefined;
  const zepp = getZeppOsModel(modelId as ZeppOsModelId);
  if (zepp) return { model: zepp, family: "zepp_os" };
  const xiaomi = getXiaomiModel(modelId as XiaomiModelId);
  if (xiaomi) return { model: xiaomi, family: "xiaomi" };
  const huawei = getHuaweiModel(modelId as HuaweiModelId);
  if (huawei) return { model: huawei, family: "huawei" };
  const garmin = getGarminModel(modelId as GarminModelId);
  if (garmin) return { model: garmin, family: "garmin" };
  const bleGatt = getBleGattModel(modelId as BleGattModelId);
  if (bleGatt) return { model: bleGatt, family: "ble_gatt" };
  const bangleJs = getBangleJsModel(modelId as BangleJsModelId);
  if (bangleJs) return { model: bangleJs, family: "bangle_js" };
  const moyoung = getMoyoungModel(modelId as MoyoungModelId);
  if (moyoung) return { model: moyoung, family: "moyoung" };
  const huamiLegacy = getHuamiLegacyModel(modelId as HuamiLegacyModelId);
  if (huamiLegacy) return { model: huamiLegacy, family: "huami_legacy" };
  const gloryFit = getGloryFitModel(modelId as GloryFitModelId);
  if (gloryFit) return { model: gloryFit, family: "gloryfit" };
  const bleScale = getBleScaleModel(modelId as BleScaleModelId);
  if (bleScale) return { model: bleScale, family: "ble_scale" };
  const colmiRing = getColmiRingModel(modelId as ColmiRingModelId);
  if (colmiRing) return { model: colmiRing, family: "colmi_ring" };
  return undefined;
}

/** Registry display name for a matched model, falling back to the raw label. */
function modelLabel(modelId: string | null | undefined, fallback: string): string {
  return lookupModel(modelId)?.model.displayName ?? fallback;
}

export function DirectDeviceSettings({ context }: { context: HelioSyncContext | null }) {
  const scopeKey = context
    ? `${context.serverUrl}:${context.sessionId}:${context.userId}:${context.organizationId}`
    : null;
  const controller = useMemo(() => {
    if (!context) return null;
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
  // Huawei auth is automatic, so its sync action carries no user key.
  const handoffWithoutKey = () => {
    if (!controller || busy || !snapshot.canSync) return;
    if (working) return;
    setWorking(true);
    void controller
      .syncSteps("")
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
  const connected = lookupModel(snapshot.connectedModelId);
  const connectedFamily = snapshot.connectedFamily;
  const isCompatibleBinding = Boolean(
    selected?.family &&
    selected.family === connectedFamily &&
    selected.modelId &&
    selected.modelId === snapshot.connectedModelId,
  );
  const needsIdentityConfirmation = Boolean(
    selected && !selected.family && snapshot.connectedDeviceId && connected && !busy,
  );
  const canSyncSelected = Boolean(
    selected &&
    snapshot.connectedDeviceId &&
    isCompatibleBinding &&
    snapshot.capabilities.stepsHistory &&
    snapshot.canSync &&
    !busy,
  );
  const openIdentityConfirmation = () => {
    const bindingId = selected?.deviceId;
    const connectedDeviceId = snapshot.connectedDeviceId;
    const family = snapshot.connectedFamily;
    const modelId = snapshot.connectedModelId;
    const connectionGeneration = snapshot.connectionGeneration;
    if (
      busy ||
      !controller ||
      !bindingId ||
      !connectedDeviceId ||
      !family ||
      !modelId ||
      !lookupModel(modelId)
    )
      return;
    const target = Object.freeze({ connectedDeviceId, family, modelId, connectionGeneration });
    const capturedModelLabel = lookupModel(modelId)?.model.displayName ?? modelId;
    Alert.alert(
      t`Confirm device identity`,
      t`Assign this saved binding to ${capturedModelLabel}? Only continue if its previous captures belong to this device. Otherwise create a new binding.`,
      [
        { text: t`Cancel`, style: "cancel" },
        {
          text: t`Assign to this device`,
          onPress: () => {
            if (!busy) run(() => controller.confirmBindingIdentity(bindingId, target));
          },
        },
      ],
    );
  };
  // A connected device wins; otherwise show the status of the selected saved
  // binding, so a saved device is not status-less before the next connection.
  const savedFocus =
    !snapshot.connectedDeviceId && selected?.family && selected.modelId
      ? lookupModel(selected.modelId)
      : undefined;
  const focus = connected ?? savedFocus;
  const focusName = connected
    ? connected.model.displayName
    : (selected?.displayName ??
      (selected?.modelId ? modelLabel(selected.modelId, t`Saved device`) : null));
  const focusSupport = focus
    ? describeDeviceSupport({
        family: focus.family,
        modelId: focus.model.id,
        transportValidated: focus.model.transportValidated,
        records: "records" in focus.model ? focus.model.records : undefined,
        sync: "sync" in focus.model ? focus.model.sync : undefined,
      })
    : null;
  // OpenValens status is the trust-relevant line and never claims more than the
  // family implements; the upstream rating below it is attributed reference data.
  const openValensStatusText: Record<OpenValensDeviceSupport, string> = {
    zepp_os_validated: t`Zepp OS transport, authentication and step history are validated at source level for this model. Not hardware-verified.`,
    zepp_os_shared: t`Shared Zepp OS transport; not validated for this model. Not hardware-verified.`,
    xiaomi_shared: t`Shared Xiaomi protobuf transport; not device-validated for this model. Not hardware-verified.`,
    huawei_history_sync: t`History sync on connection for exact-minute steps, heart rate and sleep (BLE models only); not hardware-verified.`,
    huawei_connection_only: t`Connection checks only; this model syncs over Bluetooth Classic upstream, which this BLE-only stack does not implement. Not hardware-verified.`,
    garmin_connection_only: t`Connection checks only; step history sync is not implemented. Not hardware-verified.`,
    ble_gatt_live_capture: t`Live capture while connected; not hardware-verified. No history backfill. Samples are sent only when you tap “Retry upload”.`,
    ble_scale_live_capture: t`Live weight capture while connected; not hardware-verified. Some scales also report stored measurements on connection. Samples are sent only when you tap “Retry upload”.`,
    ble_scale_connection_only: t`Connection checks only; measurement capture is not implemented for this model yet. Not hardware-verified.`,
    colmi_ring_history_sync: t`History sync on connection for steps, heart rate and sleep; not hardware-verified.`,
    bangle_js_history_sync: t`History sync on connection for steps and heart rate, plus live heart rate while connected; not hardware-verified.`,
    gloryfit_history_sync: t`History sync on connection for steps, heart rate and sleep; not hardware-verified.`,
    huami_legacy_steps_history: t`History sync on connection for step-by-minute records, heart rate and sleep; not hardware-verified.`,
    moyoung_history_sync: t`History sync on connection for heart rate and sleep; steps are not supported because the watch only reports daily totals. Not hardware-verified.`,
  };
  const upstreamLevelText = {
    high: t`high`,
    most: t`most`,
    partial: t`partial`,
    poor: t`poor`,
    unknown: t`unknown`,
  } as const;
  const upstreamStatus = (() => {
    if (!focusSupport) return null;
    if (!focusSupport.upstream.listed) return t`Not listed in the Gadgetbridge catalog.`;
    const level = upstreamLevelText[focusSupport.upstream.featureLevel];
    return focusSupport.upstream.experimental
      ? t`Gadgetbridge feature level: ${level} · experimental`
      : t`Gadgetbridge feature level: ${level}`;
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

  const authKeyPanel = (
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
            void Linking.openURL("https://gadgetbridge.org/basics/pairing/huami-xiaomi-server/")
          }
          className="font-sans text-sm font-medium text-signal underline"
        >{t`Gadgetbridge pairing help`}</Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={handoff} isDisabled={!validKey || !canSyncSelected}>
          <Button.Label>{t`Sync steps`}</Button.Label>
        </Button>
      </View>
    </>
  );

  return (
    <Section title={t`Direct devices`} icon={Bluetooth} tone="signal">
      <Sheet className="gap-3">
        <Text className="font-sans text-sm leading-relaxed text-ink-2">
          {t`Experimental direct Bluetooth support for several kinds of devices. Zepp OS and Xiaomi devices sync step history in the foreground. BLE GATT health sensors (heart rate, blood pressure, temperature) record live while connected, and a PineTime running InfiniTime reports live heart rate the same way. Bluetooth smart scales record weight live, and some also report stored measurements on connection. Colmi and Yawell smart rings sync stored step, heart-rate and sleep history on connection. Bangle.js watches sync stored step and heart-rate history on connection and keep reporting live heart rate. Moyoung/Da Fit watches sync stored heart-rate and sleep history on connection; they report steps as daily totals only, so steps are not synced. GloryFit watches sync stored step, heart-rate and sleep history on connection. Legacy Huami (Amazfit/Mi Band) watches sync exact-minute steps, heart rate and sleep when you enter their 16-byte key. Huawei/Honor BLE bands and watches sync exact-minute steps, heart rate and sleep automatically; their Bluetooth-Classic models and Garmin support connection checks only. No hardware verification has been done. No vendor login is requested.`}
        </Text>
        <Text className="font-sans text-sm leading-relaxed text-ink-3">
          {t`Use the same saved device on both phones. Choose an existing binding to avoid duplicates, or add another only when you mean to create a separate binding. Nearby connection is a separate step.`}
        </Text>
        <StatusPill tone={statusTone}>{phaseLabel[snapshot.phase]}</StatusPill>
        {snapshot.connectedDeviceId && !focus ? (
          <View className="gap-1">
            <Text className="font-sans text-base font-medium text-ink">{t`Connected device`}</Text>
            <Text className="font-sans text-sm leading-relaxed text-ink-2">
              {t`Not matched to a registered model. No OpenValens support is claimed.`}
            </Text>
          </View>
        ) : focus && focusSupport ? (
          <View className="gap-1">
            <Text className="font-sans text-base font-medium text-ink">{focusName}</Text>
            <Text className="font-sans text-sm leading-relaxed text-ink-2">
              {openValensStatusText[focusSupport.openValens]}
            </Text>
            <Text className="font-sans text-xs text-ink-3">{upstreamStatus}</Text>
          </View>
        ) : null}

        {snapshot.bindings.map((binding) => (
          <ListRow
            key={binding.deviceId}
            icon={<Icon icon={Bluetooth} size={18} color="ink-2" />}
            title={
              binding.displayName ??
              (binding.family && binding.modelId
                ? modelLabel(binding.modelId, t`Saved device`)
                : t`Saved device — identity confirmation required`)
            }
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
          <Button
            variant="outline"
            onPress={() => run(() => controller.createBinding())}
            isDisabled={!snapshot.connectedDeviceId || !connected}
          >
            <Button.Label>{t`Save connected device as new binding`}</Button.Label>
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
          ) : !snapshot.connectedDeviceId ? (
            <Button
              onPress={() => controller && run(() => controller.startScan())}
              isDisabled={!controller || busy}
            >
              <Button.Label>{t`Find nearby device`}</Button.Label>
            </Button>
          ) : null}
        </View>
        {selected && snapshot.connectedDeviceId ? (
          needsIdentityConfirmation ? (
            <Button variant="outline" isDisabled={busy} onPress={openIdentityConfirmation}>
              <Button.Label>{t`Confirm saved device identity`}</Button.Label>
            </Button>
          ) : selected.family && selected.modelId && connected && !isCompatibleBinding ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`This device does not match the selected saved binding. Select a compatible binding or save it as a new binding to sync.`}
            </Text>
          ) : snapshot.capabilities.liveCapture &&
            (connectedFamily === "ble_gatt" ||
              (connectedFamily === "ble_scale" &&
                !!connected &&
                "records" in connected.model &&
                connected.model.records.length > 0)) ? (
            <Text className="font-sans text-sm text-ink-3">
              {connectedFamily === "ble_scale"
                ? t`Live weight capture while connected. Samples are saved in short batches and sent only when you tap “Retry upload”.`
                : t`Live capture while connected. Samples are saved in short batches and sent only when you tap “Retry upload”. There is no history backfill.`}
            </Text>
          ) : connectedFamily === "colmi_ring" ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`Ring history (steps, heart rate and sleep) syncs automatically while connected. Records are saved in batches and sent only when you tap “Retry upload”.`}
            </Text>
          ) : connectedFamily === "bangle_js" ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`Bangle.js history (steps and heart rate) syncs automatically while connected, and heart rate keeps recording live. Records are saved in batches and sent only when you tap “Retry upload”.`}
            </Text>
          ) : connectedFamily === "moyoung" ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`Moyoung history (heart rate and sleep) syncs automatically while connected. Steps are not synced because the watch only reports daily totals. Records are saved in batches and sent only when you tap “Retry upload”.`}
            </Text>
          ) : connectedFamily === "gloryfit" ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`GloryFit history (steps, heart rate and sleep) syncs automatically while connected. Records are saved in batches and sent only when you tap “Retry upload”.`}
            </Text>
          ) : connectedFamily === "huawei" &&
            snapshot.capabilities.stepsHistory &&
            canSyncSelected ? (
            <>
              <Text className="font-sans text-sm text-ink-3">
                {t`Huawei/Honor history (exact-minute steps, heart rate and sleep) downloads when you tap “Sync steps”. Records are saved in batches and sent only when you tap “Retry upload”.`}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Button onPress={handoffWithoutKey} isDisabled={busy || !canSyncSelected}>
                  <Button.Label>{t`Sync steps`}</Button.Label>
                </Button>
              </View>
            </>
          ) : connectedFamily === "huawei" ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`This Huawei/Honor model syncs over Bluetooth Classic upstream; this BLE-only stack supports connection checks only.`}
            </Text>
          ) : connectedFamily === "huami_legacy" && canSyncSelected ? (
            <>
              <Text className="font-sans text-sm text-ink-3">
                {t`Legacy Huami history (exact-minute steps, heart rate and sleep) downloads when you enter the device key and tap “Sync steps”. Records are saved in batches and sent only when you tap “Retry upload”.`}
              </Text>
              {authKeyPanel}
            </>
          ) : connectedFamily === "huami_legacy" ? (
            <Text className="font-sans text-sm text-ink-3">
              {t`Save a binding for this device to sync its legacy Huami history.`}
            </Text>
          ) : !snapshot.capabilities.stepsHistory || !snapshot.canSync ? (
            <Text className="font-sans text-sm text-ink-3">
              {connectedFamily === "garmin"
                ? t`Garmin support is limited to connection checks; step history sync is not implemented.`
                : t`Step sync is unavailable for this unrecognized device model.`}
            </Text>
          ) : canSyncSelected && (connectedFamily === "zepp_os" || connectedFamily === "xiaomi") ? (
            authKeyPanel
          ) : null
        ) : null}
        {snapshot.connectedDeviceId ? (
          <Button
            variant="outline"
            onPress={() => controller && run(() => controller.cancel(), true)}
          >
            <Button.Label>{t`Cancel / disconnect`}</Button.Label>
          </Button>
        ) : snapshot.isBusy && snapshot.phase !== "scanning" ? (
          <Button
            variant="outline"
            onPress={() => controller && run(() => controller.cancel(), true)}
          >
            <Button.Label>{t`Cancel`}</Button.Label>
          </Button>
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
        {snapshot.blockedIdentityEnvelopes > 0 ? (
          <Text className="font-sans text-sm text-ink-3">
            {t`${snapshot.blockedIdentityEnvelopes} older capture(s) lack device identity and are being held back. Confirming a binding will not release them; a new sync can capture steps again.`}
          </Text>
        ) : null}
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
          <Text className="font-sans text-xs text-ink-3">{t`Experimental; foreground use only. No model is hardware-verified.`}</Text>
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
  if (code === "HUAWEI_HISTORY_UNSUPPORTED")
    return "This Huawei/Honor model syncs over Bluetooth Classic upstream, which this BLE-only stack does not implement.";
  if (code === "HUAWEI_AUTH_UNSUPPORTED")
    return "This Huawei/Honor device negotiated an authentication mode that needs on-device confirmation or a PIN code, which is not implemented.";
  if (code === "HUAWEI_MAC_UNAVAILABLE")
    return "Huawei authentication needs the device MAC address, which this platform does not expose. Sync is only available on Android.";
  if (code === "HUAWEI_AUTH_FAILED")
    return "The Huawei/Honor device rejected the authentication exchange. Reconnect and try again.";
  if (code === "IDENTITY_REQUIRED")
    return "This older capture has no device identity and cannot be assigned automatically.";
  if (code === "IDENTITY_MISMATCH")
    return "The saved device identity does not match this device. Select a compatible binding or create a new one.";
  if (code === "GARMIN_HISTORY_UNSUPPORTED")
    return "Garmin connection checks are available, but step history sync is not implemented.";
  if (code === "BANGLE_JS_HISTORY_UNSUPPORTED")
    return "This Bangle.js watch connected, but its history syncs on connection rather than through a step sync action.";
  if (code === "HUAMI_AUTH_FAILED")
    return "The device rejected the authentication key. Check the 16-byte key and try again.";
  if (code === "HUAMI_LEGACY_HISTORY_FAILED")
    return "The legacy Huami history transfer did not complete. Reconnect and try again.";
  if (code === "HISTORY_UNSUPPORTED")
    return "This device connected, but step history sync is not supported for it.";
  return "Could not sync device steps. Try again.";
}
