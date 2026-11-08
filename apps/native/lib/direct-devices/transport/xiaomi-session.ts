/*  Copyright (C) 2023-2026 José Rebelo, Yoran Vulker

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * BLE transport for the Xiaomi history runner.
 *
 * Upstream:
 * - `XiaomiCharacteristicV1.java` (V1 chunking, encryption, ACKs)
 * - `XiaomiBleProtocolV2.java` / `XiaomiSppPacketV2.java` (V2 SPP framing)
 * - `XiaomiAuthService.java` (handshake)
 * - `XiaomiActivityFileFetcher.java` (activity chunk reassembly)
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/xiaomi/
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * V1 and V2 are both supported. Nothing here is hardware-validated.
 */

import type { Device } from "react-native-ble-plx";

import {
  loadXiaomiCrypto,
  runXiaomiAuthHandshake,
  xiaomiCcmDecrypt,
  xiaomiCcmEncrypt,
  xiaomiCtrCrypt,
  type XiaomiAuthCrypto,
  type XiaomiSessionKeys,
} from "../crypto/xiaomi-auth";
import { decodeCommand, encodeCommand, type XiaomiCommand } from "../protocol/xiaomi-proto";
import type { XiaomiHistoryTransport } from "../protocol/xiaomi-history";
import {
  decodeXiaomiV2DataPacket,
  encodeXiaomiV1Single,
  encodeXiaomiV2DataPacket,
  encodeXiaomiV2Frame,
  encodeXiaomiV2SessionConfigStart,
  NativeXiaomiLink,
  parseXiaomiV1Packet,
  XIAOMI_V1_ACK,
  XIAOMI_V1_CHUNK_END_ACK,
  XIAOMI_V1_CHUNK_START_ACK,
  XIAOMI_V2_CHANNEL_ACTIVITY,
  XIAOMI_V2_CHANNEL_PROTOBUF,
  XIAOMI_V2_OPCODE_SEND_ENCRYPTED,
  XIAOMI_V2_OPCODE_SEND_PLAINTEXT,
  XIAOMI_V2_PACKET_ACK,
  XIAOMI_V2_PACKET_DATA,
  XIAOMI_V2_PACKET_SESSION_CONFIG,
  XiaomiV1Reassembler,
  XiaomiV2StreamDecoder,
  type XiaomiBleProfile,
  type XiaomiLink,
} from "./xiaomi-link";

const MAX_ACTIVITY_BYTES = 1024 * 1024;
const MAX_ACTIVITY_CHUNKS = 4096;

type ActivityAssembly = {
  total: number;
  next: number;
  size: number;
  parts: Uint8Array[];
};

function appendChunk(
  assembly: ActivityAssembly | null,
  total: number,
  num: number,
  payload: Uint8Array,
): { assembly: ActivityAssembly | null; complete: Uint8Array | null } {
  if (!Number.isInteger(total) || total < 1 || total > MAX_ACTIVITY_CHUNKS) {
    throw new Error("XIAOMI_ACTIVITY_CHUNK_COUNT");
  }
  if (!Number.isInteger(num) || num < 1 || num > total) {
    throw new Error("XIAOMI_ACTIVITY_CHUNK_INDEX");
  }
  let current = assembly;
  if (num === 1) {
    current = { total, next: 1, size: 0, parts: [] };
  }
  if (!current || current.total !== total || current.next !== num) {
    throw new Error("XIAOMI_ACTIVITY_CHUNK_SEQUENCE");
  }
  current.size += payload.length;
  if (current.size > MAX_ACTIVITY_BYTES) throw new Error("XIAOMI_ACTIVITY_TOO_LARGE");
  current.parts.push(payload);
  current.next += 1;
  if (num !== total) return { assembly: current, complete: null };
  const out = new Uint8Array(current.size);
  let offset = 0;
  for (const part of current.parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return { assembly: null, complete: out };
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

export type XiaomiHistoryTransportOptions = {
  authKey: Uint8Array;
  crypto?: XiaomiAuthCrypto;
  phoneApiLevel?: number;
  phoneName?: string;
  region?: string;
  /** V2 session-config response timeout; V1 does not use it. */
  sessionTimeoutMs?: number;
};

export class XiaomiBleHistoryTransport implements XiaomiHistoryTransport {
  private readonly link: XiaomiLink;
  private readonly profile: XiaomiBleProfile;
  private readonly options: XiaomiHistoryTransportOptions;
  private crypto: XiaomiAuthCrypto | null = null;
  private keys: XiaomiSessionKeys | null = null;
  private encryptedIndex = 1;
  private v2Sequence = 0;
  private started = false;

  private readonly commandQueue: XiaomiCommand[] = [];
  private pendingCommand: {
    resolve: (command: XiaomiCommand) => void;
    reject: (error: Error) => void;
  } | null = null;
  private commandFailure: Error | null = null;

  private pendingActivity: {
    resolve: (bytes: Uint8Array) => void;
    reject: (error: Error) => void;
  } | null = null;
  private activityFailure: Error | null = null;
  private activityAssembly: ActivityAssembly | null = null;

  private readonly v1Commands = new XiaomiV1Reassembler();
  private readonly v2Stream = new XiaomiV2StreamDecoder();
  private sessionWaiter: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(link: XiaomiLink, profile: XiaomiBleProfile, options: XiaomiHistoryTransportOptions) {
    this.link = link;
    this.profile = profile;
    this.options = options;
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.crypto = this.options.crypto ?? (await loadXiaomiCrypto());
    if (signal.aborted) throw new Error("CANCELLED");

    if (this.profile.protocol === "v1") {
      this.unsubscribes.push(
        this.link.subscribe(
          "command_read",
          (bytes) => this.onV1CommandBytes(bytes),
          () => this.fail(new Error("XIAOMI_TRANSPORT_ERROR")),
        ),
      );
      if (this.profile.activityDataUuid) {
        this.unsubscribes.push(
          this.link.subscribe(
            "activity_data",
            (bytes) => this.onV1ActivityBytes(bytes),
            () => this.fail(new Error("XIAOMI_TRANSPORT_ERROR")),
          ),
        );
      }
    } else {
      this.unsubscribes.push(
        this.link.subscribe(
          "command_read",
          (bytes) => this.onV2Bytes(bytes),
          () => this.fail(new Error("XIAOMI_TRANSPORT_ERROR")),
        ),
      );
      await this.startV2Session(signal);
    }

    const keys = await runXiaomiAuthHandshake(
      {
        send: (command) => this.sendCommand(command),
        receive: (authSignal) => this.nextCommand(authSignal),
      },
      {
        crypto: this.crypto,
        secretKey: this.options.authKey,
        phoneApiLevel: this.options.phoneApiLevel ?? 34,
        phoneName: this.options.phoneName ?? "OpenValens",
        region: this.options.region ?? "US",
        signal,
      },
    );
    this.keys = keys;
  }

  async sendCommand(command: XiaomiCommand): Promise<void> {
    const plain = encodeCommand(command);
    if (this.profile.protocol === "v1") {
      const encrypted = this.keys !== null;
      if (encrypted && this.crypto) {
        const nonceIndex = this.encryptedIndex & 0xffff;
        this.encryptedIndex = (this.encryptedIndex + 1) & 0xffff;
        const payload = xiaomiCcmEncrypt(
          this.crypto,
          this.keys!.encryptionKey,
          this.keys!.encryptionNonce,
          nonceIndex,
          plain,
        );
        await this.link.write(
          "command_write",
          encodeXiaomiV1Single(payload, { encrypted: true, nonceIndex }),
          new AbortController().signal,
        );
        return;
      }
      await this.link.write(
        "command_write",
        encodeXiaomiV1Single(plain, { encrypted: false }),
        new AbortController().signal,
      );
      return;
    }

    // V2: auth commands are always plaintext on channel 1; normal commands are
    // AES-CTR encrypted after the handshake.
    const auth = command.type === 1;
    const encrypted = !auth && this.keys !== null;
    const payload =
      encrypted && this.crypto
        ? xiaomiCtrCrypt(this.crypto, this.keys!.encryptionKey, plain)
        : plain;
    const data = encodeXiaomiV2DataPacket(
      XIAOMI_V2_CHANNEL_PROTOBUF,
      encrypted ? XIAOMI_V2_OPCODE_SEND_ENCRYPTED : XIAOMI_V2_OPCODE_SEND_PLAINTEXT,
      payload,
    );
    await this.link.write(
      "command_write",
      encodeXiaomiV2Frame(XIAOMI_V2_PACKET_DATA, this.v2Sequence++ & 0xff, data),
      new AbortController().signal,
    );
  }

  nextCommand(signal: AbortSignal): Promise<XiaomiCommand> {
    if (this.commandFailure) return Promise.reject(this.commandFailure);
    const queued = this.commandQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("CANCELLED"));
        return;
      }
      const onAbort = () => {
        if (this.pendingCommand?.reject === reject) this.pendingCommand = null;
        reject(new Error("CANCELLED"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingCommand = {
        resolve: (command) => {
          signal.removeEventListener("abort", onAbort);
          resolve(command);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
    });
  }

  nextActivityFile(signal: AbortSignal): Promise<Uint8Array> {
    if (this.activityFailure) return Promise.reject(this.activityFailure);
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("CANCELLED"));
        return;
      }
      const onAbort = () => {
        if (this.pendingActivity?.reject === reject) this.pendingActivity = null;
        reject(new Error("CANCELLED"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingActivity = {
        resolve: (bytes) => {
          signal.removeEventListener("abort", onAbort);
          resolve(bytes);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
    });
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.pendingCommand?.reject(new Error("CANCELLED"));
    this.pendingCommand = null;
    this.pendingActivity?.reject(new Error("CANCELLED"));
    this.pendingActivity = null;
    this.sessionWaiter?.reject(new Error("CANCELLED"));
    this.sessionWaiter = null;
    await this.link.close();
  }

  private fail(error: Error): void {
    this.commandFailure = error;
    this.activityFailure = error;
    this.pendingCommand?.reject(error);
    this.pendingCommand = null;
    this.pendingActivity?.reject(error);
    this.pendingActivity = null;
    this.sessionWaiter?.reject(error);
    this.sessionWaiter = null;
  }

  private dispatchCommand(command: XiaomiCommand): void {
    if (this.pendingCommand) {
      const pending = this.pendingCommand;
      this.pendingCommand = null;
      pending.resolve(command);
    } else {
      this.commandQueue.push(command);
    }
  }

  private dispatchActivity(bytes: Uint8Array): void {
    if (this.pendingActivity) {
      const pending = this.pendingActivity;
      this.pendingActivity = null;
      pending.resolve(bytes);
    } else {
      this.activityFailure = new Error("XIAOMI_ACTIVITY_UNEXPECTED");
    }
  }

  private decryptV1(payload: Uint8Array, index?: number): Uint8Array {
    if (!this.keys || !this.crypto) return payload;
    if (index !== undefined) {
      return xiaomiCcmDecrypt(
        this.crypto,
        this.keys.decryptionKey,
        this.keys.decryptionNonce,
        index,
        payload,
      );
    }
    try {
      return xiaomiCcmDecrypt(
        this.crypto,
        this.keys.decryptionKey,
        this.keys.decryptionNonce,
        0,
        payload,
      );
    } catch {
      if (payload.length < 2) throw new Error("XIAOMI_DECRYPT");
      const packetIndex = readUint16(payload, 0);
      return xiaomiCcmDecrypt(
        this.crypto,
        this.keys.decryptionKey,
        this.keys.decryptionNonce,
        packetIndex,
        payload.slice(2),
      );
    }
  }

  private onV1CommandBytes(bytes: Uint8Array): void {
    try {
      const packet = parseXiaomiV1Packet(bytes);
      switch (packet.kind) {
        case "chunk_start":
          this.v1Commands.start(packet.encrypted, packet.count);
          void this.link.write(
            "command_read",
            XIAOMI_V1_CHUNK_START_ACK,
            new AbortController().signal,
          );
          return;
        case "chunk": {
          const encrypted = this.v1Commands.encryptedChunks;
          const complete = this.v1Commands.accept(packet.index, packet.payload);
          if (!complete) return;
          void this.link.write(
            "command_read",
            XIAOMI_V1_CHUNK_END_ACK,
            new AbortController().signal,
          );
          const plain = encrypted ? this.decryptV1(complete) : complete;
          this.dispatchCommand(decodeCommand(plain));
          return;
        }
        case "single": {
          void this.link.write("command_read", XIAOMI_V1_ACK, new AbortController().signal);
          const plain = packet.encrypted
            ? this.decryptV1(packet.payload, packet.nonceIndex ?? 0)
            : packet.payload;
          this.dispatchCommand(decodeCommand(plain));
          return;
        }
        case "chunk_ack":
        case "ack":
          return;
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("XIAOMI_COMMAND_ERROR"));
    }
  }

  private onV1ActivityBytes(bytes: Uint8Array): void {
    try {
      if (bytes.length < 4) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
      const total = readUint16(bytes, 0);
      const num = readUint16(bytes, 2);
      const result = appendChunk(this.activityAssembly, total, num, bytes.slice(4));
      this.activityAssembly = result.assembly;
      if (result.complete) {
        const plain =
          this.profile.encrypted && this.keys ? this.decryptV1(result.complete) : result.complete;
        this.dispatchActivity(plain);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("XIAOMI_ACTIVITY_ERROR"));
    }
  }

  private async startV2Session(signal: AbortSignal): Promise<void> {
    const session = new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error("CANCELLED"));
        return;
      }
      const timer = setTimeout(() => {
        this.sessionWaiter = null;
        reject(new Error("XIAOMI_SESSION_TIMEOUT"));
      }, this.options.sessionTimeoutMs ?? 10_000);
      const onAbort = () => {
        clearTimeout(timer);
        this.sessionWaiter = null;
        reject(new Error("CANCELLED"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.sessionWaiter = {
        resolve: () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          this.sessionWaiter = null;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          this.sessionWaiter = null;
          reject(error);
        },
      };
    });
    await this.link.write(
      "command_write",
      encodeXiaomiV2Frame(XIAOMI_V2_PACKET_SESSION_CONFIG, 0, encodeXiaomiV2SessionConfigStart()),
      signal,
    );
    await session;
  }

  private onV2Bytes(bytes: Uint8Array): void {
    try {
      for (const frame of this.v2Stream.push(bytes)) {
        if (frame.packetType === XIAOMI_V2_PACKET_SESSION_CONFIG) {
          this.sessionWaiter?.resolve();
          continue;
        }
        if (frame.packetType !== XIAOMI_V2_PACKET_DATA) continue;
        const data = decodeXiaomiV2DataPacket(frame.payload);
        const payload =
          data.opCode === XIAOMI_V2_OPCODE_SEND_ENCRYPTED && this.keys && this.crypto
            ? xiaomiCtrCrypt(this.crypto, this.keys.decryptionKey, data.payload)
            : data.payload;
        // ACK every data frame, as upstream does.
        void this.link.write(
          "command_write",
          encodeXiaomiV2Frame(XIAOMI_V2_PACKET_ACK, frame.sequence, new Uint8Array(0)),
          new AbortController().signal,
        );
        if (data.channel === XIAOMI_V2_CHANNEL_PROTOBUF) {
          this.dispatchCommand(decodeCommand(payload));
        } else if (data.channel === XIAOMI_V2_CHANNEL_ACTIVITY) {
          if (payload.length < 4) throw new Error("XIAOMI_ACTIVITY_TRUNCATED");
          const total = readUint16(payload, 0);
          const num = readUint16(payload, 2);
          const result = appendChunk(this.activityAssembly, total, num, payload.slice(4));
          this.activityAssembly = result.assembly;
          if (result.complete) this.dispatchActivity(result.complete);
        }
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error("XIAOMI_V2_ERROR"));
    }
  }
}

export function createXiaomiBleHistoryTransport(
  link: XiaomiLink,
  profile: XiaomiBleProfile,
  options: XiaomiHistoryTransportOptions,
): XiaomiBleHistoryTransport {
  return new XiaomiBleHistoryTransport(link, profile, options);
}

/** Convenience for the setup controller. */
export function createNativeXiaomiHistoryTransport(
  device: Device,
  profile: XiaomiBleProfile,
  options: XiaomiHistoryTransportOptions,
  manager?: ConstructorParameters<typeof NativeXiaomiLink>[2],
): XiaomiBleHistoryTransport {
  return new XiaomiBleHistoryTransport(
    new NativeXiaomiLink(device, profile, manager),
    profile,
    options,
  );
}
