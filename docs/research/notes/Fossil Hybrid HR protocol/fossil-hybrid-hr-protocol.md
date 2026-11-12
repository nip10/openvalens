# Fossil Hybrid HR / Gen 6 Hybrid / Skagen Jorn Gen 6: health-history sync wire protocol

Checked: 2026-11-12. For issue #429.

Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. I downloaded each file below as raw bytes from `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/<sha>/<path>` and read it directly. Nothing was executed or built. All line numbers refer to that commit. Upstream is AGPL-3.0-or-later, and so is OpenValens.

Notation:

- **INFERRED** means I deduced it and did not read it in source.
- **UNKNOWN** means the source does not settle it.
- Everything else is read from the cited line.

## 0. Path aliases used in citations

| Alias | Path at the pin |
|---|---|
| `G/` | `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/` |
| `D/` | `G/devices/qhybrid/` |
| `S/` | `G/service/devices/qhybrid/` |
| `Coord` | `D/QHybridCoordinator.kt` |
| `Sup` | `S/QHybridSupport.java` |
| `Base` | `S/QHybridBaseSupport.java` |
| `Fac` | `S/adapter/WatchAdapterFactory.java` |
| `WA` | `S/adapter/WatchAdapter.java` |
| `FWA` | `S/adapter/fossil/FossilWatchAdapter.java` (queue and base logic) |
| `HRA` | `S/adapter/fossil_hr/FossilHRWatchAdapter.java` (HR subclass) |
| `Req` | `S/requests/Request.java` |
| `FReq` | `S/requests/fossil/FossilRequest.java` |
| `Mtu` | `S/requests/fossil/RequestMtuRequest.java` |
| `Auth*` | `S/requests/fossil_hr/authentication/<Name>.java` |
| `Verify` | `S/requests/fossil_hr/authentication/VerifyPrivateKeyRequest.java` |
| `Lookup` | `S/requests/fossil/file/FileLookupRequest.java` |
| `RawGet` | `S/requests/fossil/file/FileGetRawRequest.java` |
| `Get` | `S/requests/fossil/file/FileGetRequest.java` |
| `EncGet` | `S/requests/fossil_hr/file/FileEncryptedGetRequest.java` |
| `EncLAG` | `S/requests/fossil_hr/file/FileEncryptedLookupAndGetRequest.java` |
| `EncPut` | `S/requests/fossil_hr/file/FileEncryptedPutRequest.java` |
| `Put` | `S/requests/fossil/file/FilePutRequest.java` |
| `Del` | `S/requests/fossil/file/FileDeleteRequest.java` |
| `Close` | `S/requests/fossil/file/FileCloseRequest.java` |
| `RC` | `S/requests/fossil_hr/file/ResultCode.java` |
| `FH` | `S/file/FileHandle.java` |
| `DevInfo` | `S/requests/fossil/device_info/GetDeviceInfoRequest.java` |
| `AFP` | `S/parser/ActivityFileParser.java` |
| `AE` | `S/parser/ActivityEntry.java` |
| `WSP` | `S/parser/HybridHRWorkoutSummaryParser.java` |
| `Prov` | `D/HybridHRActivitySampleProvider.java` |
| `Dao` | `GBDaoGenerator/src/nodomain/freeyourgadget/gadgetbridge/daogen/GBDaoGenerator.java` |

---

## 1. Device identification

### 1.1 Discovery: by service UUID only, never by name

- Upstream accepts a scan candidate only if it advertises service `3dda0001-957f-7d4a-34a6-74696673696d` (`Coord:57-64`). The BLE scan filter uses the same UUID (`Coord:66-72`).
- Upstream never matches on the advertised name. The same UUID is advertised by the whole "QHybrid" family, including non-HR Q Hybrids (Q Commuter, Q Activist and others). So the advertisement alone cannot tell the three target models apart from other Fossil hybrids.
- The bonding style is not overridden, so it inherits `BONDING_STYLE_ASK` (`G/devices/AbstractDeviceCoordinator.java:724-726`). An OS-level bond is therefore optional upstream, and authentication happens at the application layer (§3).
- `useAutoConnect()` returns false (`Base:29-31`).

### 1.2 After connecting: telling the models apart

The model is decided after connecting, from two standard Device Information reads.

**Firmware Revision (`0x2A26`) picks the protocol adapter.** The handler is at `Sup:750-764`, and it calls `Fac:25-39`:

```java
char hardwareVersion = firmwareVersion.charAt(2);
if(hardwareVersion == '1') return new FossilHRWatchAdapter(deviceSupport);
if(firmwareVersion.startsWith("IV0")) return new FossilHRWatchAdapter(deviceSupport);
if(firmwareVersion.startsWith("VA")) return new FossilHRWatchAdapter(deviceSupport);
if(firmwareVersion.startsWith("WA")) return new FossilHRWatchAdapter(deviceSupport);
char major = firmwareVersion.charAt(6);   // '0','1' -> Misfit adapter, '2' -> non-HR Fossil adapter
```

The same handler extracts a clean firmware version (`firmwareVersion2`) with the regex `(?<=[A-Z]{2}[0-9]\.[0-9]\.)[0-9]+\.[0-9]+` (`Sup:754-759`). For example, a firmware string shaped like `DN1.0.2.20r…` gives `2.20` (the example string is INFERRED). The HR adapter uses this value for the `>= 2.22` confirmation gate (`HRA:303`, `HRA:2145-2147`). `Version` throws on a null or non-numeric input (`G/util/Version.java:31-38`).

**Model Number (`0x2A24`) sets the display name**, through `gbDevice.setName(watchAdapter.getModelName())` (`Sup:766-769`). The mapping is at `WA:80-96`:

| 0x2A24 value | Name upstream assigns |
|---|---|
| `HW.0.0` | Q Commuter |
| `HL.0.0` | Q Activist |
| `IV.0.0` | Hybrid HR |
| `DN.1.0` | Hybrid HR Collider |
| `VA.0.0`, `WA.0.0` | Fossil Gen. 6 Hybrid |
| anything else | `unknown Q` |

**Capability gates depend on that name:**

- `isHybridHR(device)` is true when the name starts with `"Hybrid HR"` or equals `"Fossil Gen. 6 Hybrid"` (`Coord:265-269`).
- `supportsSpo2` is true only when the name equals `"Fossil Gen. 6 Hybrid"` (`Coord:307-309`).
- `supportsActivityTracking` is always true (`Coord:78-80`).
- `supportsRecordedActivities` (workouts) is `isHybridHR` (`Coord:82-84`).
- Key entry: the pairing-key setting is exposed only for HR devices (`Coord:236-245`). The help URL is `https://gadgetbridge.org/basics/pairing/fossil-server/` (`Coord:247-249`).

**Skagen Jorn Gen 6: UNKNOWN.** No Skagen string appears anywhere in the reviewed source. INFERRED: the Jorn is a rebadged Gen 6 Hybrid that reports `VA`/`WA` firmware and model strings. If it reported anything else, the HR adapter would still be chosen only if the firmware string matches a rule in `Fac:26-30`, and the name would become `unknown Q`, which turns off `isHybridHR` and `supportsSpo2`.

### 1.3 Services and characteristics

**Services registered by upstream** (`Sup:144-149`):

- `108b5094-4c03-e51c-555e-105d1a1155f0` (voice/Alexa side channel; INFERRED from the handlers below)
- `3dda0001-957f-7d4a-34a6-74696673696d` (main Fossil service)
- Device Information, GAP, Heart Rate, Battery

**Characteristic roles:**

| UUID | Role (source) | Direction |
|---|---|---|
| `3dda0002-957f-7d4a-34a6-74696673696d` | "Basic" request channel, the default `Request` UUID (`Req:53-55`). Carries `CheckDevicePairing` / `PerformDevicePairing` (`AuthCheckDevicePairingRequest:55-58`). | write + notify |
| `3dda0003-957f-7d4a-34a6-74696673696d` | File-transfer control, the default `FossilRequest` UUID (`FReq:30-33`). Used for lookup, get, delete, put and close. | write + notify |
| `3dda0004-957f-7d4a-34a6-74696673696d` | File data. Downloads arrive as notifications (`RawGet:126-131`, `EncGet:175-214`). Upload packets are written here (`EncPut:90`). | notify (download), write (upload) |
| `3dda0005-957f-7d4a-34a6-74696673696d` | Authentication (`AuthAuthenticationRequest:24-27`). | write + notify |
| `3dda0006-957f-7d4a-34a6-74696673696d` | Asynchronous watch events such as buttons, JSON requests and workout-app requests (`FWA:742-745`, `FWA:810-822`, `HRA:1946-1960`). Not routed to the request queue. | notify |
| `3dda0007-957f-7d4a-34a6-74696673696d` | Notifications enabled by the `2..7` loop (`Sup:508-509`). No handler found. UNKNOWN purpose. | notify |
| `010541ae-efe8-11c0-91c0-105d1a1155f0` | Voice status (`HRA:481-483`) | notify |
| `842d2791-0d20-4ce4-1ada-105d1a1155f0` | Voice data (`HRA:484-486`) | notify |
| `fef9589f-9c21-4d19-9fc0-105d1a1155f0` | Notifications enabled (`Sup:512`). No handler found. UNKNOWN. | notify |
| `0x2A19` Battery Level | Read once at init (`Sup:516`, `Sup:779-788`) | read |
| `0x2A26` Firmware Revision | Read, and creates the adapter (`Sup:517`, `Sup:750-764`) | read |
| `0x2A24` Model Number | Read, and sets the name (`Sup:518`, `Sup:766-777`) | read |
| `0x2A37` HR Measurement | A handler exists (`FWA:746-748`, `HRA:1937-1943`), but the notify line is commented out at init (`Sup:519`). | (not enabled) |

**Write type (with or without response): UNKNOWN from source.**

- Upstream never chooses a write type. `WriteAction` passes `characteristic.getWriteType()`, which is the Android default derived from the characteristic's properties (`G/service/btle/actions/WriteAction.java:83`).
- An optional per-device "synchronous writes" preference (default `false`) forces `WRITE_TYPE_DEFAULT` when a characteristic has both properties (`G/service/btle/AbstractBTLESingleDeviceSupport.java:295`, `:314-323`). The comment there says Android defaults to no-response when both properties are set.
- The characteristic properties themselves are not in source.
- `getSendWriteRequestResponse() = false` (`Base:38-41`) concerns the phone-side GATT server only, not client writes (`G/service/btle/BtLEQueue.java:1124`).
- Recommendation (INFERRED): read the properties at runtime and prefer write-with-response where it is offered.

When enabling notifications, upstream writes the notification CCCD value if notify is supported, otherwise the indication value (`G/service/btle/actions/NotifyAction.java:116-121`).

---

## 2. Connection setup sequence

The order below is exactly what upstream does. Steps 1 to 3 belong to `QHybridSupport.initializeDevice` (`Sup:497-526`). They run on the Gadgetbridge BLE queue, which serializes GATT operations.

1. **Enable notifications**, in this order:
   - `3dda0002` through `3dda0007` (`Sup:508-509`)
   - `010541ae…`, `fef9589f…`, `842d2791…` (`Sup:511-513`)

   A missing characteristic is skipped with a warning (`G/service/btle/TransactionBuilder.java:260-266`).
2. **Read `0x2A19`** (battery), **`0x2A26`** (firmware) and **`0x2A24`** (model), in that order (`Sup:515-518`).
3. **The `0x2A26` result creates the adapter and calls `FossilHRWatchAdapter.initialize()`** (`Sup:761-762`). The `0x2A24` read is still pending at that point; when it arrives it calls `watchAdapter.getModelName()` (`Sup:769`).
4. **`HRA.initialize()`** (`HRA:255-264`):
   - Starts the timeout thread.
   - `queueWrite(new RequestMtuRequest(512))`. This issues a GATT `requestMtu(512)` and marks the MTU request as the in-flight request (`FWA:949-960`). It completes in `onMtuChanged`, which stores the MTU, marks the request finished and dequeues the next request (`FWA:929-947`).
   - `listApplications()`: an `ApplicationsListRequest`. This is a lookup plus an unencrypted get of `APP_CODE` (major `0x15`) (`S/requests/fossil_hr/application/ApplicationsListRequest.java:29-32`, `FH:41`). It is queued behind the MTU request.
   - `getDeviceInfos()`: `GetDeviceInfoRequest`, an unencrypted `FileGetRequest` of `DEVICE_INFO` with handle `0x0B00` and no lookup (`DevInfo:56-58`, `FH:35`).
5. **Device-info file** (`DevInfo:60-88`). The 12-byte header and 4-byte trailer are stripped (`Get:33-34`). The body is a TLV list of `[type u16 LE][len u8][payload]`:
   - Type `0x0a` is the supported-file-versions list, made of `[handle u8][version u16 LE]` triples (`S/requests/fossil/device_info/SupportedFileVersionsInfo.java:29-43`).
   - Type `0x0e` is the security version, `[major][minor]` (`S/requests/fossil/device_info/DeviceSecurityVersionInfo.java:24-28`).
   - When done, it calls `initializeWithSupportedFileVersions()` (`FWA:218-232`).
6. **`HRA.initializeWithSupportedFileVersions()`** (`HRA:267-277`):
   - If the firmware string contains `"prod"`, upstream treats it as dummy firmware, skips authentication and marks the device INITIALIZED.
   - Otherwise it sets state AUTHENTICATING and calls `negotiateSymmetricKey()`, which runs a `VerifyPrivateKeyRequest` (§3).
7. **After authentication**, follow-up configuration runs (§3.4). A health-only port can skip it, except that setting the time affects the timestamps (§5.6).

**MTU edge cases** (consequences INFERRED; the code is read):

- `onMtuChanged` returns early if the new MTU equals the stored one, whose initial value is 23 (`FWA:115`, `FWA:933-936`). It also returns early on a non-success GATT status (`Sup:672-674`).
- In both cases the MTU request is never finished.
- `queueWrite(RequestMtuRequest)` never starts the 5-minute timeout (`FWA:949-960`), so the whole queue stalls.
- A port should treat the MTU step as best-effort and always continue.

---

## 3. Authentication

### 3.1 The key

- The user supplies a 16-byte key as a hex string in the per-device preference `authkey`.
- Upstream removes all spaces and every `"0x"` substring, requires exactly 32 hex characters (otherwise it throws `IllegalAccessException`), and copies the 16 bytes (`HRA:1719-1737`).
- If the preference is absent or empty, the key is 16 zero bytes (`HRA:1720`, `HRA:1725`).
- The key is used directly as the AES-128 key for both authentication and file encryption (`Verify:62`, `EncGet:78`, `EncPut:96`). **No session key is derived.** What changes per session is the pair of random values that form the CTR IV (§4.4).

### 3.2 VerifyPrivateKeyRequest: challenge and response

All traffic goes over `3dda0005` (`AuthAuthenticationRequest:24-27`).

**Step 1. Phone to watch (write, 11 bytes)** (`Verify:115-130`):

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | `02` | op |
| 1 | `01` | sub-op "start" |
| 2 | `01` | |
| 3..10 | 8 bytes | `phoneRandom`, from `java.util.Random().nextBytes` |

Implementation detail: `getStartSequence()` generates a new random every time it is called. The `Request` constructor calls it once and stores the result as `data` (`Req:33-35`). Upstream never calls it again for this request, because `getType()` is only used for `3dda0003` notifications (`FWA:757-758`). A port must generate the random exactly once and keep the same value it sent.

**Step 2. Watch to phone (notification on `3dda0005`), recognised by `value[1] == 0x01`** (`Verify:54-95`):

| Offset | Meaning |
|---|---|
| 0 | Not checked by upstream. INFERRED `0x03` (the response byte seen in the sibling requests). |
| 1 | `0x01` |
| 2..3 | Not checked. UNKNOWN. |
| 4..19 | 16-byte ciphertext `C` |

The phone then computes:

```java
P = AES/CBC/NoPadding.decrypt(key, IV = 16×00, C)        // single block, so this equals AES-128-ECB decrypt
watchRandom = P[0..7]
toEncrypt   = P[8..15] || P[0..7]                         // halves swapped
R = AES/CBC/NoPadding.encrypt(key, IV = 16×00, toEncrypt) // equals AES-128-ECB encrypt
```

(`Verify:56-81`.) Notes:

- INFERRED: `P[8..15]` is the watch echoing `phoneRandom`. Upstream does **not** check this.
- `adapter.watchRandom` and `adapter.phoneRandom` are stored at this point (`Verify:76-77`).

**Step 3. Phone to watch (write, 19 bytes)**: `02 02 01 || R[0..15]` (`Verify:83-92`).

This write goes straight to the BLE queue (`createTransactionBuilder(...).write(characteristic, payload).queue()`). It is **not** a new queued request, so the Verify request stays in flight.

**Step 4. Watch to phone (notification), recognised by `value[1] == 0x02`**: `value[2]` is a `ResultCode` (`Verify:96-105`, `RC:19-45`).

- `0x00` (SUCCESS) means authenticated.
- Anything else means failure. `handleAuthenticationResult(false)` is called first, then a `RuntimeException` is thrown, which the queue treats as "request finished" (`FWA:767-778`).

**Other failure paths:**

- If the GATT write to `3dda0005` fails, the device is set to AUTHENTICATION_REQUIRED and the whole request queue is cleared (`FWA:238-245`).
- The 19-byte frame fits the default 20-byte write payload, so authentication does not depend on the MTU upgrade. (INFERRED from the length.)

**Signed status byte.** Java reads the status as a signed `byte`. Codes 128 to 141 therefore arrive as negative numbers, and `fromCode` maps them to `UNKNOWN`, except `0x83`, which becomes `-125` and maps to `UNKNOWN_1` (`RC:42-45`, `RC:59-66`). INFERRED: `UNKNOWN_1(-125)` is really `0x83` (`FIRMWARE_INTERNAL_ERROR_NOT_FOUND`). A port should read status bytes as unsigned and treat any non-zero value as failure.

### 3.3 Firmware-dependent on-watch confirmation and pairing

Flow at `HRA:295-378`:

1. `handleAuthenticationResult(success)` runs only while `connectionMode == NOT_INITIALIZED`. It sets AUTHENTICATED or NOT_AUTHENTICATED (`HRA:515-519`).
2. If authentication failed: toast, then `initializeAfterWatchConfirmation(false)` (`HRA:298-302`).
3. If `cleanFirmwareVersion < 2.22`: skip confirmation and continue with `initializeAfterWatchConfirmation(true)` (`HRA:303-307`).
4. If the preference `enable_on_device_confirmation` (default `true`) is off: `initializeAfterWatchConfirmation(false)` (`HRA:308-313`).
5. Otherwise, `confirmOnWatch()`.

The confirmation requests:

| Request | Characteristic | Phone to watch | Watch to phone | Source |
|---|---|---|---|---|
| CheckDeviceNeedsConfirmation | `3dda0005` | `01 07` | `03 07 XX` (exactly 3 bytes); needs confirmation iff `XX == 00` | `AuthCheckDeviceNeedsConfirmationRequest:23-41` |
| ConfirmOnDevice | `3dda0005` | `02 06 30 75 00 00 00` (`0x7530` = 30000, INFERRED to be a timeout in ms) | `03 06 00 XX` (exactly 4 bytes); confirmed iff `XX == 01` | `AuthConfirmOnDeviceRequest:24-42` |
| CheckDevicePairing | `3dda0002` | `01 16` | `03 16 XX` (exactly 3 bytes); paired iff `XX == 01` | `AuthCheckDevicePairingRequest:28-58` |
| PerformDevicePairing | `3dda0002` | `02 16` | same parser as CheckDevicePairing | `AuthPerformDevicePairingRequest:19-23` |

Sequencing:

- ConfirmOnDevice is queued with priority, and a 30-second phone-side timer runs. On expiry, upstream calls `onResult(false)` if the request is still current (`HRA:317-326`, `HRA:336-349`).
- If the user confirms: `pairToWatch()`, then `initializeAfterWatchConfirmation(true)` (`HRA:341-346`).
- `pairToWatch()` sends PerformDevicePairing only when CheckDevicePairing reports "not paired" (`HRA:357-378`).

**Consequence (read):** declining the confirmation, or turning it off, does **not** change `connectionMode` from AUTHENTICATED. Upstream will still try the encrypted activity fetch. Whether the watch refuses encrypted file access without confirmation is UNKNOWN.

### 3.4 Post-authentication initialisation (`HRA:491-513`)

Upstream sends notification and quick-reply configuration, then, only if authenticated, units, settings sync and `setTime()`. After that come buttons, background, widgets, the app cache and the calendar, and finally the device is set INITIALIZED.

For a health-only port the only relevant item is `setTime()` (§5.6). The rest is UI and peripheral configuration.

### 3.5 Every encrypted request gets a fresh verify first

The HR adapter's `queueWrite(FileEncryptedInterface)` wraps each encrypted request (`HRA:1153-1170`):

1. It first queues a new `VerifyPrivateKeyRequest`.
2. Only on success does it queue the real request, with priority (`queueWrite((FossilRequest) request, true)`).
3. On failure the real request is silently dropped.

So every top-level encrypted get or put renews `phoneRandom` and `watchRandom`.

Nested requests behave differently. `FileEncryptedLookupAndGetRequest.handleFileLookup` queues its `FileEncryptedGetRequest` directly through the base `queueWrite(FossilRequest, true)`, with no fresh verify, so the randoms from the verify before the lookup are reused (`EncLAG:28-36`). INFERRED: the watch accepts randoms from the latest successful verify even when an unencrypted lookup sits between them.

---

## 4. File protocol: downloading the activity file

### 4.1 File handles (`FH:19-42`)

The handle is `(major << 8) | minor` as a `u16` (`FH:69-71`). On the wire it is little-endian, so the byte order is `[minor][major]` (`EncGet:61-67`, `Del:35-39`).

| Name | major | minor |
|---|---|---|
| OTA_FILE | 0x00 | 0x00 |
| **ACTIVITY_FILE** | **0x01** | **0x00** |
| HARDWARE_LOG_FILE | 0x02 | 0x00 |
| FONT_FILE | 0x03 | 0x00 |
| MUSIC_INFO | 0x04 | 0x00 |
| UI_CONTROL | 0x05 | 0x00 |
| HAND_ACTIONS / SETTINGS_BUTTONS | 0x06 | 0x00 |
| ASSET_BACKGROUND_IMAGES / NOTIFICATION_IMAGES / TRANSLATIONS / REPLY_IMAGES | 0x07 | 0x00 / 0x01 / 0x02 / 0x03 |
| CONFIGURATION | 0x08 | 0x00 |
| NOTIFICATION_PLAY | 0x09 | 0x00 |
| ALARMS | 0x0A | 0x00 |
| DEVICE_INFO | 0x0B | 0x00 |
| NOTIFICATION_FILTER | 0x0C | 0x00 |
| WATCH_PARAMETERS | 0x0E | 0x00 |
| LOOK_UP_TABLE | 0x0F | 0x00 |
| RATE | 0x10 | 0x00 |
| REPLY_MESSAGES | 0x13 | 0x00 |
| APP_CODE | 0x15 | 0xFE |

### 4.2 Shape of control responses on `3dda0003`

- Every response is a notification on `3dda0003`. Upstream identifies the response type by the **low nibble** of byte 0:
  - `1` = get (`EncGet:124`, `RawGet:78`)
  - `2` = lookup (`Lookup:73`)
  - `3` = put accepted (`EncPut:83-84`)
  - `4` = put close (`EncPut:165-167`)
  - `8` = transfer complete, carrying the CRC (`EncGet:149`, `Lookup:97`)
  - `9` = put timeout (`EncPut:196-198`), and also the type `FileCloseRequest` expects (`Close:54-56`)
  - `0x0A` is ignored by the adapter's type check (`FWA:760`) and by `FileVerifyRequest` (`S/requests/fossil/file/FileVerifyRequest.java:54`). UNKNOWN meaning, INFERRED "in progress" or keep-alive.
- Only the delete request checks the full byte: `0x8B` (`Del:54`). INFERRED: the high nibble `0x8` marks a response, so a type-`N` response is `0x8N`.
- The adapter's check that the response type matches the request type is commented out (`FWA:757-763`).

### 4.3 Step A: Lookup (unencrypted)

The lookup resolves the static handle `0x0100` to the dynamic handle of the current file.

Upstream reaches this step only after `syncSettings()` has queued an encrypted `ConfigurationGetRequest` (`HRA:1264`, `HRA:1334-1340`), and only while `connectionMode != NOT_AUTHENTICATED` (`HRA:1259-1262`). The configuration read is not required for activity data (INFERRED).

**Request** (write `3dda0003`, 3 bytes) (`Lookup:43-51`, `Lookup:136-144`):

```
02 FF 01        // [op=0x02][0xFF][major=0x01]
```

INFERRED: `FF 01` is handle `0x01FF` in little-endian, meaning "minor wildcard, major ACTIVITY".

**Response 1** (notify `3dda0003`, low nibble 2) (`Lookup:73-96`):

| Offset | Type | Meaning |
|---|---|---|
| 0 | u8 | `0x?2` |
| 1..2 | u16 LE | handle. Upstream ignores it; the comparison is commented out (`Lookup:87-89`). |
| 3 | u8 | ResultCode. Non-zero throws (`Lookup:80-85`). |
| 4..7 | u32 LE | size of the lookup payload. **`0` means FILE_EMPTY**: there is no activity data, and the request finishes (`Lookup:91-95`, `HRA:1321-1323`). |

**Data** (notify `3dda0004`, **not encrypted** for lookup) (`Lookup:119-124`): byte 0 is the packet marker, and bytes 1 onward are appended. A marker with `0x80` set ends the payload.

**Response 2** (notify `3dda0003`, low nibble 8) (`Lookup:97-117`):

- bytes 8..11 are a `u32 LE` CRC that must equal `java.util.zip.CRC32` over the reassembled payload.
- Then `handle = u16 LE payload[0..1]`. This is the dynamic handle, for example `0x01xx`.

### 4.4 Step B: Fresh verify, then encrypted get

The HR adapter wraps the get in `queueWrite(FileEncryptedInterface)`, so a new verify (§3.2) runs first (`HRA:1269`, `HRA:1153-1166`).

**Request** (write `3dda0003`, 11 bytes) (`EncGet:56-72`, `EncGet:217-225`):

| Offset | Bytes |
|---|---|
| 0 | `01` (op get) |
| 1 | minor (from the lookup handle) |
| 2 | major |
| 3..6 | `00 00 00 00` (u32 LE start offset, INFERRED) |
| 7..10 | `FF FF FF FF` (u32 LE length or end, meaning "all", INFERRED) |

**Response 1** (notify `3dda0003`, low nibble 1) (`EncGet:124-148`):

| Offset | Meaning |
|---|---|
| 1 | minor (must match, otherwise throw) |
| 2 | major (must match, otherwise throw) |
| 3 | ResultCode (non-zero throws) |
| 4..7 | u32 LE `fileSize`. The receive buffer is allocated to exactly this size. |

Upstream builds the IV when this response arrives (`initDecryption`, `EncGet:74-98`):

```java
byte[] iv = new byte[16];                          // all 0x00
System.arraycopy(phoneRandom, 0, iv, 2, 6);        // iv[2..7]  = phoneRandom[0..5]
System.arraycopy(watchRandom, 0, iv, 9, 7);        // iv[9..15] = watchRandom[0..6]
iv[7]++;                                           // iv[7] = (phoneRandom[5] + 1) & 0xFF
```

Resulting IV layout:

| iv byte | 0 | 1 | 2..6 | 7 | 8 | 9..15 |
|---|---|---|---|---|---|---|
| value | 00 | 00 | phone[0..4] | phone[5]+1 | 00 | watch[0..6] |

The same construction is used for uploads (`EncPut:104-115`).

**Data** (notify `3dda0004`, **AES-128-CTR/NoPadding** with the user key) (`EncGet:175-214`). Each notification is decrypted on its own with a freshly initialised cipher. The IV for packet `n` is:

```java
incrementIV(iv, amount): copy iv; read bytes 12..15 as a BIG-endian int32 (ByteBuffer default);
                         add amount (wraps at 32 bits, no carry into byte 11); write back.
packet 0      : IV = incrementIV(iv, ivIncrementor * 0) = iv
packet 1      : brute force testIvSummand in 0x1e..0x2f:
                  decrypt with incrementIV(iv, testIvSummand);
                  accept the first one where plaintext[0] == (completesFile ? 0x81 : 0x01);
                  ivIncrementor = that summand   (initial value 0x1f, EncGet:54)
packet n >= 2 : IV = incrementIV(iv, ivIncrementor * n)
```

(`EncGet:104-113`, `EncGet:178-200`.) Within one packet the cipher is standard JCE `AES/CTR/NoPadding`, which increments the counter as a 128-bit big-endian integer per 16-byte block. That is ordinary AES-CTR semantics (INFERRED from the JCE contract, not from upstream code).

A TypeScript port therefore needs two different increments:

- a **32-bit wrapping** add on bytes 12..15 between packets, and
- **128-bit** counter carry inside a packet.

Node and OpenSSL `aes-128-ctr` (and `react-native-quick-crypto`) provide the 128-bit behaviour. With WebCrypto, `length: 128` matches it.

After decryption (`EncGet:203-208`):

- `plaintext[0]` is the packet marker. `plaintext[1..]` is appended to the buffer.
- `(plaintext[0] & 0x80) == 0x80` marks the final packet, and the buffer becomes `fileData`.
- Bytes beyond `fileSize` throw `BufferOverflowException`, which aborts the request.

**What the summand and marker mean (INFERRED):**

- The summand is the number of 16-byte AES blocks the watch's single CTR stream consumes per notification, so every non-final packet must have the same length. With MTU 512, a 509-byte notification is `ceil(509/16) = 32 = 0x20` blocks, which falls inside upstream's search range.
- At a smaller MTU the search range does not cover the true value. For example, iOS often negotiates 185, which gives 182-byte packets, `ceil(182/16) = 12`. In that case upstream would keep `0x1f`, decrypt garbage, and fail at the CRC check.
- The low 7 bits of the marker are probably a packet sequence number, not a fixed "continuation" value. Upload packets set `packet[0] = i` (`EncPut:255`), and the brute force expects exactly `0x01` on packet index 1.
- So the earlier scoping note ("0x01 continuation / 0x81 final") is only right for packet 1. Upstream itself tests only bit `0x80`.
- Recommendation: derive the summand from `ceil(len(packet0)/16)`, confirm it by checking the marker sequence, and fall back to a wider search.

**Response 2** (notify `3dda0003`, low nibble 8) (`EncGet:149-174`):

| Offset | Meaning |
|---|---|
| 1 | minor (must match) |
| 2 | major (must match) |
| 3..7 | Not read. UNKNOWN. INFERRED status and size. |
| 8..11 | u32 LE CRC |

- **CRC check:** `java.util.zip.CRC32` (standard IEEE/zlib CRC-32, **not CRC32C**) over the full reassembled **plaintext** `fileData`. That is every packet's bytes after the marker, including the file's own 12-byte header and 4-byte trailer (`EncGet:164-171`).
- On a match, `handleFileData(fileData)` runs synchronously inside the notification callback (`EncGet:173`).
- If no final packet ever arrived, `fileData` is null, the CRC computation throws, and nothing is persisted (INFERRED from `EncGet:165`).

**Where CRC32C actually appears:** only in the **file container trailer** of uploaded files. It is computed over the payload alone, with the CRC32 over the whole container also checked (`Put:39-60`, `EncPut:238-248`). For downloaded files, INFERRED: the last 4 bytes are the same CRC32C over the payload. Upstream never verifies them; the parser just stops 4 bytes before the end (§5). The scoping note's "CRC32C" therefore applies to the container, not to the transport check.

### 4.5 Step C: Close or ack

There is none. `FileCloseRequest` (`09 <handle LE>`, expected response type 9 with a 4-byte `[t][handle LE][status]`; `Close:34-90`) has **no call site** in the reviewed code. The only call sites for delete and verify are `FWA:645`, `HRA:527`, `HRA:1305`, and a commented-out line at `FWA:499`. The get flow ends at the type-8 response.

### 4.6 Step D: Delete (unencrypted)

See §6 for when it is sent. Request on `3dda0003`, 3 bytes: `0B <minor> <major>`, using the handle returned by the lookup (`Del:32-40`, `Del:73-81`).

The response must be exactly 4 bytes on `3dda0003` (`Del:47-66`):

- byte 0 = `0x8B`
- bytes 1..2 = the u16 LE handle, which must match
- byte 3 = ResultCode, which must be 0

Any mismatch throws. The adapter logs the exception and moves to the next request (`FWA:767-788`). There is no retry.

### 4.7 Timeouts

- **Per request:** 5 minutes (`FWA:134`). The timer restarts only when a `FossilRequest` starts executing (`FWA:1001`) and stops when it finishes (`FWA:783`, `FWA:1007`). It does **not** restart for each data packet, so a whole download must finish within 5 minutes of the get request starting.
- **On expiry:** the in-flight request is dropped and the next one starts (`FWA:148-159`).
- **ConfirmOnDevice:** 30 seconds (`HRA:349`).

### 4.8 ResultCode table (`RC:19-45`)

| Code | Name |
|---|---|
| 0 | SUCCESS (the only success value) |
| 1 | INVALID_OPERATION_DATA |
| 2 | OPERATION_IN_PROGRESS |
| 3 | MISS_PACKET |
| 4 | SOCKET_BUSY |
| 5 | VERIFICATION_FAIL |
| 6 | OVERFLOW |
| 7 | SIZE_OVER_LIMIT |
| 128 | FIRMWARE_INTERNAL_ERROR |
| 129 | …NOT_OPEN |
| 130 | …ACCESS_ERROR |
| 131 | …NOT_FOUND |
| 132 | …NOT_VALID |
| 133 | …ALREADY_CREATE |
| 134 | …NOT_ENOUGH_MEMORY |
| 135 | …NOT_IMPLEMENTED |
| 136 | …NOT_SUPPORT |
| 137 | …SOCKET_BUSY |
| 138 | …SOCKET_ALREADY_OPEN |
| 139 | …INPUT_DATA_INVALID |
| 140 | FIRMWARE_INTERNAL_NOT_AUTHENTICATE |
| 141 | FIRMWARE_INTERNAL_SIZE_OVER_LIMIT |

Remember the signed-byte quirk from §3.2.

---

## 5. Activity file format

`parseFile` receives the whole decrypted container, including its header and trailer (`HRA:1277-1278`). All values are **little-endian** (`AFP:45-46`).

### 5.1 Header

| Offset | Type | Read by upstream | Meaning |
|---|---|---|---|
| 0..1 | u16 | no | File handle (INFERRED from the container layout at `Put:43`) |
| 2..3 | u16 | **yes** | **File version. Must be 22**, otherwise `RuntimeException` (`AFP:49-50`). The message wrongly says "16 required". |
| 4..7 | u32 | no | INFERRED offset (container layout `Put:48`) |
| 8..11 | i32 | **yes** | Initial `currentTimestamp` in Unix seconds (`AFP:52`). This conflicts with the upload container layout, where bytes 8..11 are the payload length (`Put:50`). UNKNOWN which is right for activity files; see §9. |
| 12..13 | i16 | read, **discarded** | `timeOffsetMinutes` (`AFP:54`) |
| 16..17 | i16 | read, **discarded** | `fileId` (`AFP:56`) |
| 32..41 | | no-HR variant only | Timestamp-sync block `E2 04 <ts i32> <duration i16> <offset i16>`. The comment says it is always at offset 32 (`AFP:82-85`). |
| 34..37 | i32 | no-HR variant | Replaces `currentTimestamp` (`AFP:85`) |
| 44 | | no-HR variant | First 4-byte record (`AFP:87`) |
| 52 | | HR variant | Marker stream starts here (`AFP:116`) |

**Only version 22 is handled.** There is no other version branch.

### 5.2 Variant detection (`AFP:58-78`)

The file is the HR variant if `file[52]` is one of `CE C2 E2 E0 DD D6 CB CC CF`. Otherwise it is the step-only ("no-HR") variant.

### 5.3 No-HR variant: fixed 4-byte records (`AFP:81-112`)

Records start at offset 44 and repeat while `pos <= len - 4`:

| Byte | Meaning |
|---|---|
| 0 | `varLo` (variability and steps, §5.5) |
| 1 | `varHi` |
| 2 | Must be `0xFF`, otherwise **parsing stops** (`AFP:94`) |
| 3 | flags: `active = (b & 0x40) != 0`, `calories = b & 0x3F` |

Each record also gets:

- `timestamp = currentTimestamp`, then `+60` seconds for the next record
- `wearingState = WEARING`
- `heartRate = 0` (the Java default)
- `heartRateQuality = 0`

INFERRED risks:

- The loop bound reaches into the 4-byte trailer, so a trailer whose third byte is `0xFF` becomes a spurious record.
- Stopping early on a non-`0xFF` byte silently drops the rest of the file.

### 5.4 HR variant: marker stream from offset 52 (`AFP:115-284`)

The loop runs `while position < capacity - 4`, so the last 4 bytes (INFERRED trailer) are never read. Unrecognised bytes are skipped one at a time (`AFP:280-281`).

`valid(x)` means `x` is one of `CE DD CB CC CF D6 E2`. This set excludes `C2` and `E0` (`AFP:286-291`).

| Lead byte | Layout (after the lead byte) | Effect | Source |
|---|---|---|---|
| `CE` | `wear` | Sets the wear state from bits 3-4 and HR quality from bits 5-7 (§5.5). Followed by `f1 f2` and one of the sub-cases below. | `AFP:124-127`, `AFP:312-320` |
| `CE` → `f1 f2 = E2 04` | `ts i32`, `duration i16`, `minutesOffset i16`, then a 4-byte sample | **Resyncs `currentTimestamp = ts`.** The duration and offset are discarded. | `AFP:129-133`, `AFP:191-200` |
| `CE` → `f1 = D3` (workout-related) | `f2` = hr1, `info[2]`, then: if the next byte is `DF`, skip 1 plus either 11 bytes (when `info[0]==08`) or 3 bytes (when `!valid(peek+4)`); if it is `E2 04`, skip 13 plus 3 conditionally; otherwise skip 1 when `!valid(peek+4)`. Then a 4-byte sample. | Heuristic skip only; nothing is stored | `AFP:135-156` |
| `CE` → `f1 = CF` or `DF` | none | `continue` (nothing else consumed) | `AFP:158-159` |
| `CE` → `f1 = D6` | `f2` (consumed), `spo2 u8`, 3 skipped bytes, then a 4-byte sample | SpO2 sample at `currentTimestamp * 1000` ms | `AFP:161-166` |
| `CE` → `f1 f2 = FE FE` | optional third `FE`, then a 4-byte sample | skip | `AFP:168-171` |
| `CE` → else, if `valid(byte at pos+2)` | `f1`=varLo, `f2`=varHi, then `hr u8`, `cal u8` (**6-byte minute record**) | One minute sample | `AFP:173-185` |
| `CE` → else | `f1 f2` discarded, then `varLo varHi hr cal` (**8-byte minute record**) | One minute sample | `AFP:187-202` |
| `C2` | 3 bytes | skip (the comment cites upstream issue #2884) | `AFP:204-206` |
| `E2` | 9 bytes, plus 6 more if `!valid(next)` | skip. INFERRED: `E2 04 ts dur off`. Does **not** resync the timestamp. | `AFP:208-213` |
| `E0` | 14 TLV attributes `[id u8][size u8][size bytes]` | Workout summary (§5.7) | `AFP:215-260` |
| `DD` | 20 bytes | skip ("no idea") | `AFP:262-264` |
| `D6` | `x u8` (a statistic), `spo2 u8` | SpO2 sample at `currentTimestamp * 1000` | `AFP:266-272` |
| `CB` / `CC` / `CF` | 1 byte | skip | `AFP:274-278` |

**Minute sample construction** (`finishCurrentPacket`, `AFP:322-333`):

- The sample takes `timestamp = currentTimestamp` and the current `heartRateQuality` and `wearingState`.
- It is appended, then `currentTimestamp += 60`.
- The parser calls `finishCurrentPacket` once before the loop (`AFP:118`). At that point `currentSample` is still null, so nothing is emitted.
- **There is no minute-boundary alignment.** Timestamps are whatever the last resync or header value was, plus 60 seconds per sample.
- Resyncs can move time backwards. Samples that land on the same timestamp overwrite each other on insert (§5.8).

### 5.5 Field decoding

**Variability and steps** (`parseVariabilityBytes`, `AFP:293-310`):

```java
if ((lo & 0x01) == 1) {
    maxVariability = (hi & 0x03) * 25 + 1;
    steps          = lo & 0x0E;                       // even values 0..14, NOT shifted
    variability    = (lo & 0x80) != 0
                   ? 512 + ((lo >> 4) & 0x07) * 64 + ((hi >> 2) & 0x3F)
                   : (((lo & 0x70) << 2) | ((hi >> 2) & 0x3F));
} else {
    steps          = lo & 0xFE;                       // even values 0..254
    variability    = hi * hi * 64;
    maxVariability = 10000;
}
```

The semantics of `variability` are UNKNOWN. It is stored raw.

**HR, calories and activity:**

- `hr` is a `u8` stored as-is (`AFP:175`, `AFP:192`). INFERRED: `0` means no reading.
- `cal`: `calories = b & 0x3F`, `isActive = (b & 0x40) != 0` (`AFP:176-178`, `AFP:193-195`). The calorie unit is UNKNOWN and stored raw.

**Wear byte** (`AFP:312-320`):

| `(wear >> 3) & 0x03` | Wear state | Stored `wear_type` | ActivityKind |
|---|---|---|---|
| 0 | NOT_WEARING | 1 | NOT_WORN |
| 1 | WEARING | 0 | NOT_MEASURED |
| 2, 3 | UNKNOWN | 2 | UNKNOWN |

(Stored values from `AE:52-55`.)

`heartRateQuality = (wear >> 5) & 0x07`.

### 5.6 Timestamps and time zone

- Every timestamp is used as a raw Unix epoch value in seconds (`AFP:52`, `AFP:85`, `AFP:133`). Both offset fields in the file are discarded (`AFP:54`, `AFP:132`).
- The watch clock is set by the phone with configuration item id `12`, size 8: `epochSeconds i32 LE`, `millis u16 LE`, `offsetMinutes i16 LE` (`S/requests/fossil/configuration/ConfigurationPutRequest.java:296-329`).
- Upstream sends `epochSeconds = now/1000 + QHYBRID_TIME_OFFSET * 60` (that preference defaults to 0), `millis = now % 1000`, and `offsetMinutes` = the local zone offset (`FWA:360-369`, `Sup:483-485`).
- On HR devices this item travels as an **encrypted put** of handle `0x0800` (`HRA:1207-1215`, `S/requests/fossil_hr/configuration/ConfigurationPutRequest.java:26-49`).
- INFERRED: activity timestamps are UTC epoch as long as the user's time-offset preference is 0. Upstream does not compensate for a non-zero offset when parsing.

### 5.7 Workout summary (`E0`)

- `E0` is followed by 14 TLV attributes, each `id u8`, `size u8`, `data[size]` (`AFP:221-248`).
- Attribute `2` is the duration in seconds, as an `i32` (`AFP:230-232`).
- Attribute `9` byte 0 is the workout type (`AFP:233-246`):
  `01` RUNNING, `02` CYCLING, `03` TREADMILL, `04` CROSS_TRAINER, `05` WEIGHTLIFTING, `06` TRAINING, `08` WALKING, `09` ROWING_MACHINE, `0c` HIKING, `0d` SPINNING. Anything else is ACTIVITY.
- The summary's `start = currentTimestamp - duration` and `end = currentTimestamp`. The raw TLV bytes are stored as `rawSummaryData` (`AFP:253-259`).
- The detail parser later reads more attributes (`WSP:41-76`): `4` steps (`i32`), `5` distance in cm (`/100` gives metres), `6` calories (`i32`), `7` average HR (`u8`), `8` maximum HR (`u8`). An all-`FF` value means absent.

### 5.8 What upstream persists

| Data | Table and fields | Primary key | Write call | Source |
|---|---|---|---|---|
| Minute samples | `HybridHRActivitySample`: `timestamp` (int, s), `deviceId`, `userId`, `steps`, `calories`, `variability`, `max_variability`, `heartrate_quality`, `active` (bool), `wear_type` (byte), `heartRate` | `(timestamp, deviceId)` | `insertOrReplaceInTx`, so re-importing is idempotent | `Dao:1103-1118`, `Dao:1622-1626`, `AE:36-50`, `G/devices/AbstractSampleProvider.java:123-125` |
| SpO2 | `HybridHRSpo2Sample`: `timestamp` (long, **ms**), `deviceId`, `userId`, `spo2` | `(timestamp, deviceId)` | `persistSamples` → `insertOrReplaceInTx`. **Exceptions are caught and only toasted.** | `Dao:1120-1125`, `Dao:1635-1639`, `G/devices/AbstractTimeSampleProvider.java:225-263` |
| Workouts | `BaseActivitySummary` with name, kind, start, end and raw TLV | autoincrement | `summaryDao.insert`, so **re-importing duplicates rows** | `HRA:1292-1299` |

Upstream normalises intensity as `steps / 128`, capped at 1 (`Prov:72-74`, `G/entities/AbstractHybridHRActivitySample.java:28-31`).

---

## 6. Deletion and erase semantics (verified)

**The claim is confirmed: upstream deletes the activity file after a successful parse and persist.**

The sequence is exactly this, inside the `handleFileData` callback of the `FileEncryptedGetRequest` (`HRA:1271-1316`):

1. The type-8 response has already passed the **CRC32** check over the plaintext (`EncGet:164-173`).
2. `try (DBHandler db = acquireDB())`:
   1. `parser.parseFile(fileData)` (`HRA:1277-1278`). A version other than 22, a buffer underflow or any other exception jumps to `catch`, so **there is no delete**.
   2. `provider.addGBActivitySamples(samples)`, a synchronous greenDAO `insertOrReplaceInTx` (`HRA:1280-1286`).
   3. `spo2Provider.persistSamples(...)` (`HRA:1288-1290`). **A failure here is swallowed** (it returns false, and the return value is ignored), so the code still continues to the delete.
   4. `summaryDao.insert(...)` per workout, auto-commit (`HRA:1292-1299`). A throw here jumps to `catch` with no delete, but the earlier inserts are already committed.
   5. Optional raw dump when `save_raw_activity_files` is set (default `false`, `HRA:258`). It happens **after** the database writes, and write errors are swallowed (`HRA:1301-1303`, `FWA:602-615`).
   6. **`queueWrite(new FileDeleteRequest(fileHandle))`** (`HRA:1305`). `fileHandle` is the **dynamic handle from the lookup**, not `0x0100`. The request is `0B <minor> <major>` on `3dda0003` (§4.6). It executes immediately, because the get request has already marked itself finished (INFERRED from `EncGet:150` together with `FWA:991-1003`).
   7. Upstream signals "sync finished" right after queuing the delete, **without waiting for the `0x8B` response** (`HRA:1306-1308`).
3. On any exception: toast, no delete (`HRA:1309-1313`).

**There is no single transaction across the steps.** Each database write commits on its own. The delete is sent only after the activity-sample transaction has returned, but it does not depend on the SpO2 save having succeeded.

**Parse completeness does not gate the delete.** Neither does the number of samples. Unknown markers are skipped silently (`AFP:280-281`), and the no-HR loop stops early without an error (`AFP:94`). Both cases still reach the delete.

**What tells the watch the data was received:** only the delete. No close or ack is sent after the get (§4.5). INFERRED: if the delete is never sent, the next lookup returns the same file again. Activity and SpO2 samples would then be re-imported idempotently, and workouts would be duplicated.

**Open race (INFERRED and UNKNOWN):** upstream does not handle minutes the watch records between the encrypted get and the delete. If the firmware keeps appending to the same dynamic handle, those minutes are lost. If it rolls over to a new handle or minor number, they are safe. The source does not show which happens.

The non-HR adapter does the same thing with an unencrypted lookup-and-get (`FWA:617-648`).

**Implications for our design (requirements only, no implementation):**

- Make the raw decrypted file and the parsed records durable before writing `0B`.
- Delete only the exact handle that was fetched, and only after the transport CRC32 has passed.
- Consider also gating the delete on a full-consumption parse and on the optional trailing CRC32C.

---

## 7. Sleep

**Upstream neither derives nor stores sleep for these models.** The evidence:

- The parser emits only minute activity samples, SpO2 samples and workout summaries. No sleep marker or record is handled (`AFP:39-41`, `AFP:335-345`).
- The only kinds the samples can carry are wear states, which map to NOT_MEASURED, NOT_WORN or UNKNOWN (`AE:52-55`, `Prov:60-64`, `G/entities/AbstractHybridHRActivitySample.java:23-26`). `toRawActivityKind` always returns 0 (`Prov:66-69`).
- The coordinator does not override `getSleepSessionProvider`, so it gets `DefaultSleepSessionProvider` (`G/devices/AbstractDeviceCoordinator.java:514-516`). That provider segments on `ActivityKind.isSleep(sample.getKind())` (`G/devices/DefaultSleepSessionProvider.java:45-57`, `G/devices/SleepSessionSegmenter.java:46`), which is never true for these samples.
- `supportsSleepMeasurement` defaults to `supportsActivityTracking`, which is true (`G/devices/AbstractDeviceCoordinator.java:872-874`, `Coord:78-80`). So the UI exposes sleep, but it is always empty.
- `HybridHRActivitySampleProvider` never calls `overlaySleep` (`Prov:32-80`, against the definition at `G/devices/AbstractSampleProvider.java:713-759`).

A heart-rate-plus-movement sleep estimator does exist in Gadgetbridge (`SleepStageEstimator`), but only Huami uses it. Applying it to Fossil data would be our own derivation, not a port.

---

## 8. Concurrency and ordering assumptions a port must reproduce

1. **One request in flight.** `fossilRequest` is a single slot. Pending work sits in an `ArrayList` FIFO, and "prioritise" inserts at the head (`FWA:111-113`, `FWA:985-999`). A new request is written only when the slot is empty or holds a finished request (`FWA:991`).
2. **Routing.** Every notification on `3dda0002`, `3dda0003`, `3dda0004` or `3dda0005` is handed to the in-flight request's `handleResponse`, whatever its type (`FWA:750-765`). With no request in flight, the notification is dropped and only the queue is advanced (`FWA:754`, `FWA:788`). `3dda0006` and `0x2A37` go to separate handlers.
3. **Completion.** After each `handleResponse`, the adapter re-reads `fossilRequest.isFinished()`. If true, it clears the slot, stops the timeout and dequeues the next request (`FWA:765-788`). A `RuntimeException` thrown from `handleResponse` counts as finished (`FWA:767-778`). Requests that are finished at write time (`SetDeviceStateRequest`, `isFinished()==true`) dequeue the next request at once (`FWA:1005-1009`, `S/requests/fossil/SetDeviceStateRequest.java:32-35`).
4. **Nested follow-ups depend on a subtle ordering** (INFERRED from the code paths). Requests mark themselves finished **before** calling their result callbacks (`Lookup:98`, `EncGet:150`). A follow-up queued from inside the callback therefore executes immediately and takes the slot. The adapter's re-read in step 3 then sees the new, unfinished request and returns.

   The exception is `VerifyPrivateKeyRequest`, which calls `handleAuthenticationResult` **before** setting `isFinished` (`Verify:99-104`). The follow-up is inserted at the queue head instead, and runs right after the verify finishes.

   The net effect is a strict chain. A port should make the order explicit: lookup → verify → encrypted get → persist → delete.
5. **Writes outside the queue.** The verify step-3 write (`Verify:90-92`) and upload data writes (`EncPut:89-125`) go directly to the GATT queue while the request stays in flight. GATT operations must still be serialized, as Gadgetbridge's `BtLEQueue` does.
6. **The MTU request gates everything after it** (`FWA:949-960`). See the stall cases in §2.
7. **Persistence is synchronous on the notification path** before the delete is queued (§6, step 2). A JavaScript port that persists asynchronously must `await` durability before it writes `0B`.
8. **Timeouts and teardown.** There is a 5-minute timeout per request that is not refreshed by data packets (§4.7). A disconnect clears the queue and the slot (`FWA:258-266`). Any GATT write failure fails the current request, and a failure on `3dda0005` also clears the queue (`FWA:238-256`).
9. **Session randoms** are adapter state that every verify overwrites (`Verify:76-77`). The encrypted get reads them when its type-1 response arrives (`EncGet:128`). Nothing else may run a verify between those two points.

---

## 9. Gaps and uncertainties

1. **Characteristic properties and write types** are not in source (§1.3).
2. **Skagen Jorn Gen 6 identification.** There is no Skagen string, firmware prefix or model number in source (§1.2). Also, `isHybridHR` and `supportsSpo2` depend on the derived name, not the firmware string, so a Gen 6 or Jorn with an unexpected model number loses SpO2 and workout capability flags while still using the HR adapter.
3. **Header bytes 8..11** are a timestamp according to the parser, but the payload length according to the upload container. The HR-variant parser trusts them until the first `CE … E2 04`. A standalone `E2` record does **not** resync the timestamp (`AFP:208-213`). Cross-check against the `E2 04` block at offset 32, which the no-HR path trusts.
4. **IV summand and MTU.** Upstream's brute-force range `0x1e..0x2f` fits roughly MTU 512 only (§4.4). The marker byte is probably a sequence number. Both points are INFERRED.
5. **The trailing 4 bytes** of the activity file are INFERRED to be CRC32C. Upstream never verifies them.
6. **The parser is heuristic.** It uses look-ahead tests (`valid(pos+2)`, `valid(pos+4)`), silently skips unknown bytes, and has `D3`, `DD`, `C2` and `FE` paths with commented "?" or "WHY?". A 6-byte minute record followed by `C2` or `E0` would be misread as the 8-byte form (`AFP:173-202`). The semantics of `variability`, calories and `hr == 0` are UNKNOWN.
7. **Other file versions:** none are handled. Version 22 is the only one accepted.
8. **Multiple activity files and append behaviour.** Upstream fetches one file per sync and does not loop. Whether the lookup returns the oldest of several files, and whether recording continues into the same handle between the get and the delete, are UNKNOWN (§6). This is the main data-loss risk.
9. **On-watch confirmation** does not gate upstream's `connectionMode`. Whether firmware 2.22 or later refuses encrypted gets without it is UNKNOWN (§3.3).
10. **Whether a fresh verify is required** before each encrypted get: upstream always runs one for the activity file, but reuses the randoms in the configuration lookup-and-get path (§3.5).
11. **Signed ResultCode bytes:** codes 128 and above are misclassified as `UNKNOWN` or `UNKNOWN_1`, though they are still failures (§3.2).
12. **Encrypted put IV reuse.** Upload encrypts every packet with one `Cipher` init and calls `doFinal` per packet (`EncPut:115-120`). Under the JCE contract, `doFinal` resets to the initial IV, so every upload packet would reuse the same keystream. That contradicts the per-packet counter advance seen in downloads. This is UNKNOWN, and it matters only if we send the time or configuration. INFERRED.
13. **Upstream's "prod" dummy-firmware bypass** (`HRA:268-272`) and the all-zero default key (`HRA:1720`) are behaviours we should not copy.
14. **Workout summary rows** are not idempotent upstream (`summaryDao.insert`).

---

## 10. Our side (reference only, not a design)

**Catalog entries** (`packages/health-record/src/device-catalog/gadgetbridge-catalog.json`):

| id | line | pairMode | Notes |
|---|---|---|---|
| `fossil_hybrid_hr` | 2585 | `fossil` | firmware_info link `internals/specifics/fossil-hybrid` |
| `fossil_gen_6_hybrid` | 2568 | `fossil` | same link |
| `skagen_jorn_gen_6` | 9590 | `fossil` | same link |
| `fossil_q_hybrid` | 2602 | `free` | Non-HR QHybrid. Uses the non-encrypted path, so it is out of scope. |
| `citizen_cz_gen2` | 1892 | `fossil` | Vendor `fossil`, but no Citizen mapping exists in the reviewed upstream code. UNKNOWN, out of scope. |

**Naming conventions in `apps/native/lib/direct-devices`** (Huami legacy as the key-entry reference):

- `models/huami-legacy.ts` holds the model registry:
  - a header comment with the pinned commit and the upstream source list
  - `SCREAMING_SNAKE` UUID constants, such as `HUAMI_AUTH_UUID`
  - a readonly model type with `id` (upstream YAML id), `displayName`, `transportValidated: false`, `bleNamePatterns`, `records`, `serviceUuids` and `sourceFiles`
  - `matchHuamiLegacyDevice(name)`
- `protocol/huami-legacy.ts` holds the pure codecs: frame builders and parsers, `parseHuamiAuthKey`, and an injected `aesEcbEncrypt` crypto interface that is lazily loaded from `react-native-quick-crypto`.
- The family id is snake_case, `"huami_legacy"` (`setup/types.ts:58`). File names are kebab-case.
- `sync/controller.ts:1116-1126` validates the user key with `^((0x)?[0-9a-fA-F]{32})$` and accepts only a leading `0x`. Upstream Fossil instead strips spaces and every `"0x"` (§3.1).
- Fossil would need AES-ECB decryption (for the verify step) and AES-128-CTR. Both are available from `react-native-quick-crypto`, and single-block CBC with a zero IV equals ECB.
