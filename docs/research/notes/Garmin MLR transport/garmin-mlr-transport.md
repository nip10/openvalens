# Garmin BLE transport: ML, MLR (Multi-Link Reliable) and what our 190 models need

Checked: 2026-11-13. For issue #421.

Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. I downloaded each file below as raw bytes from `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/<sha>/<path>` and read it directly. Nothing was executed or built. All upstream line numbers refer to that commit. Upstream is AGPL-3.0-or-later, and so is OpenValens.

I also read one secondary source: the Gadgetbridge protocol page `https://gadgetbridge.org/internals/specifics/garmin-protocol/` (sections "Multi-Link Protocol" and "Multi-Link Reliable Protocol"). It is the live website, not pinned, and `MlrCommunicator.java:17` links to it as the reference. I cite it as `Docs#<section>`.

Notation:

- **INFERRED** means I deduced it and did not read it in source.
- **UNKNOWN** means neither the source nor the docs settle it.
- Everything else is read from the cited line.

## 0. Path aliases used in citations

| Alias      | Path at the pin                                                                |
| ---------- | ------------------------------------------------------------------------------ |
| `G/`       | `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`                      |
| `Sup`      | `G/service/devices/garmin/GarminSupport.java`                                  |
| `V1`       | `G/service/devices/garmin/communicator/v1/CommunicatorV1.java`                 |
| `V2`       | `G/service/devices/garmin/communicator/v2/CommunicatorV2.java`                 |
| `Mlr`      | `G/service/devices/garmin/communicator/v2/MlrCommunicator.java`                |
| `Cobs`     | `G/service/devices/garmin/communicator/CobsCoDec.java`                         |
| `ICom`     | `G/service/devices/garmin/communicator/ICommunicator.java`                     |
| `Rfcomm`   | `G/service/devices/garmin/GarminRfcommListener.java`                           |
| `DevInfo`  | `G/service/devices/garmin/messages/DeviceInformationMessage.java`              |
| `Gfdi`     | `G/service/devices/garmin/messages/GFDIMessage.java`                           |
| `FileSync` | `G/service/devices/garmin/FileSyncServiceHandler.kt`                           |
| `Coord`    | `G/devices/garmin/GarminCoordinator.java`                                      |
| `Prefs`    | `G/devices/garmin/GarminPreferences.java`                                      |
| `Settings` | `G/devices/garmin/GarminDeviceSettings.kt`                                     |
| `W/`       | `G/devices/garmin/watches/` (per-model coordinators)                           |
| `ours/`    | `apps/native/lib/direct-devices/` in this repo (current `HEAD` of this branch) |
| `UI`       | `apps/native/components/direct-device-settings.tsx` in this repo               |

## 1. Short answer

1. **Upstream has no per-model transport flag.** The transport generation is chosen by GATT discovery: the ML service first, then the V1 and V0 GFDI services (`Sup:377-391`). MLR is not a separate GATT profile. It is negotiated **per ML service registration**: the phone asks for it with a `reliable = 0x02` byte in `REGISTER_ML_REQ`, and the watch grants it with a non-zero `reliable` byte in `REGISTER_ML_RESP` (`V2:677-685`, `V2:368-430`, `Docs#register-mlmlr-service-request`).
2. **The phone opts in to MLR.** Upstream asks for MLR when the `garmin_mlr` device preference is on. That preference defaults to `true` for every Garmin model at the pin (`Sup:729-731`, `Settings:181-187`). When MLR shipped, the default was `false` and the setting was experimental (commit `b352b164d4`, 2025-10-02, `mlrEnabled()` returned `getBoolean("garmin_mlr", false)`). So upstream ran plain ML on every V2 watch until late 2025.
3. **Our code never asks for MLR.** `buildGarminMlRegisterService(GARMIN_ML_SERVICE_GFDI)` is called with the default `reliable = false` (`ours/transport/garmin.ts:305-307`, `ours/protocol/garmin.ts:499-510`). The docs say MLR is used only "when requested upon service registration and supported by a device" (`Docs#multi-link-reliable-protocol`). So the `GARMIN_MLR_UNSUPPORTED` branch (`ours/transport/garmin.ts:314-315`) should be unreachable on a conforming watch (INFERRED). Today every ML watch gets plain ML.
4. **Models that need MLR:** by source evidence, **0 of our 190** need it to connect or to run the legacy GFDI file download that we implement. **5 of our 157 sync-enabled models** have upstream coordinators that force MLR on (`Coord:122-131`), because "new sync protocol without MLR fails to sync large workouts" (`Coord:127`). Those 5 are `garmin_cirqa`, `garmin_d2_air_x15`, `garmin_venu_4`, `garmin_venu_x1` and `garmin_vivoactive_6`. MLR matters for them only together with the protobuf "new sync protocol", which we have not implemented. **The other 152 sync models** work with our existing ML transport, provided they expose the ML service. Two of them (`garmin_forerunner_620`, `garmin_vivomove_hr`) are named upstream as V0 and V1 devices, and we refuse those with `GARMIN_ML_REQUIRED`. See section 6.
5. **MLR in one line:** each GATT write or notification gets a 2-byte header `1HHHRRRR RRSSSSSS`: an MLR flag, a 3-bit handle, a 6-bit request number (the cumulative ACK) and a 6-bit sequence number. On top of that sits a go-back-N sliding window of 32, an ACK after 5 packets or 20 ms, a 1 s retransmission timeout that doubles up to 20 s, and a window that halves on every timeout. The GFDI payload inside is still COBS-encoded GFDI with a CRC-16, exactly as on ML (`Mlr:22-33`, `Mlr:318-331`, `V2:170-173`, `V2:498-502`).

## 2. Transport generations upstream

### 2.1 Generations and GATT layout

| Name used here            | Upstream class | Service UUID                                                 | Characteristics (notify / write)                                                | Framing per GATT packet                          | Evidence                                             |
| ------------------------- | -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| GFDI V0                   | `V1`           | `9b012401-bc30-ce9a-e111-0f67e491abde`                       | `4acbcd28-7425-868e-f447-915c8f00d0cb` / `df334c80-e6a7-d082-274d-78fc66f85e16` | Raw COBS fragments, no prefix                    | `V1:22-25`, `V1:83-103` ("Vivofit / Forerunner 620") |
| GFDI V1                   | `V1`           | `6a4e2401-667b-11e3-949a-0800200c9a66`                       | `6a4ecd28-…` / `6a4e4c80-…`                                                     | Raw COBS fragments, no prefix                    | `V1:27-30` ("Vivomove HR")                           |
| ML (Multi-Link, "V2")     | `V2`           | `6a4e2800-667b-11e3-949a-0800200c9a66`                       | One pair out of `6a4e2810…2814` / `6a4e2820…2824`, where write = notify + 0x10  | `[handle][COBS fragment]`, handle 0 = management | `V2:67-83`, `V2:122-143`, `V2:176-189`               |
| MLR (Multi-Link Reliable) | `V2` + `Mlr`   | same as ML                                                   | same pair as ML                                                                 | `[1HHHRRRR][RRSSSSSS][fragment]`                 | `V2:199-220`, `Mlr:318-331`                          |
| RFCOMM ("dual channel")   | `Rfcomm`       | SPP UUID `deab91e4-670f-11e1-9ace-30bc4824019b` (Classic BT) | n/a (stream socket)                                                             | COBS-framed GFDI, as on V1                       | `Rfcomm:35-43`                                       |

Notes:

- Watches expose 2 to 5 ML characteristic pairs. The vivosmart 5 has only 2810/2820 and 2811/2821, and the Venu 3 adds 2813/2823 and 2814/2824 (`Docs#protocol-description`). Upstream takes the **first** pair whose notify and write characteristics both exist (`V2:125-137`). We do the same (`ours/transport/garmin-link.ts:114-160`).
- "V0/V1/V2" in our code means the same thing as above (`ours/transport/garmin-link.ts:63-74`). Upstream has no "V3" class. MLR is a mode of `CommunicatorV2`, not a new GATT profile. The docs' history paragraph calls MLR a "third version" that "adds some kind of sequence between the handle and the payload" (`Docs#garmin-protocol`).

### 2.2 How upstream picks a transport

`Sup:363-398` (`initializeDevice`):

1. Request MTU 515 when `PREF_ALLOW_HIGH_MTU` is on, which is the default (`Sup:373-375`).
2. `new CommunicatorV2(this).initializeDevice(builder)`. If any ML pair exists, enable notifications on it and write `CLOSE_ALL_REQ` (`V2:122-143`). Done.
3. Otherwise try `CommunicatorV1`, which tries the V1 UUIDs and then the V0 UUIDs (`V1:51-70`).
4. If neither exists, mark the device `NOT_CONNECTED` (`Sup:383-388`).

MLR is then decided per service, on `REGISTER_ML_RESP` (`V2:417-430`):

```java
if (reliable != 0) {
    // MLR mode - create reliable communicator
    ...
    final MlrCommunicator mlrComm = createMlrCommunicator(handle, serviceCallback);
    mlrCommunicators.put(handle, mlrComm);
    serviceCallback.onConnect(new MlrServiceWriter(registeredService, mlrComm));
} else {
    // Regular ML mode
    serviceCallback.onConnect(new MlServiceWriter(handle));
}
```

No coordinator, firmware version or product-number check sits in between. `Coord:125` and `Coord:128` carry TODOs to base the decision on `GarminCapability.SYNC_2` and on `DeviceInformationMessage.protocolVersion >= 150` instead. Neither TODO is implemented.

## 3. ML handle management (shared by ML and MLR)

All management messages travel on the selected ML pair with first byte `0x00`. Integers are little-endian. Upstream uses client id `2` (`V2:85`). The official app uses `1` (`Docs#multi-link-protocol`).

### 3.1 Request types (`V2:727-736`, `Docs#handle-management`)

| Byte | Name                | Direction                                         |
| ---- | ------------------- | ------------------------------------------------- |
| 0x00 | `REGISTER_ML_REQ`   | phone → watch                                     |
| 0x01 | `REGISTER_ML_RESP`  | watch → phone                                     |
| 0x02 | `CLOSE_HANDLE_REQ`  | phone → watch                                     |
| 0x03 | `CLOSE_HANDLE_RESP` | watch → phone, also unsolicited                   |
| 0x04 | `UNK_HANDLE`        | watch → phone (message on an unregistered handle) |
| 0x05 | `CLOSE_ALL_REQ`     | phone → watch                                     |
| 0x06 | `CLOSE_ALL_RESP`    | watch → phone                                     |
| 0x07 | `UNK_REQ`           | ?                                                 |
| 0x08 | `UNK_RESP`          | ?                                                 |
| 0xff | protocol error      | watch → phone (docs only)                         |

### 3.2 Byte layouts

`CLOSE_ALL_REQ` (13 bytes, `V2:668-675`):

| Offset | Size | Value                                                                     |
| ------ | ---- | ------------------------------------------------------------------------- |
| 0      | 1    | `00` (management handle)                                                  |
| 1      | 1    | `05`                                                                      |
| 2      | 8    | client id, LE (`02 00 00 00 00 00 00 00`)                                 |
| 10     | 2    | `00 00` (flags, unused)                                                   |
| 12     | 1    | `00` (ByteBuffer padding: the buffer is 13 bytes but only 12 are written) |

Vector: `00 05 02 00 00 00 00 00 00 00 00 00 00`

`REGISTER_ML_REQ` (13 bytes, `V2:677-685`):

| Offset | Size | Value                           |
| ------ | ---- | ------------------------------- |
| 0      | 1    | `00`                            |
| 1      | 1    | `00`                            |
| 2      | 8    | client id, LE                   |
| 10     | 2    | service id, LE (GFDI = `01 00`) |
| 12     | 1    | `00` = ML, `02` = MLR requested |

Vectors (client id 2, GFDI):

- ML: `00 00 02 00 00 00 00 00 00 00 01 00 00`, which is what we send today.
- MLR: `00 00 02 00 00 00 00 00 00 00 01 00 02`

`REGISTER_ML_RESP` (parsed by `V2:356-431`):

| Offset | Size | Field                                                                                                                                         |
| ------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | 1    | `00`                                                                                                                                          |
| 1      | 1    | `01`                                                                                                                                          |
| 2      | 8    | client id (upstream drops responses that are not for its id, `V2:338-341`)                                                                    |
| 10     | 2    | service id                                                                                                                                    |
| 12     | 1    | status: `00` SUCCESS, `01` INVALID_SERVICE_ID, `02` PENDING_AUTH, `03` ALREADY_IN_USE, `04` REJECTED (`Docs#register-mlmlr-service-response`) |
| 13     | 1    | handle (present on success)                                                                                                                   |
| 14     | 1    | reliable: `00` = ML, non-zero = MLR                                                                                                           |
| 15     | 1    | optional; the docs call it "REGISTRATION as ML service" and say it "does not seem to be relevant" for GFDI                                    |

Recorded MLR grant from the docs, for client id 1 and service GFDI: `00 01 01 00 00 00 00 00 00 00 01 00 00 86 01 00`, meaning status SUCCESS, **handle `0x86`**, reliable. Recorded ML grants: handle `0x01`, `0x2e`, `0x68` with reliable `00` (`Docs#register-mlmlr-service-response`).

Handle value space:

- ML handles are any non-zero byte. Since #5476 upstream knows that "non-MLR handles can also have the msb set" (`V2:219`, commit `33a774f837`).
- MLR handles are `0x80 | n` with `n` in 0..7. The docs give the range as `0x80, ..., 0x87` and say the other party picks it (`Docs#state-initialization`). Upstream keys the MLR communicator by the full returned handle (`V2:424-425`) and on receive rebuilds the key as `((b0 & 0x70) >> 4) | 0x80` (`V2:201`). So it **assumes** that the MLR handle always has bit 7 set and fits in 3 bits (INFERRED from the code shape). One docs example (`0000 0100000000000001 0400 00 04 01 01`, "handle=0x04, reliable=True") contradicts this. It also starts with type `00` and an odd client id, so it reads like a garbled capture.

`CLOSE_HANDLE_REQ` (13 bytes, `V2:687-695`): `00 02 <client 8> <service 2> <handle 1>`.

`CLOSE_HANDLE_RESP` (`V2:433-469`): `00 03 <client 8> <service 2> <handle 1> <status 1>`, where status is `00` SUCCESS, `01` INVALID_HANDLE or `02` NO_CONNECTION (`Docs#close-handle-response`). Our parser already reads handle at offset 12 and status at 13, which matches upstream after the fix in commit `1b1c68f00e`.

`CLOSE_ALL_RESP`: `00 06 <client 8> <flags 2> <status 1>`. Upstream ignores the payload (`V2:471-483`).

### 3.3 Upstream handshake sequence (ML or MLR)

```
phone                                     watch
  | enable notify on 2810 (first pair)      |
  | MTU request 515                         |
  |-- 00 05 <client> 0000 00  (CLOSE_ALL) ->|
  |<- 00 03 … (per-handle closes, ignored while closingAll) |
  |<- 00 06 <client> 0000 ..  (CLOSE_ALL_RESP)
  |-- 00 00 <client> 0100 02  (REGISTER GFDI, reliable if garmin_mlr) ->|
  |<- 00 01 <client> 0100 00 <h> <rel>      |
  |   rel == 0 → ML writer;  rel != 0 → new MlrCommunicator(h)
  |<========= GFDI over ML or MLR ==========>|
  |<- DeviceInformation (5024)               |
  |-- status ACK + DeviceInformation reply ->|
  |<- Configuration (5050)                   |
  |-- status ACK + reply ------------------->| → CapabilitiesDeviceEvent → completeInitialization()
  |-- SupportedFileTypes, settings, time, SYNC_READY, … (`Sup:1097-1126`)
```

Sources: `V2:122-143`, `V2:471-483`, `V2:356-431`, `Sup:461-532`, `Sup:555-563`, `Sup:1097-1126`. The DeviceInformation/Configuration exchange is GFDI-level and identical on ML and MLR.

Error handling in management:

- A register status other than 0 is logged and dropped (`V2:364-367`). Nothing retries, so GFDI never comes up and the link stalls (INFERRED).
- A registration that arrives without a callback is closed again (`V2:409-413`).
- When the watch closes GFDI outside a close-all, upstream re-registers it with the same `mlrEnabled()` choice (`V2:456-464`, commit `3f0bb26cc3`). Any MLR communicator on that handle is closed and removed (`V2:446-451`).
- A duplicate MLR registration on the same handle replaces and closes the old communicator (`V2:419-423`, commit `9afeff3bb3`).
- `CLOSE_ALL_RESP` clears every handle and callback, then registers GFDI again (`V2:471-483`).

## 4. MLR packet format and reliability layer

### 4.1 Header (`Mlr:22-26`, `Mlr:318-331`, `Docs#message-format`)

```
byte0: 1 H H H R R R R      bit7 = MLR flag (0x80)
                             bits6-4 = handle & 0x07
                             bits3-0 = reqNum >> 2
byte1: R R S S S S S S      bits7-6 = reqNum & 0x03
                             bits5-0 = seqNum (0..63)
byte2…: data fragment (absent for ACK-only packets)
```

```java
packet[0] = (byte) (MLR_FLAG_MASK | ((handle & 0x07) << HANDLE_SHIFT) | ((reqNum >> 2) & REQ_NUM_MASK));
packet[1] = (byte) (((reqNum & 0x03) << 6) | (seqNum & SEQ_NUM_MASK));
```

- `reqNum` is 6 bits. It is a **cumulative ACK**: "I have received everything before `reqNum`", which equals the sender's `nextRcvSeq`.
- `seqNum` is 6 bits. Both counters wrap modulo 64 (`MAX_SEQ_NUM = 0x3F`, `Mlr:28`).
- An ACK-only packet is exactly 2 bytes. Upstream sends `seqNum = 0` in it (`Mlr:279`), and the docs say seq is "always zero in case there is no data".

Worked vectors. These are computed from `Mlr:318-331`, not recorded on hardware:

| handle | reqNum | seqNum | data      | bytes           |
| ------ | ------ | ------ | --------- | --------------- |
| 0x86   | 0      | 0      | `00 …`    | `E0 00 00 …`    |
| 0x86   | 5      | 0      | (ACK)     | `E1 40`         |
| 0x86   | 3      | 7      | `AA`      | `E0 C7 AA`      |
| 0x86   | 63     | 63     | `AA`      | `EF FF AA`      |
| 0x81   | 0      | 1      | `00 05 …` | `90 01 00 05 …` |
| 0x81   | 17     | 0      | (ACK)     | `94 40`         |

Decode on receive (`Mlr:133-148`): `handle = (b0 & 0x70) >> 4`, `reqNum = ((b0 & 0x0F) << 2) | (b1 >> 6)`, `seq = b1 & 0x3F`. A packet whose handle differs from `handle & 0x07` is dropped. A packet shorter than 2 bytes is dropped.

### 4.2 Routing on the shared notify characteristic (`V2:193-243`)

1. If `b0 & 0x80` is set **and** an MLR communicator exists for `((b0 & 0x70) >> 4) | 0x80`, the packet is MLR. It goes, with its header, to `MlrCommunicator.onPacketReceived`.
2. Otherwise read `b0` as a plain ML handle: `0x00` means management, and anything else is looked up in `serviceByHandle`. This covers ML handles that happen to have bit 7 set (#5476).

### 4.3 Constants (`Mlr:28-33`)

| Constant                         | Value    | Meaning                                                                            |
| -------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `MAX_SEQ_NUM`                    | 63       | Sequence space 0..63, arrays sized 64                                              |
| `INITIAL_MAX_UNACKED_SEND`       | 32       | Initial and maximum send window, in packets                                        |
| `INITIAL_RETRANSMISSION_TIMEOUT` | 1000 ms  | RTO after any ACK                                                                  |
| `MAX_RETRANSMISSION_TIMEOUT`     | 20000 ms | RTO cap                                                                            |
| `ACK_TIMEOUT`                    | 20 ms    | Delayed-ACK timer ("official app acks 7~17 ms after a burst", commit `4eeab7b5c3`) |
| `ACK_TRIGGER_THRESHOLD`          | 5        | Send an ACK at once after 5 unacknowledged in-order packets                        |

State is created fresh for each successful registration, with every counter at 0 (`Mlr:42-53`, `Docs#state-initialization`): `lastSendAck`, `nextSendSeq`, `nextRcvSeq`, `lastRcvAck`, the window (32) and the RTO (1000).

### 4.4 Send path (`Mlr:96-124`, `Mlr:285-316`)

1. Fragment the message (for GFDI, the COBS-encoded bytes) into chunks of at most `maxPacketSize - 2` bytes. `maxPacketSize` is `calcMaxWriteChunk(mtu)`, the same value plain ML uses (`V2:113-119`, `V2:860`). Upstream computes it as `min(512, max(23, mtu) - 3)`, and we mirror that in `ours/transport/garmin-link.ts:260-261`. Each fragment is queued.
2. `runProtocol`: while the queue is not empty and `(nextSendSeq - lastRcvAck) mod 64 < window`:
   - build the packet with `reqNum = nextRcvSeq` (a piggybacked ACK) and `seqNum = nextSendSeq`,
   - write it, store `sentFragments[nextSendSeq] = {data, reqNum}`, and increment `nextSendSeq` mod 64,
   - if this is the first unacknowledged packet, start the retransmission timer.
     Since commit `8843c5beac` several packets go out at once. Each one is a separate GATT write through `createTransactionBuilder(...).write(...)` (`V2:846-861`).
3. A piggybacked ACK on a data packet does **not** update `lastSendAck` or cancel the ACK timer (`Mlr:302-307`). So a separate ACK-only packet can still follow. That is harmless but redundant (INFERRED).

### 4.5 Receive path (`Mlr:126-204`)

1. If `reqNum != lastRcvAck`, process an ACK (`Mlr:207-248`):
   - `numAcked = (reqNum - lastRcvAck) mod 64`,
   - stop the retransmission timer and clear `sentFragments[lastRcvAck … reqNum-1]`,
   - set `lastRcvAck = reqNum`,
   - **reset** RTO to 1000 ms and set `window = min(window + numAcked, 32)`,
   - notify the `AckListener` with the acknowledged byte count and whether everything is acknowledged (used by uploads),
   - restart the retransmission timer if packets are still unacknowledged.
2. If the packet is ACK-only (length 2), stop here.
3. If `seq != nextRcvSeq`, the packet is out of order. Drop it and **immediately send an ACK** carrying the expected `nextRcvSeq` (`Mlr:194-199`). There is no reorder buffer, so the peer retransmits.
4. Otherwise increment `nextRcvSeq` and hand `packet[2:]` to the service callback.
5. After delivering data, schedule an ACK (`Mlr:250-261`): ACK at once if `(nextRcvSeq - lastSendAck) mod 64 >= 5`, otherwise arm the 20 ms timer. The ACK packet is `createPacket(nextRcvSeq, 0, [])`, which sets `lastSendAck = nextRcvSeq` (`Mlr:270-283`).
6. Then run the send loop again, because the window may have opened.

### 4.6 Retransmission (`Mlr:333-376`)

When the timer fires:

- `RTO = min(RTO * 2, 20000)` and `window = max(1, window / 2)`,
- **go-back-N**: resend every fragment in `[lastRcvAck, nextSendSeq)`. Each one keeps its stored original `reqNum` (fix `f4556e81cc`, "Fix MLR retransmission request numbers"), with its original `seqNum`,
- restart the timer.

Upstream sets **no retry limit**. Retransmission continues, capped at 20 s intervals, until an ACK arrives or the connection drops. On disconnect `onConnectionStateChange` sets `closed` and cancels all timers (`Mlr:390-397`). `close()` also clears the queue (`Mlr:378-388`).

The docs describe a more elaborate scheme that upstream does **not** implement (`Docs#retransmission`, `Docs#receiving`): a `next_send_seq_before_retransmission` marker, rewinding `next_send_seq` to the received `req_num`, and an RTT estimate from `send_times[64]`. Upstream's simpler go-back-N is the implementation that is known to work, so port that.

### 4.7 What the phone must send to keep the link alive

- **ACKs for every in-order data packet**, within about 20 ms or after 5 packets. Without them the watch retransmits and, presumably, stalls or drops the link (INFERRED, watch-side behaviour is UNKNOWN).
- **An immediate duplicate ACK** on out-of-order data (`Mlr:198`).
- Nothing else. Upstream sends no periodic keep-alive on MLR. A `KEEP_ALIVE` ML service (id 22) exists in the enum (`V2:768`), but upstream never registers it.
- **GFDI status ACKs.** Separately, at the GFDI layer, upstream answers every incoming GFDI message with a status ACK (`Sup:503`). That rule is the same on ML and MLR (section 7).

### 4.8 Window and size limits

- The window is at most 32 outstanding packets in a 64-number space, so cumulative ACKs are never ambiguous (INFERRED, standard go-back-N reasoning: the window is ≤ half the space).
- Each packet carries at most `maxPacketSize - 2` data bytes. At MTU 515 that is 510 bytes.
- The docs say `max_packet_size` "must [be] fixed during [the] lifetime of the registered connection" (`Docs#state-initialization`). Upstream still updates it on an MTU change (`V2:113-119`, `Mlr:84-88`). That affects only fragments queued after the change (INFERRED). Our port should fix the size at registration time.

## 5. GFDI on top of ML and MLR

- **COBS still applies.** `V2.sendMessage` COBS-encodes the GFDI frame first, then hands it to MLR if one exists for the GFDI handle, and otherwise to the ML chunker (`V2:161-190`). On receive, MLR delivers `packet[2:]` to `GfdiCallback.onMessage`, which feeds the same `CobsCoDec` reassembler as ML (`V2:490-503`, `V2:860`).
- **COBS variant:** a leading `00`, standard COBS blocks of up to 254 bytes (`0xFF` code for full blocks), a `01` appended when the data ends in a zero, and a trailing `00` (`Cobs:116-158`). The decoder accumulates fragments until it sees a trailing `00`. It resets on a missing leading `00`, on underflow, or on overflow of its 10 000-byte buffer (`Cobs:17-21`, `Cobs:32-108`). That 10 000 bytes is the effective inbound limit per GFDI message. Our `GarminCobsDecoder` already ports this (`ours/protocol/garmin.ts:251-340`).
- **GFDI frame:** `[len u16 LE, counts itself and the CRC][type u16 LE][payload][CRC-16/ARC u16 LE]`. If `type & 0x8000` is set, the type is `5000 + (type & 0xff)` and a sequence number sits in the high byte (`Gfdi:46-51`, `Gfdi:251-274`). Already ported (`ours/protocol/garmin.ts`).
- **Reassembly is two-level on MLR:** MLR guarantees in-order, gap-free fragments, and COBS finds the message boundaries. MLR fragments do not line up with GFDI messages. A single MLR packet can end one COBS frame and start the next (INFERRED from the byte-stream design). Our decoder must handle that. It does if it keeps leftover bytes, as upstream's `compact()` does (`Cobs:107`).
- **Sizes:** the watch states its GFDI max packet size in `DeviceInformation` (`DevInfo:59`). Upstream applies it to file uploads and protobuf chunking (`Sup:606-610`) and defaults to 400 (`Sup:222`). That limit is independent of the MLR packet size.
- **Non-GFDI services over MLR:** the new-sync file transfer services (`FILE_TRANSFER_2/4/6/A/C/E` = `0x2018 … 0xe018`, `V2:770-775`) are registered with the same `reliable` choice (`V2:254-276`). They carry **raw** bytes, not COBS. The first message must start with `00 00 00`, the remaining messages are concatenated, and the result is zlib-inflated when the watch closes the handle (`Sup:2027-2048`, `Sup:2195-2213`). This is the path that the comment "without MLR fails to sync large workouts" (`Coord:127`) refers to.

## 6. Which models need it

### 6.1 Upstream evidence

- No coordinator overrides the transport, and no MLR flag exists per model. A recursive search of the 196 Garmin coordinator sources (`G/devices/garmin/**`) for `mlr`, `Communicator`, `rfcomm` and `protocolVersion` matches only `Coord`, `Prefs` and `Settings`.
- `garmin_mlr` defaults to `true` for every Garmin device (`Sup:730`, `Settings:182-185`).
- `Coord:122-131`: when `defaultNewSyncProtocol()` is true, the coordinator also writes `PREF_NEW_SYNC_PROTOCOL = true` and `PREF_GARMIN_MLR = true`. It does so because "Some new devices like Venu X1 misses a lot of files without the new sync protocol" (#5021) and because "new sync protocol without MLR fails to sync large workouts".
- `defaultNewSyncProtocol()` returns true in exactly 4 coordinators, which cover 5 classes:
  - `W/venu/GarminVenu4Coordinator.java:20-22`
  - `W/venu/GarminVenuX1Coordinator.java:25-27`
  - `W/vivoactive/GarminVivoActive6Coordinator.java:28-31` (#5948)
  - `W/cirqa/GarminCirqaCoordinator.java:34-36`
  - `W/d2/GarminD2AirX15Coordinator.java:8` (`extends GarminVenu4Coordinator`)
- V0 and V1 sightings named in upstream comments: Vivofit and Forerunner 620 (V0, `V1:22`), Vivomove HR (V1, `V1:27`). The docs add that the Forerunner 245, vivosmart 5 and Venu 3 are ML (`Docs#protocol-description`).
- HRM 200 and HRM 600 use `GenericHeartRateSupport` (`G/devices/garmin/hrm/GarminHrmCoordinator.kt:35-36`). The HRM Pro Plus uses `GarminSupportHrm`, which talks only to the standard Battery and Heart Rate GATT services (`G/service/devices/garmin/GarminSupportHrm.java:58-80`). None of the three speaks GFDI.
- Edge 520 Plus-class devices list no files over BLE and serve them over RFCOMM (`Rfcomm:35`, `Sup:1067-1087`).

### 6.2 Mapping to our 190 registry ids

Method: for each entry in `ours/models/garmin.ts`, take `sourceFile`, resolve its `extends` chain in the downloaded coordinators, and look for a `defaultNewSyncProtocol()` override. Registry counts as they are in the data: 157 wearables with `sync: true`, plus 25 bike computers, 5 navigators and 3 HR bands with `sync: false`. The registry header says 24 bike computers and 6 navigators, so the comment in the file and the data disagree. Worth fixing separately.

| Group                                                                  | Count   | Basis                                                                               |
| ---------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| MLR needed to connect or to run the legacy GFDI file sync we implement | **0**   | Evidence (section 1, items 2-3)                                                     |
| MLR forced on upstream (paired with the new sync protocol)             | **5**   | Evidence (`Coord:122-131` plus the per-model overrides)                             |
| Sync models that work with our existing ML transport                   | **152** | Evidence that upstream ran ML-only until 2025-10. Per-model ML presence is INFERRED |
| …of which upstream names as V0/V1, so our ML-only session refuses them | 2       | Evidence (`V1:22`, `V1:27`)                                                         |
| Non-sync (no session runs)                                             | 33      | `ours/setup/controller.ts:1208` gates on `garminModel?.sync`                        |

**MLR forced on upstream (5):** `garmin_cirqa`, `garmin_d2_air_x15`, `garmin_venu_4`, `garmin_venu_x1`, `garmin_vivoactive_6`.

For these 5, the bigger problem is the sync protocol, not the transport. Upstream says the Venu X1 "misses a lot of files" with the legacy directory download (`Coord:124`), and the legacy download is all we implement (`ours/transport/garmin.ts:320-355`). MLR alone would not fix that.

**Existing ML transport is enough (152):** `garmin_d2_air`, `garmin_d2_air_x10`, `garmin_d2_mach_1`, `garmin_d2_mach_1_pro`, `garmin_d2_mach_2`, `garmin_d2_mach_2_pro`, `garmin_enduro`, `garmin_enduro_3`, `garmin_enduro_4`, `garmin_enduro_2`, `garmin_epix`, `garmin_epix_pro`, `garmin_epix_gen2`, `garmin_descent_g1`, `garmin_descent_g2`, `garmin_descent_mk3`, `garmin_descent_mk3i`, `garmin_fenix_2`, `garmin_fenix_3_chronos`, `garmin_fenix_5`, `garmin_fenix_5_plus`, `garmin_fenix_5s`, `garmin_fenix_5s_plus`, `garmin_fenix_5x`, `garmin_fenix_5x_plus`, `garmin_fenix_6`, `garmin_fenix_6s`, `garmin_fenix_6_pro`, `garmin_fenix_6_sapphire`, `garmin_fenix_6s_pro`, `garmin_fenix_6s_pro_solar`, `garmin_fenix_6x`, `garmin_fenix_6x_pro`, `garmin_fenix_6s_sapphire`, `garmin_fenix_6x_pro_solar`, `garmin_fenix_6x_sapphire`, `garmin_fenix_6_sport`, `garmin_fenix_6s_sport`, `garmin_fenix_7`, `garmin_fenix_7s`, `garmin_fenix_7s_pro`, `garmin_fenix_7s_pro_solar`, `garmin_fenix_7x`, `garmin_fenix_7x_pro`, `garmin_fenix_7x_pro_solar`, `garmin_fenix_7_pro`, `garmin_fenix_7_pro_solar`, `garmin_fenix_8`, `garmin_fenix_8_solar`, `garmin_fenix_8_pro`, `garmin_fenix_9`, `garmin_fenix_9_pro`, `garmin_fenix_9_pro_solar`, `garmin_fenix_e`, `garmin_forerunner_25`, `garmin_forerunner_30`, `garmin_forerunner_220`, `garmin_forerunner_225`, `garmin_forerunner_35`, `garmin_forerunner_45`, `garmin_forerunner_45_plus`, `garmin_forerunner_55`, `garmin_forerunner_70`, `garmin_forerunner_165`, `garmin_forerunner_165_music`, `garmin_forerunner_170`, `garmin_forerunner_170_music`, `garmin_forerunner_230`, `garmin_forerunner_235`, `garmin_forerunner_245`, `garmin_forerunner_245_music`, `garmin_forerunner_255`, `garmin_forerunner_255_music`, `garmin_forerunner_255s`, `garmin_forerunner_255s_music`, `garmin_forerunner_265`, `garmin_forerunner_265s`, `garmin_forerunner_570`, `garmin_forerunner_620`, `garmin_forerunner_630`, `garmin_forerunner_645`, `garmin_forerunner_645_music`, `garmin_forerunner_735xt`, `garmin_forerunner_745`, `garmin_forerunner_920`, `garmin_forerunner_935`, `garmin_forerunner_945`, `garmin_forerunner_945_lte`, `garmin_forerunner_955`, `garmin_forerunner_965`, `garmin_forerunner_970`, `garmin_instinct`, `garmin_instinct_2`, `garmin_instinct_2_solar`, `garmin_instinct_2_soltac`, `garmin_instinct_2s`, `garmin_instinct_2s_solar`, `garmin_instinct_2s_surf`, `garmin_instinct_2x`, `garmin_instinct_2x_solar`, `garmin_instinct_2x_tactical`, `garmin_instinct_3`, `garmin_instinct_3_tactical`, `garmin_instinct_3_solar`, `garmin_instinct_3_solar_tactical`, `garmin_instinct_crossover`, `garmin_instinct_tactical`, `garmin_instinct_e`, `garmin_lily`, `garmin_lily_2`, `garmin_lily_2_active`, `garmin_instinct_solar`, `garmin_instinct_solar_tactical`, `garmin_quatix_6`, `garmin_quatix_6x`, `garmin_quatix_8`, `garmin_tactix_7`, `garmin_tactix_8`, `garmin_tactix_8_solar`, `garmin_swim_2`, `garmin_venu`, `garmin_venu_sq`, `garmin_venu_sq_music`, `garmin_venu_sq_2`, `garmin_venu_sq_2_music`, `garmin_venu_2`, `garmin_venu_2s`, `garmin_venu_2_plus`, `garmin_venu_3`, `garmin_venu_3s`, `garmin_vivoactive`, `garmin_vivoactive_3`, `garmin_vivoactive_3t`, `garmin_vivoactive_3_music`, `garmin_vivoactive_4`, `garmin_vivoactive_4s`, `garmin_vivoactive_5`, `garmin_vivoactive_hr`, `garmin_vivosmart`, `garmin_vivosmart_hr`, `garmin_vivosmart_hr_plus`, `garmin_vivosmart_3`, `garmin_vivosmart_4`, `garmin_vivosmart_5`, `garmin_vivomove`, `garmin_vivomove_hr`, `garmin_vivomove_sport`, `garmin_vivomove_style`, `garmin_vivomove_trend`, `garmin_vivosport`, `garmin_quatix_7`, `garmin_quatix_7x`.

Caveats inside the 152:

- `garmin_forerunner_620` (V0) and `garmin_vivomove_hr` (V1) are named upstream as non-ML. Our session throws `GARMIN_ML_REQUIRED` for them (`ours/transport/garmin.ts:285`). This is about V0/V1 support, not MLR.
- Other pre-2016 models, such as `garmin_fenix_2`, `garmin_forerunner_220`, `garmin_forerunner_920`, `garmin_vivosmart`, `garmin_vivoactive` and `garmin_vivosmart_hr`, are likely V0/V1 as well. **INFERRED**: upstream has no per-model record of this, because discovery decides at runtime.
- `garmin_quatix_7` and `garmin_quatix_7x` have no coordinator. Upstream maps them by product number through `FitDevice`, which I could not fetch (the guessed path returned 404). Which coordinator they resolve to is UNKNOWN. A Fenix 7-class coordinator without the new-sync override seems likely (INFERRED).

**Non-sync (33):** 25 bike computers (`garmin_edge_*`, `garmin_etrex_se`), 5 navigators (`garmin_gpsmap_66s`, `garmin_gpsmap_66sr`, `garmin_gpsmap_66i`, `garmin_gpsmap_h1`, `garmin_inreach_mini_2`) and 3 HR bands (`garmin_hrm_200`, `garmin_hrm_600`, `garmin_hrm_pro_plus`). Side note: the 3 HR bands do not expose GFDI upstream (section 6.1). Our setup path requires a GFDI profile and throws `GARMIN_SERVICE_MISSING` otherwise (`ours/setup/controller.ts:916-921`), so a connection check on an HRM probably fails (INFERRED).

## 7. Our current behaviour, and the first-pair, auth and dual-channel differences

### 7.1 What "MLR detected" means today

1. Setup selects the first profile that matches: ML pair, then V1, then V0 (`ours/transport/garmin-link.ts:114-160`, `ours/setup/controller.ts:916-921`). It requests MTU 515 (`ours/setup/controller.ts:749-752`).
2. For `sync: true` models a `GarminSession` starts at connection time (`ours/setup/controller.ts:1208-1220`).
3. The session refuses non-ML profiles with `GARMIN_ML_REQUIRED` (`ours/transport/garmin.ts:285`). It sends CLOSE_ALL and waits, then sends REGISTER for GFDI **with reliable = 0** (`ours/transport/garmin.ts:299-318`).
4. If the response carries `reliable != 0`, the session throws `GARMIN_MLR_UNSUPPORTED` (`ours/transport/garmin.ts:315`). `run()` reports `onFailure("init")` and rejects `whenDone()` (`ours/transport/garmin.ts:278-281`).
5. The sync action awaits `session.whenDone()` (`ours/setup/controller.ts:1524-1536`). The rejection's message passes `safeError`'s `^[A-Z0-9_]{1,64}$` check (`ours/sync/controller.ts:1814-1825`), so the error code is `GARMIN_MLR_UNSUPPORTED` (or `GARMIN_ML_REQUIRED`). Neither code has user-facing copy, so `UI:791` shows the generic "Could not sync device steps. Try again.". The setup-side `safeCode` allow-list (`ours/setup/controller.ts:1813-1816`) does not include them either. That path matters only if the error escapes during connect, which it does not, because the session runs detached.

So "detected" means: if a watch ever grants MLR without being asked, we notice the `reliable` byte and fail cleanly instead of mis-parsing `1HHH…` headers as ML handles. Because we never ask for MLR, on a conforming watch this branch should not fire (INFERRED from `Docs#multi-link-reliable-protocol`).

### 7.2 Handshake gaps that are not transport-specific but will bite first

- **GFDI status ACKs.** Upstream ACKs every incoming GFDI message (`Sup:503`) and replies to `DeviceInformation` (`DevInfo:92-120`, protocol version 150) and `Configuration`. It runs `completeInitialization()` only after the capabilities arrive (`Sup:561-563`). Our session handles only `RESPONSE` (5000) and `FILE_TRANSFER_DATA` and ignores everything else (`ours/transport/garmin.ts:445-472`). It sends `SUPPORTED_FILE_TYPES_REQUEST` and `SYNC_READY` straight after registration (`ours/transport/garmin.ts:284-292`). Whether watches tolerate this is UNKNOWN: no model is hardware-validated (`ours/models/garmin.ts:30-33`). Over MLR the transport ACKs are separate from these GFDI ACKs. Both are needed.
- **First pair.** Upstream sends `PAIR_COMPLETE`, `SYNC_COMPLETE` and `SETUP_WIZARD_COMPLETE` system events on first connect (`Sup:1119-1125`). We do not. This is the same on ML and MLR.
- **Auth.** There is no transport-level auth on ML or MLR. Register status `02 PENDING_AUTH` exists (`Docs#register-mlmlr-service-response`), but upstream does not handle it specially (`V2:364-367`). Upstream answers the GFDI `AUTH_NEGOTIATION` (5101) with `GUESS_OK` (see our notes in `ours/transport/garmin-link.ts:33-43`). `GarminAuthExpiredActivity` concerns the Garmin Connect HTTP OAuth, not BLE.
- **Dual channel.** Upstream opens an RFCOMM listener (SPP UUID `deab91e4-…`) when a BLE directory lists no FIT files and the watch reported a Classic address in `DeviceInformation` (`DevInfo:63-75`, `Sup:1067-1087`, `Sup:505-510`). The RFCOMM link carries COBS GFDI and has **no** ML or MLR layer (`Rfcomm:35-38`). It is independent of MLR and applies to Edge-class devices that we register as `sync: false`. react-native-ble-plx cannot do RFCOMM, so this needs a native module (INFERRED).

## 8. Implementation plan (priority order)

**P0. Decide the scope.** MLR is not a blocker for any of our current models. The cheapest path to real-device data is still hardware validation of the ML path plus the GFDI ACK and DeviceInformation reply (P1). Do MLR as P2, where it gives reliability (lossy links, large transfers) and is a prerequisite for the protobuf new sync on the 5 models above.

**P1. GFDI handshake parity** (transport-agnostic, small):

- `ours/protocol/garmin.ts`: add builders for the generic status ACK (`RESPONSE` = 5000, original type, `ACK`) and the `DeviceInformation` reply (`DevInfo:92-120`). Add a `Configuration` reply.
- `ours/transport/garmin.ts`: in `handleGfdiMessage`, ACK every non-`RESPONSE` message. Answer 5024 and 5050. Gate `SUPPORTED_FILE_TYPES` and `SYNC_READY` on the configuration arriving, with a timeout fallback to today's behaviour.
- Tests: extend `ours/transport/garmin.test.ts` with recorded or synthesized 5024 and 5050 frames.

**P2. MLR transport:**

1. **New pure module `ours/protocol/garmin-mlr.ts`:**
   - `encodeMlrHeader(handle, reqNum, seqNum)` and `decodeMlrHeader(b0, b1)`.
   - A class `GarminMlrChannel` that ports `Mlr` one to one: queue, `sentFragments[64]`, window 32, RTO 1000 → ×2 → 20000, ACK at 5 packets or 20 ms, go-back-N with the stored `reqNum`, immediate ACK on out-of-order data.
   - Inject `timers` (same shape as `GarminTimers`, `ours/transport/garmin.ts:106-114`), `sendPacket(bytes)` and `onData(bytes)`. No BLE imports, so it stays deterministic under fake timers.
   - Fix `maxPacketSize` at construction (section 4.8).
2. **`ours/protocol/garmin.ts`:**
   - Keep `buildGarminMlRegisterService(service, reliable)`. It already writes `02` for reliable (`ours/protocol/garmin.ts:499-510`).
   - Add `GARMIN_MLR_HANDLE_MASK = 0x70`, `REQ_NUM_MASK = 0x0f` and `SEQ_NUM_MASK = 0x3f` next to `GARMIN_MLR_FLAG_MASK` (`ours/protocol/garmin.ts:166-167`).
3. **`ours/transport/garmin-link.ts`:**
   - Add `writePacket(bytes, signal)`: exactly one GATT write, no chunking. The existing `writeRaw` chunks at `maxWriteBytes - 1`, which is wrong for MLR packets (`ours/transport/garmin-link.ts:335-349`).
   - Consider write-without-response for MLR data packets: MLR has its own ACKs and the window wants many packets in flight. Upstream uses the default write type of its `TransactionBuilder.write`, which I did not check (UNKNOWN). Measure on hardware before switching.
4. **`ours/transport/garmin.ts`:**
   - Register GFDI with `reliable = true` when MLR is enabled for the device. The default should follow a per-model or per-binding flag; see P3.
   - On a response with `reliable != 0`, create a `GarminMlrChannel(handle)` and replace the `GARMIN_MLR_UNSUPPORTED` throw. The channel's `onData` feeds the existing `GarminCobsDecoder` and then `handleGfdiMessage`.
   - `writeFrame`: COBS-encode the frame, then `channel.send(cobsBytes)`. When the channel is MLR, do not go through `link.write`, because that would prefix the ML handle.
   - `handleNotification`: if `b0 & 0x80` is set and `(((b0 & 0x70) >> 4) | 0x80) === mlrHandle`, route to the channel. Otherwise keep the ML path, which preserves the #5476 behaviour.
   - Handle an unsolicited `CLOSE_HANDLE_RESP` for GFDI: close the channel and re-register (`V2:456-464`). Close the channel on disconnect.
   - Fallback: if the reliable registration fails (non-zero status or timeout), re-register once with `reliable = 0`. INFERRED safety net, since upstream has none.
5. **`ours/models/garmin.ts`:** optionally add `mlr: "preferred" | "off"`, set to `preferred` for the 5 new-sync models. The alternative is to follow upstream (default on for all) behind a kill switch. Recommendation: ship MLR off by default, enable it per model after the first hardware capture, and then flip the default.
6. **`UI`:** add copy for `GARMIN_ML_REQUIRED` ("older Garmin transport not supported") and for any MLR failure code.

**P3. New sync protocol** (separate issue): protobuf `FileSync` (`FileSync:118-199`) plus the `FILE_TRANSFER_*` ML/MLR services with raw, zlib-compressed payloads (`Sup:2027-2213`). This is what the 5 models actually need. It depends on P2 and on our protobuf `Smart` support.

**Test strategy:**

- **Header vectors:** use the table in section 4.1, including wrap-around values 63 → 0 and handles `0x80`, `0x81`, `0x86` and `0x87`.
- **Registration vectors:**
  - the docs' recorded MLR grant `00 01 01 00 00 00 00 00 00 00 01 00 00 86 01 00`, with the client id rewritten to 2 so that our client-id filter accepts it,
  - the ML grants with handles `0x01`, `0x2e` and `0x68`,
  - `ALREADY_IN_USE` `… 03 12 28`,
  - an ML handle with the msb set and no MLR channel registered, which must go down the ML path (#5476).
- **State-machine tests with fake timers:**
  - 4 data packets in, then the 20 ms timer fires and sends ACK `reqNum = 4`,
  - 5 data packets in, which sends an immediate ACK,
  - an out-of-order packet is dropped and the duplicate ACK goes out at once,
  - send 40 fragments: 32 go out, then a cumulative ACK of 10 lets 10 more go,
  - no ACK in 1000 ms resends all unacknowledged packets with their original `reqNum`, RTO becomes 2000 and the window 16. Repeated timeouts stop at 20000 and window 1. Any ACK resets RTO to 1000 and grows the window by `numAcked`, capped at 32,
  - a piggybacked ACK in a data packet releases the window,
  - `close()` and disconnect cancel the timers.
- **End-to-end session test:**
  - reuse the existing directory and FIT download fixtures in `ours/transport/garmin.test.ts`,
  - wrap each COBS stream in MLR packets. Split one GFDI frame across 3 packets and put the end of one frame and the start of the next in a single packet,
  - assert the outgoing ACK cadence and that the GFDI `TransferDataStatus` responses are MLR-framed.
- **Hardware capture:** upstream has no recorded MLR test vectors; its only communicator test is `CobsCoDecTest.java`. Before enabling MLR by default, capture a real session (Android HCI snoop log) on one of the 5 models and turn it into a fixture next to `ours/__fixtures__/`.

**Risks:**

- No hardware validation exists for any Garmin model in our code. MLR adds a stateful timer layer on top of an already unvalidated path.
- JS timer jitter: React Native timers on a busy JS thread may miss the 20 ms ACK target. The 5-packet threshold limits the damage, and the watch's own RTO is UNKNOWN.
- Serialized write-with-response through `NativeGarminLink.queue` (`ours/transport/garmin-link.ts:318-333`) limits throughput, and could trigger watch-side retransmissions if writes back up behind the ACK deadline (INFERRED).
- iOS cannot request MTU 515. The MTU iOS negotiates sets `maxPacketSize`, so fragments are smaller but still correct.
- Upstream has no retry ceiling, so a dead peer means retransmits every 20 s until disconnect. Our session watchdog (`GARMIN_WATCHDOG_MS` = 30 s, `ours/transport/garmin.ts:69`) has to stay the outer bound.

## 9. Uncertainties

1. **No recorded MLR byte traces.** The header vectors are computed from `Mlr:318-331`. The only recorded MLR byte string is the docs' registration example (handle `0x86`). Packet-level traces would need a capture.
2. **Whether any watch grants or forces MLR without being asked** is UNKNOWN. The docs say "when requested", and upstream ran ML-only on every V2 watch until 2025-10. I found no counter-evidence.
3. **The MLR handle range.** Upstream's routing assumes `0x80 | n`, n in 0..7 (`V2:201`). One docs example shows `handle=0x04, reliable=True`, but it looks garbled.
4. **Watch-side timers and behaviour** are UNKNOWN: the watch's RTO, its window size, how many missed ACKs it tolerates before closing GFDI or disconnecting, and whether it can send `CLOSE_HANDLE_RESP` for GFDI mid-session. Upstream handles that last case by re-registering.
5. **Whether our ML-only session works on any watch without P1** (GFDI ACKs and the DeviceInformation reply) is UNKNOWN. That is likely the first real-device failure, before MLR matters.
6. **Whether the 5 new-sync models lose files with the legacy download**, even over MLR. Upstream says the Venu X1 does (#5021). The other 4 were set to new sync by the same policy and are not individually documented here.
7. **The Quatix 7 and 7X coordinator** (product-number mapping through `FitDevice`, not fetched) and **per-model V0/V1 versus ML** for old models are INFERRED.
8. **The docs page is unpinned**, and its retransmission description (`next_send_seq_before_retransmission`, RTT estimate) differs from upstream code. This spec follows the code.
9. **Write type.** I did not check whether upstream's `TransactionBuilder.write` uses with-response or without-response writes for ML and MLR packets.
