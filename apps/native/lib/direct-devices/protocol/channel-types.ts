import type { HelioHistoryOptions, HelioLink } from "./types";

/** Negotiated, authenticated chunk channel used by the Helio history protocol. */
export interface HelioSessionChannel {
  readonly services: ReadonlyMap<number, boolean>;
  request(endpoint: number, payload: Uint8Array, accept: (payload: Uint8Array) => boolean, signal: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
}

export type OpenHelioChannelOptions = Pick<HelioHistoryOptions, "authKey" | "signal" | "onPhase"> & { requestTimeoutMs?: number };
export declare function openHelioChannel(link: HelioLink, options: OpenHelioChannelOptions, crypto?: import("../crypto/helio-session").HelioCryptoProvider): Promise<HelioSessionChannel>;
