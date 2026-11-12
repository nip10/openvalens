import type { Device, Characteristic, Subscription } from "react-native-ble-plx";
import type { HelioLink } from "../protocol/types";
import { ACTIVITY_CONTROL, ACTIVITY_DATA, CHUNK_READ, CHUNK_WRITE, FEE0 } from "../protocol/codec";

type WriteDevice = Pick<
  Device,
  | "monitorCharacteristicForService"
  | "writeCharacteristicWithResponseForService"
  | "writeCharacteristicWithoutResponseForService"
> & { mtu?: number };
type TransactionManager = { cancelTransaction(id: string): void };
function decode(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const out: number[] = [];
  let bits = 0,
    buffer = 0;
  for (const c of value.replace(/=+$/, "")) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("INVALID_BLE_DATA");
    buffer = (buffer << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}
function encode(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1],
      c = bytes[i + 2];
    out +=
      alphabet[a >> 2] +
      alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] +
      (b === undefined
        ? "=="
        : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)] + (c === undefined ? "=" : alphabet[c & 63]));
  }
  return out;
}
export class NativeHelioLink implements HelioLink {
  readonly maxWriteBytes: number;
  private queue: Promise<void> = Promise.resolve();
  private readonly subscriptions = new Set<Subscription>();
  private transaction = 0;
  constructor(
    private readonly device: WriteDevice,
    private readonly manager?: TransactionManager,
  ) {
    this.maxWriteBytes = Math.min(512, Math.max(23, device.mtu ?? 23)) - 3;
  }
  subscribe(
    characteristic: "chunk_read" | "activity_data" | "activity_control",
    onBytes: (bytes: Uint8Array) => void,
    onFailure: () => void,
  ): () => void {
    const uuid =
      characteristic === "chunk_read"
        ? CHUNK_READ
        : characteristic === "activity_control"
          ? ACTIVITY_CONTROL
          : ACTIVITY_DATA;
    const subscription = this.device.monitorCharacteristicForService(
      FEE0,
      uuid,
      (error, value: Characteristic | null) => {
        if (error || !value?.value) {
          onFailure();
          return;
        }
        try {
          onBytes(decode(value.value));
        } catch {
          onFailure();
        }
      },
    );
    this.subscriptions.add(subscription);
    return () => {
      subscription.remove();
      this.subscriptions.delete(subscription);
    };
  }
  write(
    characteristic: "chunk_write" | "chunk_read" | "activity_control",
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> {
    const task = this.queue.then(async () => {
      if (signal.aborted) throw new Error("CANCELLED");
      const uuid =
        characteristic === "chunk_write"
          ? CHUNK_WRITE
          : characteristic === "activity_control"
            ? ACTIVITY_CONTROL
            : CHUNK_READ;
      const write =
        characteristic === "chunk_read"
          ? this.device.writeCharacteristicWithoutResponseForService
          : this.device.writeCharacteristicWithResponseForService;
      const transactionId = `helio-${++this.transaction}`;
      const cancel = () => {
        try {
          this.manager?.cancelTransaction(transactionId);
        } catch {
          /* native cancellation is best effort */
        }
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await write.call(this.device, FEE0, uuid, encode(bytes), transactionId);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
      if (signal.aborted) throw new Error("CANCELLED");
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
  async close(): Promise<void> {
    for (const item of this.subscriptions) item.remove();
    this.subscriptions.clear();
    await this.queue;
  }
}
