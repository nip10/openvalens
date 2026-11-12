export type PebbleIdentity = Readonly<{
  family: "pebble";
  modelId: "pebble_classic_2" | "pebble_2_duo" | "pebble_time_2";
}>;

/** The only Pebble models whose health history can be captured (BLE / PPoGATT). */
export const PEBBLE_CAPTURE_MODEL_IDS: ReadonlySet<string> = new Set<PebbleIdentity["modelId"]>([
  "pebble_classic_2",
  "pebble_2_duo",
  "pebble_time_2",
]);

export function isPebbleCaptureIdentity(identity: {
  family: string;
  modelId: string;
}): identity is PebbleIdentity {
  return identity.family === "pebble" && PEBBLE_CAPTURE_MODEL_IDS.has(identity.modelId);
}

export type PebblePeer = Readonly<{
  nativeId: string;
  hardwareId: number;
  identity: PebbleIdentity;
}>;

export type PebblePacket = Readonly<{
  uuid: string;
  sessionTimestamp: number;
  logTag: 81 | 83 | 84;
  itemType: number;
  itemSize: number;
  data: Uint8Array;
}>;

export type PebbleDurableReceipt = Readonly<{
  durable: true;
  insertedItems: number;
  throughSeq: number;
}>;

export type PebblePacketSink = (packet: PebblePacket) => Promise<PebbleDurableReceipt>;

export type PebbleSessionOutcome =
  /**
   * The watch closed every health session and stayed quiet. Not proof of
   * complete history: rejected (NACKed) packets remain on the watch.
   */
  | Readonly<{
      status: "idle";
      receivedPackets: number;
      durableItems: number;
      rejectedPackets: number;
    }>
  | Readonly<{
      status: "failed";
      code: string;
      /** Present on PEBBLE_CAPTURE_STALLED: what was durably received before the stall. */
      receivedPackets?: number;
      durableItems?: number;
      rejectedPackets?: number;
    }>
  | Readonly<{ status: "cancelled" }>;

export interface DurablePebbleSession {
  prepare(signal: AbortSignal): Promise<PebblePeer>;
  capture(options: { signal: AbortSignal; sink: PebblePacketSink }): Promise<PebbleSessionOutcome>;
  close(): Promise<void>;
}
