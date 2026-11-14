# Bluetooth Classic (RFCOMM/SPP) on Android: implementation spec

Checked: 2026-11-13. Scope: Android only. iOS cannot open RFCOMM sockets to these watches (MFi only), so iOS keeps the current behaviour.

First target: the 41 Huawei/Honor watches that our registry marks connection-only because upstream syncs them over Bluetooth Classic. Secondary consumers: Garmin Edge-class RFCOMM file transfer and the Zepp OS models that upstream defaults to Bluetooth Classic.

Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. I downloaded each file as raw bytes from `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/<sha>/<path>` and read it. Nothing was executed or built. Upstream line numbers refer to that commit. Upstream is AGPL-3.0-or-later, and so is OpenValens.

Notation:

- **INFERRED** means I deduced it and did not read it in source.
- **UNKNOWN** means neither source nor docs settle it.
- Everything else is read from the cited line.

## 0. Path aliases used in citations

| Alias     | Path at the pin (upstream) or in this repo (`ours/`)                            |
| --------- | ------------------------------------------------------------------------------- |
| `G/`      | `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`                       |
| `BRS`     | `G/service/devices/huawei/HuaweiBRSupport.java`                                 |
| `HoBRS`   | `G/service/devices/huawei/HonorBRSupport.java`                                  |
| `SP`      | `G/service/devices/huawei/HuaweiSupportProvider.java`                           |
| `RM`      | `G/service/devices/huawei/ResponseManager.java`                                 |
| `DCH`     | `G/service/devices/huawei/HuaweiDualChannelHelper.java`                         |
| `HS`      | `G/devices/huawei/HuaweiState.java`                                             |
| `Req`     | `G/service/devices/huawei/requests/Request.java`                                |
| `R/`      | `G/service/devices/huawei/requests/`                                            |
| `ABR`     | `G/service/btbr/AbstractBTBRDeviceSupport.java`                                 |
| `Q`       | `G/service/btbr/BtBRQueue.java`                                                 |
| `TB`      | `G/service/btbr/TransactionBuilder.java`                                        |
| `WA`      | `G/service/btbr/actions/WriteAction.java`                                       |
| `SC`      | `G/service/btbr/SocketCallback.java`                                            |
| `HC`      | `G/devices/huawei/HuaweiCoordinator.java`                                       |
| `BRC`     | `G/devices/huawei/HuaweiBRCoordinator.java`                                     |
| `HoBRC`   | `G/devices/huawei/HonorBRCoordinator.java`                                      |
| `LEC`     | `G/devices/huawei/HuaweiLECoordinator.java`                                     |
| `HW/`     | `G/devices/huawei/` (per-model coordinator folders)                             |
| `Const`   | `G/devices/huawei/HuaweiConstants.java`                                         |
| `Pkt`     | `G/devices/huawei/HuaweiPacket.java`                                            |
| `DC`      | `G/devices/huawei/packets/DeviceConfig.java`                                    |
| `Cry`     | `G/devices/huawei/HuaweiCrypto.java`                                            |
| `ADC`     | `G/devices/AbstractDeviceCoordinator.java`                                      |
| `DCo`     | `G/devices/DeviceCoordinator.java`                                              |
| `GRL`     | `G/service/devices/garmin/GarminRfcommListener.java`                            |
| `GS`      | `G/service/devices/garmin/GarminSupport.java`                                   |
| `ZBR`     | `G/service/devices/huami/zeppos/ZeppOsBtbrSupport.java`                         |
| `HuS`     | `G/devices/huami/HuamiService.java`                                             |
| `ours/`   | `apps/native/`                                                                  |
| `EMC/`    | `node_modules/.bun/expo-modules-core@57.0.20+…/node_modules/expo-modules-core/` |
| `AD:Dev`  | <https://developer.android.com/reference/android/bluetooth/BluetoothDevice>     |
| `AD:Sock` | <https://developer.android.com/reference/android/bluetooth/BluetoothSocket>     |
| `AD:Perm` | <https://developer.android.com/develop/connectivity/bluetooth/bt-permissions>   |

## 1. Summary

- **Transport.** Upstream opens one outgoing **secure** RFCOMM socket. The channel is found by an SDP lookup of a vendor UUID: Huawei `82FF3820-8411-400C-B85A-55BDB32CF060`, Honor `C9770A18-4C3D-453A-8AAF-D7EC7BBD2785`. It then runs a blocking read loop and a serial write thread. Everything above the socket is the same `HuaweiSupportProvider` that drives BLE.
- **Framing.** It is byte-identical to BLE: `0x5A`, u16 length, slice byte, CRC16, TLV, and the same AES wrapping. The one structural change is that RFCOMM is a stream. One read can hold part of a frame or several frames, so we need a stream deframer. Upstream already uses one on both transports.
- **BR-specific behaviour.** There are five deltas:
  1. Upstream always runs the device-status probe on BR and branches on it.
  2. In "normal" auth mode BR skips the bond-params and bond requests.
  3. Six Honor models and the TalkBand B6 turn transaction encryption off.
  4. Three Honor models (Watch 5, 5 Pro and 6) use the Honor PAKE/STS path.
  5. Some BR devices negotiate an optional second RFCOMM socket ("dual channel").
- **Auth.** Auth mode is negotiated at runtime from `LinkParams.deviceSupportType`, not fixed per model. Only the PAKE flag is per model. Our code does normal mode, HiChainLite (all auth versions, with the PIN read from the watch below version 2) and full HiChain (user confirmation on the watch, see `huawei-hichain-auth.md`). Only Honor PAKE is refused. **INFERRED:** most of the 41 BR watches will need HiChain. Hardware has to confirm that per model.
- **Module.** We need a new local Expo module, `apps/native/modules/bt-classic`, modelled on `modules/pebble-bond`. It has a lazy `requireOptionalNativeModule` loader, an injectable native object for tests, and coded errors. It adds sockets, events and discovery. Huawei and Zepp use outgoing client sockets. Garmin needs a server socket. One module serves all three.

## 2. The upstream Huawei BR connection

### 2.1 Coordinator and support classes

- A model is BR when its coordinator extends `HuaweiBRCoordinator`. That class returns `ConnectionType.BT_CLASSIC` and `HuaweiDeviceType.BR`, and creates `HuaweiBRSupport` (`BRC:25-40`). Honor BR models extend `HonorBRCoordinator`, which creates `HonorBRSupport` (`HoBRC:27-33`).
- `HuaweiBRSupport` extends `AbstractBTBRDeviceSupport`. It uses a read buffer of 1032 bytes and the Huawei SDP UUID (`BRS:52-56`). `HonorBRSupport` only swaps the SDP UUID (`HoBRS:22-26`).
- The UUIDs: `UUID_SERVICE_HUAWEI_SDP = 82FF3820-8411-400C-B85A-55BDB32CF060` and `UUID_SERVICE_HONOR_SDP = C9770A18-4C3D-453A-8AAF-D7EC7BBD2785` (`Const:33-34`). The GATT UUIDs (`FE86/FE01/FE02` and the Honor `c5f0ad48-…` set) are BLE-only (`Const:25-31`).
- `isBLE()` is true for `AW`, `BLE` and `SMART` and false for `BR` (`SP:423-425`). Every BR/LE branch in the provider keys off this flag.

### 2.2 SPP UUID, channel and socket security

- **UUID or channel.** By default upstream looks up the channel through SDP with the service UUID. `getRfcommChannel()` returns `RFCOMM_CHANNEL_UNSPECIFIED = -1` (`ABR:45-51`, `ABR:270-277`). The queue then calls `btDevice.createRfcommSocketToServiceRecord(mService)` (`Q:340-342`). A fixed channel is used only for the dual-channel aux socket, through the hidden `createRfcommSocket(int)` reached by reflection (`Q:329-339`).
- **Secure, not insecure.** `createRfcommSocketToServiceRecord` is the secure variant. Android documents it as follows: "The remote device will be authenticated and communication on this socket will be encrypted. Use this socket only if an authenticated socket link is possible" (`AD:Dev`, createRfcommSocketToServiceRecord). Upstream never calls the insecure variant in the BR queue.
- **Connect delay.** The default is 0 ms, and Huawei does not override it (`ABR:284-290`, `BRS` has no override).

### 2.3 Pairing and bonding

- BR coordinators do not override `getBondingStyle()`. They inherit `BONDING_STYLE_ASK` (`ADC:723-726`), which means "let the user decide whether to bond or not after discovery" (`DCo:116-120`). The LE coordinator explicitly returns `BONDING_STYLE_NONE` (`LEC:32-35`). So upstream treats BR bonding as expected but optional at discovery time.
- **INFERRED:** in practice the watch must be bonded at the Bluetooth level before or during the first connect. A secure RFCOMM socket needs an authenticated link key (`AD:Dev`). When no bond exists, Android starts pairing from `connect()`, and the system pairing dialog appears. To get a predictable UX we should bond explicitly first. Our `pebble-bond` module already does that (`createBond` plus `ACTION_BOND_STATE_CHANGED`, `ours/modules/pebble-bond/android/src/main/java/expo/modules/pebblebond/PebbleBondModule.kt:85-178`).
- The app-layer bind is separate from Bluetooth bonding. On the first connection `connectFirstTime()` sets `firstConnection = true` (`BRS:73-77`). For HiChain that selects operation code `0x01` (bind) with a 30 s timeout, because "the user needs to confirm the pairing request on the device itself". Reconnects use `0x02` with 5 s (`R/GetHiChainRequest.java:56-71`). We must persist "app-layer bound" per device.
- **UNKNOWN:** whether a watch still paired to the Huawei Health app accepts a second phone. Upstream's general guidance is to unpair from the vendor app first. That is not in these files.

### 2.4 Connect sequence (upstream)

1. `AbstractBTBRDeviceSupport.connect()` needs a supported-service UUID; it throws if none is set. It creates one `BtBRQueue` and calls `mQueue.connect()` (`ABR:75-111`).
2. `BtBRQueue.connect()` checks the state, then calls `mBtAdapter.cancelDiscovery()` (`Q:319-320`). It sets `CONNECTING`, creates the socket (`Q:327-342`) and posts `HANDLER_SUBJECT_CONNECT` to the front of the write-thread queue (`Q:351-353`).
3. On the write `HandlerThread` (`Q:72`, `Q:182-250`) it runs the optional delay, then a blocking `mBtSocket.connect()` (`Q:207`). Then it starts the read thread (`Q:211-216`), sets `CONNECTED` and calls `onConnectionEstablished()` (`Q:219-222`).
4. `onConnectionEstablished()` queues `initializeDevice(...)` (`ABR:292-307`). For BR that sets `AUTHENTICATING` and starts `GetLinkParamsRequest` (`SP:516-522`). The BLE version first enables notifications on the read characteristic (`SP:499-514`). There is no characteristic to enable on BR.
5. The chain from link params onward is shared: LinkParams → DeviceStatus → auth → configure (`SP:524-582`). See section 3.4 for the BR deltas.

### 2.5 Read loop

- There is one dedicated thread per socket. A blocking `getInputStream().read(buffer)` reads into a buffer of `bufferSize` bytes: 1032 for Huawei (`Q:76-91`, `BRS:53`). `-1` is treated as end of stream (`Q:93-96`). An `IOException` breaks the loop (`Q:97-100`).
- Each read is copied and delivered as `onSocketRead(copy, channel)` (`Q:107-114`). The channel is `-1` for the primary socket (`SC:27-46`). The provider forwards it to `ResponseManager.handleData(data, channel)` (`SP:1308-1316`). That function is the same entry the BLE `onCharacteristicChanged` uses (`SP:1303-1306`).
- After the loop it calls `cleanup()`. Then it sets `NOT_CONNECTED`, or `WAITING_FOR_RECONNECT` if auto-reconnect is on (`Q:117-127`).

### 2.6 Write path

- `Request.doPerform()` serializes the packet into slice frames. It then **splits each frame into `mtu`-sized writes** and appends a sleep of `interval` ms (`Req:198-230`). `builderWrite` goes to `builderBr.write(data)` on BR (`Req:345-354`).
- Each `WriteAction` calls `socket.getOutputStream().write(value)` and then `flush()` (`WA:45-72`). Actions run serially on the queue's write `HandlerThread` (`Q:251-286`). Upstream does not wait for any response on BR.
- **INFERRED:** `interval` is always 0. `ParamsProvider.setInterval` is never called in any file I read (`Pkt:138-143`; `R/GetLinkParamsRequest.java:69-87` reads `interval` from the response but does not store it). I did not search the whole tree.
- `mtu` comes from the LinkParams response, tag `0x03`. If the tag is absent the default is `0x0014` (`DC:70`, `R/GetLinkParamsRequest.java:79`). That replaces the `ParamsProvider` default of 65535 (`Pkt:70`). **INFERRED:** on a stream socket the chunking has no protocol meaning, but it is cheap to mirror.

### 2.7 Reconnect

- `HuaweiBRSupport.useAutoConnect()` returns true (`BRS:89-92`). When the read loop exits, the device goes to `WAITING_FOR_RECONNECT` (`Q:117-127`). A failed connect does the same (`Q:223-247`). **INFERRED:** the actual retry timer lives in Gadgetbridge's generic device service, which I did not read.
- `dropConnection()` closes only the socket, so the normal reconnect path runs (`ABR:128-138`, `Q:379-392`). `dispose()` quits the write thread, closes the socket and interrupts the reader (`Q:434-446`).
- Our app syncs in the foreground and has no persistent connection. We should not copy the upstream always-connected model; see section 6.

### 2.8 Dual channel (second RFCOMM socket)

- `GetDualChannelRequest` (`0x01/0x3C`) runs only on BR, and only when the device reports dual-socket support (`R/GetDualChannelRequest.java:45-48`). It is queued first in the post-auth init (`SP:1053-1055`). The response sets the routing tables and opens an aux socket on the negotiated channel (`R/GetDualChannelRequest.java:63-77`, `SP:349-358`, `ABR:140-180`).
- Routing never sends services `0x28` and `0x2C` to aux (`DC:2009`, `DCH:44-49`, `DCH:119-140`). Until the aux socket is connected, traffic falls back to the primary (`ABR:238-254`). There is a Watch 4 file-download quirk (`DCH:56-62`).
- **INFERRED:** we can skip the dual channel at first. It is optional, and service 0x07 (fitness) is not forced onto aux. It would also need the hidden `createRfcommSocket(int)` API (`Q:331-332`), which non-SDK interface restrictions can block on newer targets (UNKNOWN for our target SDK).

#### 2.8.1 What it carries, and the decision (2026-11-14)

I read `DCH` (whole file), `R/GetDualChannelRequest.java`, `DC:2005-2073`, `Req:360-418`, `SP:345-358`, `SP:1052-1055`, `SP:1730-1740` and `G/devices/huawei/HuaweiState.java:223-232` (alias `HS`).

- **Who starts it.** The phone. `0x01/0x3C` is sent only when the watch advertises expand-capability bit 56 (`HS:223-226`), which needs the `GetExpandCapability` reply we never request, and only on BR (`R/GetDualChannelRequest.java:45-48`). It runs in `initializeDynamicServices`, after auth, product info and supported services (`SP:834`, `SP:998`, `SP:1055`).
- **Request.** Encrypted (the `HuaweiPacket` default), all-empty tags `01`, `02`, plus `03`, `04` when bit 142 ("extend") is set (`DC:2018-2032`, `HS:228-232`).
- **Response.** Tag `01`: the aux RFCOMM channel number. Tag `02`: services routed wholesale to aux. Tag `03`: file types (extend only). Tag `84` holding `85` entries of `06` service, `07` command ids, `08` `#`-separated P2P package names (`DC:2037-2073`).
- **What goes on aux.** Only what those tables list: a whole service, a (service, command) pair, or, for P2P services `0x34`/`0x37`, a destination package (`DCH:114-154`, `Req:395-408`). Services `0x28` and `0x2C` (file upload/download) stay on the primary socket unless the Watch 4 quirk moves file download over (`DC:2009`, `DCH:56-62`, `DCH:122-128`). The tables differ per model and are only known at runtime; upstream logs them because of that (`DCH:74-84`).
- **Why it exists.** To keep bulk traffic off the primary socket. `SP:1730-1740`: when it is active, the fitness fetch rides aux, so the device is not marked busy for notifications during a long sync.
- **Without it.** `useExtraChannel` and `routeToExtraChannel` return false while it is inactive, so every packet goes on the primary socket; until the aux socket is connected flagged packets also fall back to the primary (`DCH:114-121`, `Req:398-401`, `ABR:238-254`). Nothing in the source says a watch refuses service `0x07` on the primary socket when the phone never asked for a second one.

**Decision: not built.** Our sync uses services `0x01` (auth) and `0x07` (sleep/step counts, totals, data). We never send `0x3C`, so the watch never activates a routing table, and upstream's own fallback puts everything on the one socket. The only benefit is parallelism with notifications, which we do not handle. Building it would also need a second socket on a fixed channel, which on Android means the hidden `createRfcommSocket(int)` (non-SDK; the public API only does SDP-UUID lookups). **UNKNOWN:** whether some firmware ignores `0x07` on the primary socket regardless; a hardware probe would show it as a `0x07` timeout after auth succeeds.

## 3. Frame format: BR vs LE

### 3.1 Identical framing

There is a single `HuaweiPacket` class for both transports. Nothing in serialize or parse branches on BR or LE:

- **Unsliced frame:** `5A | u16 BE (body+1) | 00 | sid cid TLV | CRC16` (`Pkt:938-958`).
- **Sliced frame:** `5A | u16 BE (packetSize-5) | slice 1/2/3 | flag (0,1,2…) | [sid cid on slice 1] | data | CRC16` (`Pkt:877-936`). `CheckSums.getCRC16(…, 0x0000)` runs over everything before the CRC (`Pkt:929`, `Pkt:951`).
- **Defaults:** slice size `0xF4`, MTU 65535 until LinkParams replaces them (`Pkt:68-70`). LinkParams itself is sent unencrypted and unsliced (`DC:46-66`).

Our codec in `ours/lib/direct-devices/protocol/huawei.ts:253-347` (encode) and `:350-373` (decode) matches this layout. So does the comment at `:15-20`. **Reuse it unchanged.**

### 3.2 The one structural difference: stream reassembly

Upstream's parser is stream-capable, and it is used on both transports:

- If fewer than 3 bytes are buffered, or fewer than `expectedSize + 2` follow the header, the bytes go into `partialPacket` and wait for the next read (`Pkt:360-374`). The comment says "Older band and BT version do not handle message with more than 256 bits" (`Pkt:372`).
- After one frame, `left = buffer.remaining()` (`Pkt:389`). `ResponseManager.handleData` loops while `left > 0` and handles concatenated frames (`RM:110-169`). The state is kept per channel (`RM:44-49`).
- On a magic or CRC error the whole per-channel buffer is dropped (`RM:127-132`, `Pkt:352-358`, `Pkt:394-399`).

Ours is not stream-capable. `HuaweiSession.handle()` treats each notification as exactly one frame: `decodeHuaweiPacket(bytes)` (`ours/lib/direct-devices/transport/huawei.ts:736-750`). `decodeHuaweiPacket` throws `HUAWEI_PACKET_TRUNCATED` on a partial frame and ignores trailing bytes (`ours/lib/direct-devices/protocol/huawei.ts:350-373`). Over RFCOMM that would drop data.

**Required addition (pure TS, in `protocol/huawei.ts`):** a `HuaweiStreamDeframer`. It works like this:

- Append the incoming bytes.
- Loop. If the buffer has fewer than 3 bytes, wait for more. If `buf[0] != 0x5A`, mirror upstream: drop the buffer and report `HUAWEI_MAGIC`. Otherwise `total = 3 + u16be(buf,1) + 2`. If the buffer holds fewer than `total` bytes, wait. Otherwise emit `buf[0:total]` to `decodeHuaweiPacket` and keep the remainder.
- Cap the buffer at `HUAWEI_MAX_PACKET_BYTES`.

Use it on BLE too. Each BLE notification is then one complete frame, which the deframer passes straight through. That gives one code path, the same as upstream.

### 3.3 MTU and slice size

- **Slice size:** negotiated, the same on both transports. LinkParams tag `0x02`, default `0xF4` (`DC:71`, `R/GetLinkParamsRequest.java:78`). Our session already applies it (`ours/…/transport/huawei.ts:373`, `:627-632`).
- **Write MTU:** BLE relies on the GATT MTU. Our link uses `min(512, mtu) - 3` (`ours/…/transport/huawei-link.ts:128`), and the session writes whole frames. BR chunks to LinkParams `mtu` (`Req:208-221`). For BR, chunk each frame to `linkParams.mtu`; our parser already exposes it with a default of `0x14` (`ours/…/protocol/huawei.ts:695`). A stream needs no MTU, so this only mirrors upstream timing.
- **Read size:** upstream reads at most 1032 bytes at a time (`BRS:53`). Frames above that size arrive in several reads and are reassembled (3.2).

### 3.4 Auth and crypto: same primitives, three BR deltas

Same primitives on both transports. `HuaweiCrypto` is built from LinkParams fields only (`R/GetAuthRequest.java:58-62`). AES-CBC or GCM selection, the IV counter and the TLV `0x7C/0x7D/0x7E` wrapping all live in `HuaweiPacket` and have no transport branch (`Pkt:282-300`, `Pkt:1089-1107`).

BR deltas, which must be gated on `transport === "br"` in our session:

1. **Device status is authoritative on BR.** BLE skips the status request and goes straight to the HiChain decision (`SP:573-575`). BR sends `GetDeviceStatusRequest(ask=true)` and continues to auth only if the status is `-1`, `0` or `1`. Any other value goes to `initializeDeviceNotify()`, which is an empty TODO (`SP:554-582`, `SP:675-677`). Ours sends the probe best-effort with a 5 s watchdog and ignores the value (`ours/…/transport/huawei.ts:381-392`). For BR, treat any other status as a typed failure, `HUAWEI_DEVICE_STATUS_UNSUPPORTED`. Do not hang.
2. **Normal mode skips the bond on BR.** In `initializeDeviceNormalMode` the bond-params and bond requests are chained only for `BLE` and `AW`. On BR, `GetAuthRequest` finishes straight to configure (`SP:760-779`, especially `:764` and `:772`). Ours always sends bond params, and sends the bond unless status is 1 (`ours/…/transport/huawei.ts:478-525`). For BR in normal mode, stop after the auth digest check. HiChainLite is unchanged: it always chains auth → bondParams → bond (`SP:737-758`).
   - **INFERRED:** BR normal mode then encrypts 0x07 traffic with the locally persisted `authkey` (`SP:850-862`), which the watch never received in that session. Either such devices have encryption off, or they keep a key from an earlier bind. UNKNOWN which.
3. **Per-model "transactions crypted" flag.** `HuaweiCoordinator.isTransactionCrypted()` defaults to true (`HC:85-87`) and is applied to `ParamsProvider` (`SP:414-419`). `serialize()` encrypts only if `isEncrypted && areTransactionsCrypted()` (`Pkt:1089-1107`). Eight BR coordinators override it to `false` (table in section 4). Ours always encrypts service 0x07 once a secret key exists (`ours/…/transport/huawei.ts:622-626`). Add a registry flag and honour it. Inbound decryption is driven by the `0x7C` tag, so it needs no flag (`Pkt:282-300`).

Auth-mode selection, which is the same code for BR and LE (`SP:585-637`):

- `deviceSupportType` `0` → normal mode.
- `deviceSupportType` `2` → HiChainLite (`authMode 2`).
- `deviceSupportType` `1`, `3` or `4` → HiChain. Upstream sends a SecurityNegotiation (`0x01/0x33`). If `supportsHiChainPake()`, it goes to the Honor PAKE/STS path (`SP:620-621`, `SP:640-656`). Otherwise it goes to `finalizeSecurityNegotiationHiChain`: HiChain/HiChain3 for `authType 0x0186A0` or HiChain3 bits, HiChainLite for `authType` 1 or 2 (`SP:663-673`).
- Full HiChain fetches the watch PIN with `GetPincodeRequest` (`0x01/0x2C`) on the first connection only. The PIN comes back encrypted with the digest secret (`DC:1690-1732`, `Cry:248-257`). Upstream then runs the HiChain ISO exchange (`0x01/0x28`, JSON steps). It derives `sessionKey = HKDF-SHA256(psk, randSelf‖randPeer, "hichain_iso_session_key")` and finally sets the packet secret key (`SP:708-722`, `R/GetHiChainRequest.java:132`, `:196`).

What we have now (`ours/…/transport/huawei.ts`): normal mode, HiChainLite (with the watch PIN below auth version 2) and full HiChain. Only PAKE (`honor_pake`) is refused with a typed error.

### 3.5 Messages that differ

- LinkParams request: tags `01-04` for every type. Only `AW` adds `06` (`DC:49-66`). It is identical for BR and BLE, so our `buildHuaweiLinkParamsRequest(false)` is correct.
- DeviceStatus: same packet; only the handling differs (3.4.1).
- DualChannel `0x01/0x3C`: BR-only (2.8).
- Fitness sync (`0x07`): the same request chain on both. Only the transaction builder differs (`SP:1727-1741`). Ours needs no change.
- `HuaweiPacket.parseData` treats four (service, command) pairs as non-TLV: `0a/05`, `28/06`, `2c/05`, `1c/05` (`Pkt:422-431`). That applies to both transports and is outside the 0x07 sync, so it is noted but not a BR delta.

## 4. Which registry models are BR, and their auth

Registry rule: `sync` is true only for the 25 models whose coordinator extends `HuaweiLECoordinator`. The other 41 are BR and connection-only (`ours/lib/direct-devices/models/huawei.ts:24-29`, `:134-166`, `:842-846`).

At the pin, 33 coordinator classes extend `HuaweiBRCoordinator` or `HonorBRCoordinator`. They map to exactly our 41 ids. `grep -l "extends HuaweiBRCoordinator|extends HonorBRCoordinator"` over the 54 downloaded coordinator files confirms the 41; the other 22 files extend `HuaweiLECoordinator`.

"Crypt off" means the coordinator returns `isTransactionCrypted() == false`. "PAKE" means `supportsHiChainPake() == true`. "Auth needed" is what the source decides. For every model the mode is negotiated at runtime (3.4), so "runtime" means UNKNOWN until we probe the hardware.

| Registry id(s)                                                       | Coordinator (cite: `extends` line; overrides)                               | Base     | SDP UUID | Crypt | Auth needed (source)                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- | -------- | ----- | ------------------------------------------- |
| `honor_magicwatch_2`                                                 | `HW/honormagicwatch2/HonorMagicWatch2Coordinator.java:28`; crypt `:30-31`   | HuaweiBR | Huawei   | off   | runtime                                     |
| `honor_watch_gs_3`                                                   | `HW/honorwatchgs3/HonorWatchGS3Coordinator.java:28`; crypt `:30-31`         | HuaweiBR | Huawei   | off   | runtime                                     |
| `honor_watch_gs_pro`                                                 | `HW/honorwatchgspro/HonorWatchGSProCoordinator.java:28`; crypt `:30-31`     | HuaweiBR | Huawei   | off   | runtime                                     |
| `honor_watch_4`, `honor_watch_4_pro`                                 | `HW/honorwatch4/HonorWatch4Coordinator.java:28`; crypt `:30-31`             | HonorBR  | Honor    | off   | runtime                                     |
| `honor_watch_5`                                                      | `HW/honorwatch5/HonorWatch5Coordinator.java:29`; crypt `:31-32`; PAKE `:36` | HonorBR  | Honor    | off   | **PAKE** (if HiChain negotiated, `SP:620`)  |
| `honor_watch_5_pro`                                                  | `HW/honorwatch5pro/HonorWatch5ProCoordinator.java:29`; crypt; PAKE          | HonorBR  | Honor    | off   | **PAKE**                                    |
| `honor_watch_6`                                                      | `HW/honorwatch6/HonorWatch6Coordinator.java:29`; crypt; PAKE                | HonorBR  | Honor    | off   | **PAKE**                                    |
| `huawei_talk_band_b6`                                                | `HW/huaweitalkbandb6/HuaweiTalkBandB6Coordinator.java:29`; crypt `:31-32`   | HuaweiBR | Huawei   | off   | runtime                                     |
| `huawei_watch_3`, `huawei_watch_3_pro`                               | `HW/huaweiwatch3/HuaweiWatch3Coordinator.java:28`                           | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_4`, `huawei_watch_4_pro`                               | `HW/huaweiwatch4pro/HuaweiWatch4ProCoordinator.java:28`                     | HuaweiBR | Huawei   | on    | runtime (+ dual-channel quirk, `DCH:56-62`) |
| `huawei_watch_5`                                                     | `HW/huaweiwatch5/HuaweiWatch5Coordinator.java:28` (experimental)            | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_6`                                                     | `HW/huaweiwatch6/HuaweiWatch6Coordinator.java:28`                           | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_6_pro`                                                 | `HW/huaweiwatch6/HuaweiWatch6ProCoordinator.java:28`                        | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_d2`                                                    | `HW/huaweiwatchd2/HuaweiWatchD2Coordinator.java:28`                         | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_d3`                                                    | `HW/huaweiwatchd3/HuaweiWatchD3Coordinator.java:28`                         | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_2`, `huawei_watch_gt_2_pro`                         | `HW/huaweiwatchgt2/HuaweiWatchGT2Coordinator.java:28`                       | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_3`, `huawei_watch_gt_3_pro`, `huawei_watch_gt_3_se` | `HW/huaweiwatchgt3/HuaweiWatchGT3Coordinator.java:28`                       | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_4`                                                  | `HW/huaweiwatchgt4/HuaweiWatchGT4Coordinator.java:28`                       | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_5`, `huawei_watch_gt_5_pro`                         | `HW/huaweiwatchgt5/HuaweiWatchGT5Coordinator.java:28`                       | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_6`, `huawei_watch_gt_6_pro`                         | `HW/huaweiwatchgt6/HuaweiWatchGT6Coordinator.java:29`                       | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_7`                                                  | `HW/huaweiwatchgt7/HuaweiWatchGT7Coordinator.java:29`                       | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_7_pro`                                              | `HW/huaweiwatchgt7/HuaweiWatchGT7ProCoordinator.java:28`                    | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_cyber`                                              | `HW/huaweiwatchgtcyber/HuaweiWatchGTCyberCoordinator.java:28`               | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_runner`                                             | `HW/huaweiwatchgtrunner/HuaweiWatchGTRunnerCoordinator.java:28`             | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_gt_runner_2`                                           | `HW/huaweiwatchgtrunner2/HuaweiWatchGTRunner2Coordinator.java:28`           | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_fit_2`                                                 | `HW/huaweiwatchfit2/HuaweiWatchFit2Coordinator.java:28`                     | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_fit_3`                                                 | `HW/huaweiwatchfit3/HuaweiWatchFit3Coordinator.java:28`                     | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_fit_4`, `huawei_watch_fit_4_pro`                       | `HW/huaweiwatchfit4pro/HuaweiWatchFit4ProCoordinator.java:28`               | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_fit_5`                                                 | `HW/huaweiwatchfit5/HuaweiWatchFit5Coordinator.java:28`                     | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_fit_5_pro`                                             | `HW/huaweiwatchfit5pro/HuaweiWatchFit5ProCoordinator.java:28`               | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_ultimate`                                              | `HW/huaweiwatchultimate/HuaweiWatchUltimateCoordinator.java:28`             | HuaweiBR | Huawei   | on    | runtime                                     |
| `huawei_watch_ultimate_2`                                            | `HW/huaweiwatchultimate2/HuaweiWatchUltimate2Coordinator.java:28`           | HuaweiBR | Huawei   | on    | runtime                                     |

Totals: 8 Honor and 33 Huawei, 41 in all. The SDP UUID follows the base class: `HonorBRSupport` sets the Honor UUID (`HoBRS:25`). `HonorMagicWatch2`, `HonorWatchGS3` and `HonorWatchGSPro` extend `HuaweiBRCoordinator`, so they use the **Huawei** SDP UUID despite the Honor brand.

Auth needs, grouped:

- **Need Honor PAKE/STS:** `honor_watch_5`, `honor_watch_5_pro`, `honor_watch_6` (3 models). That holds whenever the watch reports a HiChain `deviceSupportType`. Upstream gives these coordinators no other path (`SP:620-623`). PAKE is a large port: `HiChainPakeUtils.java` is about 36 KB, and `R/GetHiChainPakeRequest.java` is 513 lines. It needs Ed25519 identity and X25519/SPEKE (`SP:944-985`).
- **Would work with what we have today:** any of the other 38 whose LinkParams report `deviceSupportType 0` (normal mode, with the BR no-bond delta) or `2` with `authVersion 2` (HiChainLite v2). The source cannot tell which models those are.
- **Need full HiChain:** any of the other 38 that report `deviceSupportType 1`, `3` or `4`. **INFERRED:** this is likely the majority of the 2020+ Huawei watches. Upstream built the PIN, 30 s on-watch confirmation and HKDF session-key path for exactly this BR generation, and only BR devices take the pre-auth device-status branch. The port is bounded: `R/GetHiChainRequest.java` is 256 lines, plus `DC` HiChain and PinCode packets (`DC:1029-1689`, `DC:1690-1732`) and `Cry.decryptPinCode` (`Cry:248-257`). It uses only HMAC-SHA256, HKDF and AES-GCM/CBC, which `react-native-quick-crypto` already provides for our Huawei code.
- **Crypt-off models** (the 8 "off" rows) must send 0x07 requests unencrypted even after auth. Today we would encrypt them.

## 5. Native module design

### 5.1 The existing pattern to copy: `modules/pebble-bond`

- **Layout** (all tracked in git; `android/` and `ios/` at the app root are generated by prebuild and not tracked):
  - `ours/modules/pebble-bond/package.json` (`"main": "index.ts"`);
  - `expo-module.config.json` (`"platforms": ["android"]`, `"android.modules": ["expo.modules.pebblebond.PebbleBondModule"]`);
  - `android/build.gradle` (plugins `com.android.library` and `expo-module-gradle-plugin`, `namespace`);
  - `android/src/main/AndroidManifest.xml` (declares `BLUETOOTH_CONNECT`; it merges into the app manifest);
  - `android/src/main/java/expo/modules/pebblebond/PebbleBondModule.kt`.
- **Autolinking.** Expo autolinking scans `./modules` by default (`expo-modules-autolinking/build/commands/autolinkingOptions.js:172`). `app.json` and `package.json` need no entry.
- **Kotlin.** `class PebbleBondModule : Module()` with a `ModuleDefinition { Name("PebbleBond"); AsyncFunction(...) { ..., promise: Promise -> } ; OnDestroy { } }` (`PebbleBondModule.kt:24-83`).
  - State changes are serialized on `Handler(Looper.getMainLooper())` (`:39`, `:59-63`).
  - Errors are `promise.reject("PEBBLE_PAIRING_<CODE>", message, cause)`.
  - `BLUETOOTH_CONNECT` is checked explicitly on API 31+ (`:197-207`).
  - On destroy, new work is fenced and outstanding waiters are drained (`:73-82`).
- **JS.** `index.ts` exports a narrow adapter type and a `createPebbleBondAdapter(loadNative, isIOS)` factory. The loader lazily calls `require("expo").requireOptionalNativeModule("PebbleBond")`, so pure tests never touch Expo (`index.ts:18-25`, `:27-60`). Native `{code}` rejections become `Error(code)` (`index.ts:62-71`). The production singleton is `pebbleBondAdapter` (`:77`).
- **Consumption.** The setup controller injects `pebbleBondAdapter?: () => PebbleBondAdapter` as a dep and lazily `require`s the module in production (`ours/lib/direct-devices/setup/controller.ts:121-122`, `:1014`, `:1808-1811`).
- **Tests.** `ours/lib/direct-devices/transport/pebble-bond.test.ts` passes a hand-written fake native object and `() => false` for iOS to the factory. It asserts the positional ABI, the unsupported paths and the error mapping (`:1-80`). The controller test injects a fake adapter (`ours/lib/direct-devices/setup/controller.test.ts:298`). No Kotlin unit tests exist (INFERRED from the file list).
- **Events.** `pebble-bond` has none. Expo Modules on this SDK (expo-modules-core 57.0.20) support `Events("a","b")` in the definition (`EMC/android/src/main/java/expo/modules/kotlin/objects/ObjectDefinitionBuilder.kt:438-446`). `Module.sendEvent(name, Map<String, Any?>)` emits them (`EMC/android/src/main/java/expo/modules/kotlin/modules/Module.kt:46-52`). On the JS side the module object is an `EventEmitter`, so `native.addListener(name, cb)` returns a subscription with `.remove()` (`EMC/src/ts-declarations/NativeModule.ts:1-14`). A `ByteArray` value in an event body goes through `FollyDynamicExtensionConverter` (`EMC/android/src/main/java/expo/modules/kotlin/types/JSTypeConverterProvider.kt:45`, `:73`). **INFERRED:** it arrives as a `Uint8Array`. Verify on device, and normalise in JS (accept `Uint8Array`, `number[]` or base64).

### 5.2 New module: `apps/native/modules/bt-classic`

Files: `package.json`, `expo-module.config.json` (Android only, module `expo.modules.btclassic.BtClassicModule`), `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `android/src/main/java/expo/modules/btclassic/BtClassicModule.kt`, `index.ts`.

Kotlin API: positional ABI, all `AsyncFunction` unless noted.

```kotlin
Name("BtClassic")
Events("onData", "onClosed", "onDiscovered", "onDiscoveryFinished", "onAccepted")

Function("isAvailable") { -> Boolean }                       // adapter present
AsyncFunction("getAdapterState") { -> "on" | "off" | "unsupported" }
AsyncFunction("listBonded") { -> List<Map> }                 // {address, name, type, bondState}; BLUETOOTH_CONNECT
AsyncFunction("startDiscovery") { requestId: String, timeoutMs: Double -> Unit }  // BLUETOOTH_SCAN; emits onDiscovered/onDiscoveryFinished
AsyncFunction("cancelDiscovery") { -> Unit }
AsyncFunction("fetchUuids") { address: String, timeoutMs: Double -> List<String> } // fetchUuidsWithSdp + ACTION_UUID (diagnostics, Garmin trigger)
AsyncFunction("connect") { address: String, uuid: String, secure: Boolean, timeoutMs: Double -> String /* socketId */ }
AsyncFunction("startReading") { socketId: String, bufferSize: Int -> Unit }   // reader starts only after JS subscribed
AsyncFunction("write") { socketId: String, bytes: ByteArray -> Unit }        // resolves after write()+flush()
AsyncFunction("close") { socketId: String -> Unit }
AsyncFunction("listen") { uuid: String, serviceName: String, secure: Boolean -> String /* serverId */ } // Garmin
AsyncFunction("stopListening") { serverId: String -> Unit }
OnDestroy { /* fence, close all sockets/servers, cancel discovery, unregister receivers */ }
```

Bonding reuses `pebble-bond`. Its `ensureBonded(address, requestId, timeoutMs)` is transport-agnostic: `getRemoteDevice(addr).createBond()` (`PebbleBondModule.kt:197-207`, `:163-167`). Later it can be renamed to `bt-bond`. `createBond(int transport)` with `TRANSPORT_BREDR` exists only from API 37 (`AD:Dev`), so use the plain `createBond()`.

Threading:

- **connect.** Runs on a module-owned cached `Executor`, never the JS or main thread. The steps are `adapter.cancelDiscovery()` (required: `AD:Sock` connect), `createRfcommSocketToServiceRecord(uuid)` (or the insecure variant if `secure=false`), then a blocking `socket.connect()`. A watchdog `close()` from another thread enforces `timeoutMs`; `AD:Sock` says "close() can be used to abort this call from another thread". Reject `BT_CLASSIC_BUSY` if a connect to the same address is already pending.
- **read.** One `Thread` per socket, started by `startReading`. A blocking `read(buf)` with `buf` defaulting to 4096 is followed by `sendEvent("onData", mapOf("socketId" to id, "bytes" to buf.copyOf(n)))`. On `-1` or `IOException` the thread emits `onClosed {socketId, reason: "remote" | "error", message}`, closes and unregisters. This mirrors `Q:76-135`. Starting the reader only after JS calls `startReading` avoids losing bytes sent before the listener exists. Huawei and Zepp speak first from the phone, but Garmin's accepted socket may not.
- **write.** One single-thread executor per socket keeps writes strictly ordered, like `Q:72`. Each job runs `out.write(bytes); out.flush()` (`WA:60-72`) and resolves the promise.
- **Registry.** A `ConcurrentHashMap<String, SocketEntry>` keyed by socket id; ids come from an `AtomicLong`. A cap of 4 sockets gives `BT_CLASSIC_TOO_MANY_SOCKETS`. `close` is idempotent and emits `onClosed {reason: "local"}` once.
- **Discovery.** A `BroadcastReceiver` for `ACTION_FOUND`, `ACTION_DISCOVERY_FINISHED` and `ACTION_BOND_STATE_CHANGED`, registered `RECEIVER_EXPORTED` on API 33+ the same way pebble-bond does (`PebbleBondModule.kt:148-154`). A timeout calls `cancelDiscovery`.
- **listen** (Garmin). `listenUsingRfcommWithServiceRecord(name, uuid)` runs on an executor thread. An `accept()` loop wraps each accepted socket as a new `socketId` and emits `onAccepted {serverId, socketId, address}` (`GRL:100-151`).

Error codes (all `BT_CLASSIC_*`, mapped to `Error(code)` in JS as `pebble-bond` does):

| Code                                    | When                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNSUPPORTED`                           | no adapter / iOS / module missing                                                                                                                                                |
| `DISABLED`                              | adapter off                                                                                                                                                                      |
| `PERMISSION`                            | `SecurityException`, or missing `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` on API 31+                                                                                                  |
| `INVALID_ADDRESS` / `INVALID_UUID`      | `BluetoothAdapter.checkBluetoothAddress` fails / `UUID.fromString` throws                                                                                                        |
| `CONNECT_FAILED`                        | `IOException` from `connect()`. Pass the message through (for example "read failed, socket might closed or timeout"); it helps tell "no SDP record" from "not bonded" (INFERRED) |
| `CONNECT_TIMEOUT`                       | watchdog fired                                                                                                                                                                   |
| `BUSY`                                  | concurrent connect or discovery                                                                                                                                                  |
| `NOT_CONNECTED` / `SOCKET_CLOSED`       | write or read on an unknown or closed socket                                                                                                                                     |
| `WRITE_FAILED`                          | `IOException` on write or flush                                                                                                                                                  |
| `CANCELLED`                             | `close()` during connect, or module destroyed                                                                                                                                    |
| `TOO_MANY_SOCKETS` / `DISCOVERY_FAILED` | as named                                                                                                                                                                         |

### 5.3 Permissions and config plugin

- **Already declared.**
  - `react-native-ble-plx`'s library manifest declares `BLUETOOTH` and `BLUETOOTH_ADMIN` (both `maxSdkVersion 30`), `BLUETOOTH_SCAN` (`neverForLocation`, targetApi S), `BLUETOOTH_CONNECT` and both location permissions (`node_modules/react-native-ble-plx/android/src/main/AndroidManifest.xml`).
  - The `@config-plugins/react-native-ble-plx` plugin adds `BLUETOOTH_SCAN` and the location permissions (`node_modules/@config-plugins/react-native-ble-plx/build/withBLEAndroidManifest.js:21-71`).
  - `pebble-bond` declares `BLUETOOTH_CONNECT`.
  - The generated manifest has all of these (`ours/android/app/src/main/AndroidManifest.xml:2-7`, generated, not tracked).
  - At runtime the setup controller already requests `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` and both location permissions on API 31+, and fine location below that (`ours/lib/direct-devices/setup/controller.ts:310-323`).
- **What RFCOMM needs in addition: nothing new.**
  - `connect()` and `getBondedDevices` need `BLUETOOTH_CONNECT` on S+ (`AD:Sock` connect, `AD:Perm`).
  - Classic discovery (`startDiscovery`/`cancelDiscovery`) needs `BLUETOOTH_SCAN` on S+. On 30 and below it needs `BLUETOOTH_ADMIN` plus location (`AD:Perm`). All are present.
  - `neverForLocation` only filters "some BLE beacons" (`AD:Perm`). **INFERRED:** it does not affect classic inquiry results.
- **Module manifest.** Declare `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN` (with `tools:targetApi="31"`) in `modules/bt-classic/android/src/main/AndroidManifest.xml`, so the module stays correct if ble-plx is ever removed. Optionally add `<uses-feature android:name="android.hardware.bluetooth" android:required="false"/>` so Play does not filter out BLE-only devices (INFERRED).
- **Config plugin: none required.** The library manifest merges, and no `Info.plist` or iOS work is needed. **Do not** add a foreground service or `FOREGROUND_SERVICE_CONNECTED_DEVICE` (see section 6, Play policy).

### 5.4 JS wrapper and the shared protocol seam

`modules/bt-classic/index.ts` follows the `pebble-bond` factory pattern:

```ts
export type BtClassicDevice = Readonly<{ address: string; name: string | null; bonded: boolean }>;

export type RfcommLink = Readonly<{
  socketId: string;
  /** Stream bytes. One call per native read; no frame alignment. */
  subscribe(onBytes: (bytes: Uint8Array) => void, onClosed: (reason: string) => void): () => void;
  write(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}>;

export type BtClassicAdapter = Readonly<{
  isSupported(): boolean; // false on iOS or when the native module is absent
  listBonded(): Promise<readonly BtClassicDevice[]>;
  discover(options: {
    timeoutMs: number;
    onDevice(device: BtClassicDevice): void;
    signal: AbortSignal;
  }): Promise<void>;
  fetchUuids(address: string, timeoutMs: number): Promise<readonly string[]>;
  openRfcomm(options: {
    address: string;
    uuid: string;
    secure?: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<RfcommLink>;
  listen(options: {
    uuid: string;
    name: string;
    onAccepted(link: RfcommLink, address: string): void;
  }): Promise<() => Promise<void>>;
}>;

export function createBtClassicAdapter(
  loadNative = loadNativeModule,
  isAndroid = defaultIsAndroid,
): BtClassicAdapter;
export const btClassicAdapter = createBtClassicAdapter();
```

`openRfcomm` does the following:

1. `connect`.
2. Register `onData` and `onClosed` listeners, filtered by `socketId`.
3. Call `startReading`.
4. Return the link.

`write` serialises on a JS promise queue, the same as `NativeHuaweiLink.write` (`ours/lib/direct-devices/transport/huawei-link.ts:154-180`).

**Seam for the shared protocol.** There is already a byte-level `HuaweiLink` interface: `maxWriteBytes`, `subscribe(onBytes, onFailure)`, `write(bytes, signal)` and `close()` (`ours/…/transport/huawei-link.ts:74-79`). `NativeHuaweiLink` implements it over ble-plx (`:117-187`). `HuaweiSession` does not use it. It talks to the ble-plx `Device` directly (`ours/…/transport/huawei.ts:169-170`, `:217-221`, `:670-679`, `:711-734`). The change has four parts:

1. **`HuaweiSessionOptions`.** Replace `device` and `profile` with `link: HuaweiLink`. Add `transport: "ble" | "br"`, `transactionsCrypted: boolean` and `macAddress`, which is already there (`:222-223`).
2. **New `RfcommHuaweiLink implements HuaweiLink`.** It wraps `RfcommLink`. `maxWriteBytes` is `Infinity`, or the LinkParams `mtu` once known.
3. **`HuaweiSession.handle`.** Feed `HuaweiStreamDeframer` (3.2) on both transports.
4. **Gating on `transport === "br"`.**
   - Skip the 1 s BLE init delay (`:114-115`, `:343-345`). INFERRED; it exists "so the GATT link is ready after connect".
   - Make device status authoritative (3.4.1).
   - Run normal mode with no bond (3.4.2).
   - Chunk writes to `mtu` (3.3).

The protocol codec (`protocol/huawei.ts`) and crypto (`crypto/huawei-auth.ts`) do not change, apart from the deframer and later the HiChain additions.

### 5.5 Registry and controller changes

- **`models/huawei.ts`.** Replace the implicit `sync = BLE_SYNC_MODEL_IDS.has(id)` with explicit fields (`:117-123`, `:842-846`):
  - `transport: "ble" | "br"`;
  - `sdpUuid?: string` (Huawei or Honor, per section 4);
  - `transactionsCrypted: boolean`;
  - `authHint?: "honor_pake"`.
- **`sync` for BR.** Set `sync = transport === "ble" || (transport === "br" && Platform.OS === "android")`. Keep `support-status.ts` truthful: `huawei_connection_only` on iOS, a new `huawei_br_history_sync` on Android (`ours/lib/direct-devices/support-status.ts:114-115`; strings at `ours/components/direct-device-settings.tsx:317-318`, `:583`, `:675`).
- **Setup controller, `family === "huawei" && model.transport === "br"` on Android.** Today these are matched by BLE name and connected over BLE for the FE86 check only (`ours/…/setup/controller.ts:381-382`, `:749-753`, `:784-787`). The new branch has four steps:
  1. **Find the Classic device.** Try `listBonded()` filtered by the model's name prefix. If nothing matches, run `discover()` with the same filter. If that also fails, try the BLE address. **INFERRED:** the Classic and BLE addresses of a dual-mode watch may differ; this is UNKNOWN.
  2. **Bond.** `pebbleBondAdapter.ensureBonded`.
  3. **Connect.** `btClassicAdapter.openRfcomm({address, uuid: model.sdpUuid, secure: true})`.
  4. **Sync and close.** Create `HuaweiSession({link: new RfcommHuaweiLink(link), transport: "br", …})`. Use it from `fetchSteps` exactly as the BLE session is used today (`:1242-1254`, `:1477-1480`, `:1560-1563`). Close the socket on disconnect.
- **Test seam.** Inject `btClassicAdapter?: () => BtClassicAdapter` into the controller deps, next to `pebbleBondAdapter` (`:121-122`).
  - Unit-test `createBtClassicAdapter` with a fake native object that records calls and emits fake events, as `pebble-bond.test.ts` does.
  - Unit-test `HuaweiSession` over a `FakeHuaweiLink`. It should deliver bytes split at arbitrary offsets and concatenate several frames into one chunk, to exercise the deframer.
  - Add golden vectors from the existing Huawei tests (`ours/…/transport/huawei.test.ts`).

## 6. Step-by-step plan, with risks

**P0. Probe and seam (no auth change).**

1. Write `HuaweiStreamDeframer` with fragment and concatenation tests. Switch BLE `HuaweiSession.handle` to it. Run the BLE regression tests.
2. Refactor `HuaweiSession` onto `HuaweiLink` (5.4) and adapt `NativeHuaweiLink`. Keep BLE behaviour byte-identical.
3. Build `modules/bt-classic` with `connect`, `startReading`, `write`, `close`, `listBonded`, discovery, and `onData`/`onClosed`. Add the JS adapter and tests.
4. Add the registry fields from section 4. Add the BR setup branch behind a feature flag, with a "probe" mode. The probe connects, sends LinkParams and DeviceStatus, and records `deviceSupportType`, `authVersion`, `authAlgo`, `encryptMethod`, `mtu`, `sliceSize` and the device status in the diagnostic log. It then stops with the existing typed refusal. This turns the "runtime" column of section 4 into data at no protocol risk.

**P1. BR sync with the auth we have.**

- Apply the BR deltas 3.4.1–3.4.3 and enable sync for models whose probe reports normal mode or HiChainLite v2.

**P2. Full HiChain port.**

- Port `GetPincodeRequest`, `HiChain` steps 1–4, `decryptPinCode` and the HKDF session key.
- The UI must handle the 30 s on-watch confirmation on first bind, and we must persist the bound state (the `firstConnection` semantics, 2.3).

**P3. Honor PAKE/STS** for Watch 5, 5 Pro and 6. This is a large crypto port; treat it as separate work.

**P4. Optional.** Dual channel; Garmin RFCOMM listener; Zepp SPP (section 7).

Risks:

- **Expo prebuild and EAS.**
  - The module is autolinked from `./modules`, so `app.json` needs no change.
  - It does require a new native build. There is no `expo-updates`, so no OTA path applies. Dev clients must be rebuilt: `eas.json` `development` profile.
  - CI's Android e2e build runs `bunx expo prebuild --platform android --no-install` and will pick it up (`.github/workflows/mobile-e2e.yml:113`).
  - R8 minify is on (`app.json`, `expo-build-properties.android.enableMinifyInReleaseBuilds`). Expo modules are registered through the generated package list, and `pebble-bond` already ships this way. **INFERRED:** no keep rules are needed.
  - iOS: `"platforms": ["android"]` keeps it out of the iOS build.
- **Play policy.**
  - `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` are runtime "Nearby devices" permissions, and we already declare and request them (`AD:Perm`).
  - Foreground-only sync, as today ("Zepp OS devices sync … in the foreground", `ours/components/direct-device-settings.tsx:405`), needs **no** foreground service. That avoids the Android 14 `connectedDevice` FGS type and its Play Console declaration. Adding background RFCOMM sync later would bring that declaration back. INFERRED from Play's FGS policy; not re-read here.
  - Health data already falls under the existing Data safety form.
- **Battery.** Do not keep a socket open. Run connect → auth → sync → close inside the existing sync action. Classic inquiry costs about 10 s of radio time (INFERRED); run it only during setup and always `cancelDiscovery()` before `connect` (`AD:Sock`). Blocking reads cost no CPU while idle. Upstream's always-connected socket with auto-reconnect (`BRS:89-92`, `Q:117-127`) is the wrong model for us.
- **Reliability.** The first connect after bonding often fails with a generic `IOException` (INFERRED, field experience). Retry once after 1–2 s. Do not fall back to an insecure socket automatically; upstream never does.
- **Concurrency with BLE.** Do not hold a BLE GATT connection to the same watch while the RFCOMM session runs. The BR branch should skip the BLE connect entirely. INFERRED: dual links to one watch are untested here.

## 7. Garmin Edge and Zepp OS over RFCOMM

**Garmin (server socket, phone listens).**

- Upstream listens with `listenUsingRfcommWithServiceRecord("Garmin SPP", deab91e4-670f-11e1-9ace-30bc4824019b)` (`GRL:43`, `GRL:100-106`). This is the secure listen. The device opens the link towards the phone.
- To make it connect within seconds instead of minutes, upstream runs `fetchUuidsWithSdp()` on the Classic address (`GRL:64-85`). That address is reported over BLE in `DeviceInformation` (`GS:505-510`).
- The link carries COBS-framed GFDI with no ML/MLR layer. The decoder buffer is 64 KiB, because the device reports a max packet of `0x4000` (`GRL:35-38`, `GRL:125-145`).
- The listener starts when the BLE directory lists no FIT files (`GS:1073-1087`). After the RFCOMM capabilities arrive, upstream sends supported-file-types, settings and `SYNC_READY` (`GS:1089-1095`). Downloads then go over RFCOMM (`GS:706-712`).
- **Same module?** Yes, through `listen`, `onAccepted` and `fetchUuids`.
- **Differences from Huawei.**
  - The phone is the server.
  - BLE stays up as the control link.
  - Our Garmin transport does not parse the Classic address yet; `git grep classicAddress` finds nothing in `lib/`.
  - Framing is COBS, which our Garmin code already has for BLE.
- See also `docs/research/notes/Garmin MLR transport/garmin-mlr-transport.md` §6.1 and §7.

**Zepp OS (client socket, like Huawei).**

- `ZeppOsBtbrSupport` connects to SDP UUID `00000022-0000-3512-2118-0009af100700` (`ZBR:102-106`, `HuS:61`). Its buffer is 64 KiB (`ZBR:71`).
- It frames `55 cmd seq len16LE payload crc16 aa` (`ZBR:73-85`, `ZBR:138-216`), starts with `CMD_CHANNELS_GET`, and pings every 25 min (`ZBR:128-135`).
- It maps GATT characteristics to SPP channels and wraps the unchanged `ZeppOsSupport`. Upstream defaults 9 coordinators (7 of our ids) to this transport.
- **Same module?** Yes, through `openRfcomm`.
- **What differs:** a small SPP deframer and a channel map in TS. It is low priority, because our Zepp stack reaches those models over BLE today. That BLE path is not hardware-verified for them (`docs/research/notes/Zepp OS activity history/zepp-os-activity-history.md` §2.2).

## 8. Uncertainties

1. **The auth mode per BR model is UNKNOWN.** Upstream negotiates it at runtime (`SP:585-637`). That is why P0 includes the probe. If most models report HiChain, P1 helps few models, and P2 becomes the real first deliverable.
2. **Device discovery.** UNKNOWN whether a watch's Classic address equals its BLE address. Also UNKNOWN whether these watches appear in classic inquiry while they are bound to another phone or to Huawei Health.
3. **BR normal mode without a bond.** UNKNOWN which key encrypts 0x07 traffic when the bond is skipped (3.4.2).
4. **Device status values.** UNKNOWN which status values appear in practice. Upstream's "notify" branch is an empty TODO (`SP:675-677`).
5. **ByteArray in events.** The conversion of a `ByteArray` event payload to a JS `Uint8Array` is INFERRED from the converter, not observed.
6. **Hidden API for the dual channel.** `createRfcommSocket(int)` may be blocked by non-SDK interface restrictions. That only matters for the dual channel.
7. **HarmonyOS data path.** The newest models (GT 5/6/7, Watch 5/6, Fit 4/5, Ultimate 2) may keep sleep only in the dictionary or file formats that we already defer (`ours/…/transport/huawei.ts:32-41`). Service 0x07 steps and heart rate may be all that RFCOMM unlocks for them (INFERRED).
8. **Generic reconnect.** I did not read upstream's reconnect scheduler, so its retry timing is UNKNOWN. It is not needed for our connect-per-sync model.
