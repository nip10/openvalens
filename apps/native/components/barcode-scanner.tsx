import { BARCODE_COPY } from "@openvalens/api/presenters/food-lookup";
import { Trans, useLingui } from "@lingui/react/macro";
import { Camera, CameraView } from "expo-camera";
import { Button } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { Camera as CameraIcon, Keyboard, ScanBarcode, Settings } from "lucide-react-native";
import { Linking, Text, View } from "react-native";

import { Icon, Sheet, ToneIcon } from "@/components/bloom";

import {
  SCAN_BARCODE_TYPES,
  createScanGate,
  scannerMessage,
  scannerStateFor,
  type ScannerState,
} from "@/lib/nutrition/barcode";

/**
 * One deliberate scanning session (Issue #75). Mounted only after the member
 * presses Scan, so camera permission is never requested at startup; the
 * camera stops as soon as a code is read or the member closes the scanner.
 * Every failure (denied, unavailable, camera error) shows a message and
 * leaves typed digits as the way forward. The code is never logged.
 */
export function BarcodeScanner({
  onScanned,
  onClose,
}: {
  onScanned: (barcode: string) => void;
  onClose: (message: string | null) => void;
}) {
  const [state, setState] = useState<ScannerState | "asking" | "failed">("asking");
  const gate = useMemo(() => createScanGate(), []);
  const { t, i18n } = useLingui();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let available = true;
      try {
        available = await CameraView.isAvailableAsync();
      } catch {
        // Not implemented on every platform; the camera reports mount errors instead.
      }
      let permission = null;
      if (available) {
        try {
          // Asked here, after the member pressed Scan; never at startup.
          permission = await Camera.requestCameraPermissionsAsync();
        } catch {
          permission = null;
        }
      }
      if (!cancelled) setState(scannerStateFor(available, permission));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "asking")
    return (
      <Sheet className="flex-row items-center gap-3 p-4">
        <ToneIcon icon={CameraIcon} tone="food" size="sm" />
        <Text className="flex-1 font-sans text-sm text-ink-3" accessibilityLiveRegion="polite">
          {i18n._(BARCODE_COPY.cameraPrompt)}
        </Text>
      </Sheet>
    );

  if (state !== "ready") {
    const message = i18n._(state === "failed" ? BARCODE_COPY.cameraFailed : scannerMessage(state));
    return (
      <View
        className="gap-3 rounded-3xl border border-rule-2 bg-paper-2 p-4"
        accessibilityRole="alert"
      >
        <View className="flex-row items-start gap-3">
          <ToneIcon icon={CameraIcon} tone="food" size="sm" />
          <Text className="flex-1 font-sans text-sm text-ink-2" accessibilityLiveRegion="polite">
            {message}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {state === "blocked" || state === "denied" ? (
            <Button size="sm" variant="outline" onPress={() => void Linking.openSettings()}>
              <Icon icon={Settings} size={16} color="ink-2" />
              <Button.Label>
                <Trans>Open Settings</Trans>
              </Button.Label>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onPress={() => onClose(message)}>
            <Icon icon={Keyboard} size={16} color="ink-2" />
            <Button.Label>
              <Trans>Type digits instead</Trans>
            </Button.Label>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Icon icon={ScanBarcode} size={16} color="food" />
        <Text className="flex-1 font-sans text-sm text-ink-3">
          {i18n._(BARCODE_COPY.cameraPrompt)}
        </Text>
      </View>
      <View
        className="h-56 overflow-hidden rounded-3xl border border-rule"
        accessible
        accessibilityLabel={t`Camera view for scanning a barcode`}
      >
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: [...SCAN_BARCODE_TYPES] }}
          onBarcodeScanned={(result) => {
            const barcode = gate.accept(result.data);
            if (barcode) onScanned(barcode);
          }}
          onMountError={() => setState("failed")}
        />
      </View>
      <Button size="sm" variant="outline" onPress={() => onClose(null)}>
        <Button.Label>{i18n._(BARCODE_COPY.stopScan)}</Button.Label>
      </Button>
    </View>
  );
}
