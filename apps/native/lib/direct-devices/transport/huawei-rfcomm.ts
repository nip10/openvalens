/**
 * Huawei/Honor history over Bluetooth Classic (RFCOMM), Android only
 * (issue #422; decided 2026-11-13). The 41 models upstream registers on
 * `HuaweiBRCoordinator`/`HonorBRCoordinator` sync their service-0x07 history
 * over an RFCOMM socket with the same framing as BLE, so this only finds the
 * Classic device, bonds, opens the socket and runs the shared `HuaweiSession`
 * with `transport: "br"`. See docs/research/notes/Bluetooth Classic RFCOMM.
 *
 * AGPL-3.0-or-later (same as upstream Gadgetbridge).
 */

import type { BtClassicAdapter, RfcommLink } from "../../../modules/bt-classic";
import type { HuaweiModel } from "../models/huawei";
import { matchHuaweiDeviceName } from "../models/huawei";
import type { HuaweiRecord } from "../protocol/huawei";
import {
  createHuaweiSession,
  type HuaweiHiChainStore,
  type HuaweiSession,
  type HuaweiSessionOptions,
} from "./huawei";
import type { HuaweiLink } from "./huawei-link";
import type { PebbleBondAdapter } from "./pebble";

export const HUAWEI_BR_BOND_TIMEOUT_MS = 60_000;
export const HUAWEI_BR_CONNECT_TIMEOUT_MS = 15_000;

/** Adapts an RFCOMM socket to the byte link `HuaweiSession` speaks over. */
export class RfcommHuaweiLink implements HuaweiLink {
  /** A stream has no write MTU; frames go out whole. */
  readonly maxWriteBytes = Number.POSITIVE_INFINITY;

  constructor(private readonly socket: RfcommLink) {}

  subscribe(onBytes: (bytes: Uint8Array) => void, onFailure: () => void): () => void {
    return this.socket.subscribe(onBytes, (reason) => {
      if (reason !== "local") onFailure();
    });
  }

  async write(bytes: Uint8Array, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new Error("HUAWEI_CLOSED");
    await this.socket.write(bytes);
  }

  close(): Promise<void> {
    return this.socket.close();
  }
}

/**
 * The Classic address to connect to. A dual-mode watch's Classic and BLE
 * addresses may differ (spec §8), so prefer a bonded Classic device of the same
 * model, then the BLE address itself.
 */
export async function resolveHuaweiBrAddress(
  btClassic: BtClassicAdapter,
  model: HuaweiModel,
  bleAddress: string,
): Promise<string> {
  const bonded = await btClassic.listBonded().catch(() => []);
  const exact = bonded.find((device) => device.address.toUpperCase() === bleAddress.toUpperCase());
  if (exact) return exact.address;
  const sameModel = bonded.filter(
    (device) => device.name !== null && matchHuaweiDeviceName(device.name)?.id === model.id,
  );
  return sameModel.length === 1 ? sameModel[0]!.address : bleAddress;
}

export type HuaweiBrSyncOptions = Readonly<{
  model: HuaweiModel;
  /** The BLE address the watch was found and verified on (Android: its MAC). */
  bleAddress: string;
  deviceId: string;
  btClassic: BtClassicAdapter;
  bond: PebbleBondAdapter;
  onRecord: (record: HuaweiRecord) => void;
  signal: AbortSignal;
  /** Durable HiChain id and token (most BR watches authenticate with HiChain). */
  hichainStore?: HuaweiHiChainStore;
  onAuthPrompt?: (prompt: "confirm_on_watch") => void;
  createSession?: (options: HuaweiSessionOptions) => HuaweiSession;
  bondTimeoutMs?: number;
  connectTimeoutMs?: number;
}>;

/** Runs one Bluetooth Classic history sync; the socket is always closed after. */
export async function runHuaweiBrSync(options: HuaweiBrSyncOptions): Promise<void> {
  const { model, btClassic } = options;
  if (model.transport !== "br" || !model.sdpUuid) throw new Error("HUAWEI_HISTORY_UNSUPPORTED");
  if (!btClassic.isSupported()) throw new Error("HUAWEI_BR_UNSUPPORTED");
  const { signal } = options;
  const requestId = `huawei-br:${options.deviceId}`;
  const cancelled = () => {
    if (signal.aborted) throw new Error("CANCELLED");
  };
  const address = await resolveHuaweiBrAddress(btClassic, model, options.bleAddress);
  cancelled();
  // An abort during the bond wait releases it at once.
  const stopBondWait = () => void options.bond.cancelWait(requestId).catch(() => undefined);
  signal.addEventListener("abort", stopBondWait, { once: true });
  // A secure RFCOMM socket needs an authenticated (bonded) link.
  await options.bond
    .ensureBonded({
      nativeId: address,
      requestId,
      timeoutMs: options.bondTimeoutMs ?? HUAWEI_BR_BOND_TIMEOUT_MS,
    })
    .catch((error: unknown) => {
      if (signal.aborted) throw new Error("CANCELLED");
      // The shared bond module speaks Pebble codes; report Huawei ones.
      const code = error instanceof Error ? error.message : "";
      throw new Error(
        code === "PEBBLE_PAIRING_PERMISSION" ? "HUAWEI_BR_PERMISSION" : "HUAWEI_BR_PAIRING_FAILED",
        { cause: error },
      );
    })
    .finally(() => signal.removeEventListener("abort", stopBondWait));
  cancelled();
  const socket = await openWithRetry(btClassic, {
    address,
    uuid: model.sdpUuid,
    timeoutMs: options.connectTimeoutMs ?? HUAWEI_BR_CONNECT_TIMEOUT_MS,
    signal,
  });
  if (signal.aborted) {
    await socket.close().catch(() => undefined);
    throw new Error("CANCELLED");
  }
  const link = new RfcommHuaweiLink(socket);
  const session = (options.createSession ?? createHuaweiSession)({
    link,
    transport: "br",
    transactionsCrypted: model.transactionsCrypted,
    honorPake: model.honorPake,
    deviceId: options.deviceId,
    macAddress: address,
    onRecord: options.onRecord,
    hichainStore: options.hichainStore,
    onAuthPrompt: options.onAuthPrompt,
  });
  const onAbort = () => void session.close();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    cancelled();
    session.start();
    await session.whenDone();
    cancelled();
  } finally {
    signal.removeEventListener("abort", onAbort);
    await session.close().catch(() => undefined);
    await link.close().catch(() => undefined);
  }
}

/** The first connect right after bonding often fails (spec §6): retry once. */
async function openWithRetry(
  btClassic: BtClassicAdapter,
  args: { address: string; uuid: string; timeoutMs: number; signal: AbortSignal },
): Promise<RfcommLink> {
  const { signal, ...connect } = args;
  try {
    return await btClassic.openRfcomm({ ...connect, secure: true });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "BT_CLASSIC_CONNECT_FAILED") throw error;
    if (signal.aborted) throw new Error("CANCELLED");
    return btClassic.openRfcomm({ ...connect, secure: true });
  }
}
