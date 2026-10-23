import { BARCODE_COPY } from "@openvalens/api/presenters/food-lookup";
import { Trans, useLingui } from "@lingui/react/macro";
import { Camera, CameraView } from "expo-camera";
import { Button } from "heroui-native";
import { useEffect, useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";

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
      <Text className="text-sm text-muted-foreground" accessibilityLiveRegion="polite">
        {i18n._(BARCODE_COPY.cameraPrompt)}
      </Text>
    );

  if (state !== "ready") {
    const message = i18n._(state === "failed" ? BARCODE_COPY.cameraFailed : scannerMessage(state));
    return (
      <View className="gap-2" accessibilityRole="alert">
        <Text className="text-sm text-foreground" accessibilityLiveRegion="polite">
          {message}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {state === "blocked" || state === "denied" ? (
            <Button size="sm" variant="secondary" onPress={() => void Linking.openSettings()}>
              <Trans>Open Settings</Trans>
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onPress={() => onClose(message)}>
            <Trans>Type digits instead</Trans>
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-2">
      <Text className="text-sm text-muted-foreground">{i18n._(BARCODE_COPY.cameraPrompt)}</Text>
      <View
        className="h-56 overflow-hidden rounded-lg border border-border"
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
      <Button size="sm" variant="secondary" onPress={() => onClose(null)}>
        {i18n._(BARCODE_COPY.stopScan)}
      </Button>
    </View>
  );
}
