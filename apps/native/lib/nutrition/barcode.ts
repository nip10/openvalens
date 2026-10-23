import type { MessageDescriptor } from "@lingui/core";
import type { BarcodeLookup } from "@openvalens/api/contracts/nutrition-foods";
import {
  BARCODE_COPY,
  describeBarcodeLookup,
  describeOfflineBarcode,
  parseBarcode,
  type BarcodeOutcome,
} from "@openvalens/api/presenters/food-lookup";

/**
 * Barcode scan and lookup logic for the mobile diary (Issue #75). Pure: the
 * camera, network and SQLite cache are injected, so this file has no Expo
 * imports and is unit-tested with Bun.
 *
 * - The camera is requested only when the member presses Scan; denial,
 *   missing hardware and camera errors all fall back to typed digits.
 * - A scan is accepted once per session, so a code held in view cannot start
 *   several lookups.
 * - Lookups need the network. Offline (or when the request fails), a code
 *   this device looked up before resolves from the account-scoped cache and
 *   is labelled as cached; anything else becomes a manual draft. Nothing is
 *   guessed, and barcodes are never logged.
 */

/** Retail product symbologies; QR and other 2D codes are not food barcodes. */
export const SCAN_BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

/**
 * Cache-key prefix for lookups, inside `DIARY_CACHE_PREFIX` (`nutritionDiary.`)
 * so "Clear diary data on this device" and sign-out remove them too.
 */
export const BARCODE_CACHE_PREFIX = "nutritionDiary.barcode:";

export function barcodeCacheKey(barcode: string): string {
  return `${BARCODE_CACHE_PREFIX}${barcode}`;
}

export type CameraPermission = { granted: boolean; canAskAgain: boolean } | null;

export type ScannerState = "ready" | "denied" | "blocked" | "unavailable";

/** What the scanner shows after the member asked for the camera. */
export function scannerStateFor(available: boolean, permission: CameraPermission): ScannerState {
  if (!available) return "unavailable";
  if (permission?.granted) return "ready";
  return permission?.canAskAgain === false ? "blocked" : "denied";
}

export function scannerMessage(state: Exclude<ScannerState, "ready">): MessageDescriptor {
  return state === "unavailable" ? BARCODE_COPY.cameraUnavailable : BARCODE_COPY.cameraDenied;
}

/**
 * Accepts the first valid retail barcode a scanning session reports and
 * ignores every later report (repeats and other codes) until `reset`.
 */
export function createScanGate() {
  let accepted: string | null = null;
  return {
    accept(data: string): string | null {
      if (accepted !== null) return null;
      const parsed = parseBarcode(data);
      if (!parsed.ok) return null;
      accepted = parsed.barcode;
      return accepted;
    },
    reset() {
      accepted = null;
    },
  };
}

export type BarcodeResolution =
  | { kind: "outcome"; outcome: BarcodeOutcome }
  | { kind: "invalid"; message: MessageDescriptor };

export type BarcodeResolver = {
  online: boolean;
  lookup: (barcode: string) => Promise<BarcodeLookup>;
  readCached: (barcode: string) => { data: BarcodeLookup; savedAt: number } | null;
  writeCached: (barcode: string, result: BarcodeLookup) => void;
};

function isInvalidInput(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "INVALID_INPUT";
}

/** Resolves typed or scanned text to the next step; never throws for a failed lookup. */
export async function resolveBarcode(
  raw: string,
  deps: BarcodeResolver,
): Promise<BarcodeResolution> {
  const parsed = parseBarcode(raw);
  if (!parsed.ok) return { kind: "invalid", message: parsed.error };
  const { barcode } = parsed;
  const offline = () => ({
    kind: "outcome" as const,
    outcome: describeOfflineBarcode(barcode, deps.readCached(barcode)),
  });
  if (!deps.online) return offline();
  let result: BarcodeLookup;
  try {
    result = await deps.lookup(barcode);
  } catch (error) {
    if (isInvalidInput(error)) return { kind: "invalid", message: BARCODE_COPY.invalid };
    return offline();
  }
  // Only hits are kept: an offline miss is reported as a miss either way.
  if (result.status === "found") deps.writeCached(barcode, result);
  return { kind: "outcome", outcome: describeBarcodeLookup(result) };
}
