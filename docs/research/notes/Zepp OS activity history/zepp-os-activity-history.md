# Zepp OS (Amazfit) health-history sync: all 36 models vs the Helio Strap baseline

Checked: 2026-11-12. For issue #419.

Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. I downloaded each file below as raw bytes from `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/<sha>/<path>` and read it directly. Nothing was executed or built. All upstream line numbers refer to that commit. Upstream is AGPL-3.0-or-later, and so is OpenValens.

Notation:

- **INFERRED** means I deduced it and did not read it in source.
- **UNKNOWN** means the source does not settle it.
- Everything else is read from the cited line.

## 0. Path aliases used in citations

| Alias     | Path at the pin                                                                      |
| --------- | ------------------------------------------------------------------------------------ |
| `G/`      | `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`                            |
| `Coord`   | `G/devices/huami/zeppos/ZeppOsCoordinator.java`                                      |
| `W/`      | `G/devices/huami/zeppos/watches/` (per-model coordinators, `<Name>Coordinator`)      |
| `Strap`   | `G/devices/huami/zeppos/straps/AmazfitHelioStrapCoordinator.java`                    |
| `Ring`    | `G/devices/huami/zeppos/rings/AmazfitHelioRingCoordinator.java`                      |
| `HC`      | `G/devices/huami/HuamiCoordinator.java`                                              |
| `BLEC`    | `G/devices/AbstractBLEDeviceCoordinator.java`                                        |
| `HS`      | `G/devices/huami/HuamiService.java` (command constants)                              |
| `Sup`     | `G/service/devices/huami/zeppos/ZeppOsSupport.java`                                  |
| `Btle`    | `G/service/devices/huami/zeppos/ZeppOsBtleSupport.java`                              |
| `Btbr`    | `G/service/devices/huami/zeppos/ZeppOsBtbrSupport.java`                              |
| `Auth`    | `G/service/devices/huami/zeppos/services/ZeppOsAuthenticationService.java`           |
| `Svc`     | `G/service/devices/huami/zeppos/services/ZeppOsServicesService.java`                 |
| `AFS`     | `G/service/devices/huami/zeppos/services/ZeppOsActivityFetchService.java`            |
| `AZS`     | `G/service/devices/huami/zeppos/AbstractZeppOsService.java`                          |
| `Dec`     | `G/service/devices/huami/Huami2021ChunkedDecoder.java`                               |
| `Enc`     | `G/service/devices/huami/Huami2021ChunkedEncoder.java`                               |
| `HSup`    | `G/service/devices/huami/HuamiSupport.java` (legacy, non-Zepp-OS)                    |
| `Init21`  | `G/service/devices/huami/operations/init/InitOperation2021.java`                     |
| `Fetcher` | `G/service/devices/huami/HuamiFetcher.java`                                          |
| `F/`      | `G/service/devices/huami/operations/fetch/`                                          |
| `AFO`     | `F/AbstractFetchOperation.java`                                                      |
| `ARFO`    | `F/AbstractRepeatingFetchOperation.java`                                             |
| `FAO`     | `F/FetchActivityOperation.java`                                                      |
| `FSS`     | `F/FetchSleepSessionOperation.java`                                                  |
| `FDT`     | `F/HuamiFetchDataType.java`                                                          |
| `HESP`    | `G/devices/huami/HuamiExtendedSampleProvider.java`                                   |
| `HSSSP`   | `G/devices/huami/HuamiSleepSessionSampleProvider.java`                               |
| `HSSP`    | `G/devices/huami/HuamiSleepSessionProvider.kt`                                       |
| `FbSSP`   | `G/devices/FallbackSleepSessionProvider.kt`                                          |
| `DSSP`    | `G/devices/DefaultSleepSessionProvider.java`                                         |
| `Seg`     | `G/devices/SleepSessionSegmenter.java`                                               |
| `BTC`     | `G/service/btle/BLETypeConversions.java`                                             |
| `HRU`     | `G/activities/HeartRateUtils.java`                                                   |
| `Dao`     | `GBDaoGenerator/src/nodomain/freeyourgadget/gadgetbridge/daogen/GBDaoGenerator.java` |

Our side (paths relative to `apps/native/lib/direct-devices/` unless stated):

| Alias         | Path                                                     |
| ------------- | -------------------------------------------------------- |
| `ours/hist`   | `protocol/history.ts` (`runHelioStepsHistory`)           |
| `ours/codec`  | `protocol/codec.ts`                                      |
| `ours/chan`   | `protocol/channel.ts` (auth + encrypted chunked channel) |
| `ours/chunk`  | `protocol/chunked.ts`                                    |
| `ours/link`   | `transport/helio-link.ts`                                |
| `ours/reg`    | `models/zepp-os.ts` (36-model registry)                  |
| `ours/sync`   | `sync/controller.ts`                                     |
| `ours/setup`  | `setup/controller.ts`                                    |
| `ours/ingest` | `packages/ingestion/src/direct-device-identity.ts`       |

## 1. Summary

- **Auth: one variant for every `os_zepp` model.** All 36 models run `ZeppOsSupport`, which always authenticates through `ZeppOsAuthenticationService` (B-163 ECDH on chunked endpoint `0x0082`). This is exactly what `ours/chan` implements. The "Huami auth vs Zepp auth" split in the issue is a split between families. Legacy Huami (`HuamiSupport`) uses the old AES challenge unless the user sets `force_new_protocol`. No Zepp OS coordinator picks the legacy auth.
- **Transport: two variants, chosen per coordinator.** 7 of our registry models (9 coordinators) default to Bluetooth Classic SPP (`ZeppOsBtbrSupport`). The other 29 default to BLE GATT (`ZeppOsBtleSupport`). Both carry the same chunked/encrypted protocol. A user preference can force BLE.
- **Activity control path: two variants, chosen at runtime by the service list.** If endpoint `0x004b` is in the service list, control goes over the encrypted chunked channel. Otherwise it goes as plain writes and notifications on GATT characteristic `00000004-…`. Our code needs `0x004b` and fails the whole channel without it.
- **Activity sample format: a single format.** Zepp OS always uses 8-byte per-minute samples (`Sup:1025-1027`): kind, intensity, steps, heart rate, unknown, sleep, deepSleep, remSleep. We currently keep only byte 2 (steps).
- **Sleep has two sources.** (a) Separate `0x48` sleep-session records of 594 bytes, carrying stages. Upstream queues these only on the 26 registry models whose coordinator reports `supportsSleepScore`. (b) A fallback that segments activity minutes of kind `120`, used for the 10 Zepp OS 1.x/2.x models and for gaps.
- **Heart rate:** per-minute values come from activity-sample byte 3. Resting, max and manual HR are separate 6-byte-record fetches.
- **Destructive ack:** upstream ends every successful round with `03 01` by default ("mark as saved on phone, drop from band"). That covers activity, sleep, HR and all other types. It sends `03 09` (keep) only on failure, on a bad CRC, when there is no data, or when the user sets `keep_activity_data_on_device`. Our code always sends `03 09`. That must remain an invariant.

## 2. Q1: auth and channel variants

### 2.1 Auth: one Zepp OS path

`ZeppOsSupport.initializeDevice` always calls `authenticationService.startAuthentication(builder)` (`Sup:320-328`). There is no branch on coordinator, firmware or service list.

The wire sequence (`Auth:133-148`, `Auth:65-131`) is as follows. Every step goes over chunked endpoint `0x0082`, which is unencrypted (`Auth:55-57`, `super(support, false)`).

| Step | Direction | Payload                                                                                                               |
| ---- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | → watch   | `04 02 00 02` + 48-byte B-163 public key (`Auth:140-147`)                                                             |
| 2    | ← watch   | `10 04 01` + 16-byte random + 48-byte watch pubkey, 67 bytes total (`Auth:72-84`)                                     |
| 3    | (local)   | `seq = u32le(shared[0..4])`; `sessionKey[i] = shared[i+8] ^ authKey[i]` (`Auth:85-94`)                                |
| 4    | → watch   | `05` + AES-ECB(random, authKey) + AES-ECB(random, sessionKey), 33 bytes (`Auth:96-105`)                               |
| 5    | ← watch   | `10 05 01` = success. `10 05 25` = wrong auth key (`Auth:110-127`)                                                    |
| 6    | → watch   | services list request on endpoint `0x0000`; reply `04` + u16 count + count×(u16 endpoint, u8 encrypted) (`Svc:58-96`) |

The auth key is 32 hex characters, optionally prefixed with `0x` (`Auth:159-177`, `Coord:742-746`). Without a key, upstream silently uses the default `"0123456789@ABCDE"` bytes (`Auth:160`). Every Zepp OS model needs a key extracted from the Zepp account (`Coord:610-613`, `BONDING_STYLE_REQUIRE_KEY`).

`ours/chan` matches steps 1 to 6 byte for byte: `04 02 00 02` + pub, a 67-byte challenge check, the sequence and session-key derivation, the double-AES `05` reply, `0x25` mapped to `AUTH_FAILED`, then service list request `03` on endpoint 0.

**The "Huami auth" variant is not a Zepp OS variant.** `InitOperation2021` (`Init21:73-187`) is the same B-163 flow, but it is reached only from the legacy `HuamiSupport` and only when the device-specific pref `force_new_protocol` is true (`HSup:427-436`, `HSup:3982-3984`). Without that pref, legacy devices use `InitOperation` (the old AES auth on the Huami auth characteristic). Our `huami_legacy` family covers that path. For the issue's acceptance criterion "sub-protocol variant (Huami auth vs Zepp auth)", the answer is that all 36 `os_zepp` models are Zepp auth. Record that as a constant, not a per-model flag.

### 2.2 Transport: BLE GATT vs Bluetooth Classic, per coordinator

`ZeppOsCoordinator.createDeviceSupport` (`Coord:120-133`):

```java
DeviceCoordinator.ConnectionType connType = GBApplication.getDevicePrefs(device).getForcedConnectionTypeFromPrefs();
if (connType == DeviceCoordinator.ConnectionType.BOTH) { connType = getConnectionType(); }
return switch (connType) {
    case BOTH, BT_CLASSIC -> new ZeppOsBtbrSupport();
    default -> new ZeppOsBtleSupport();
};
```

The default `getConnectionType()` is `BLE`, inherited through `HuamiCoordinator extends AbstractBLEDeviceCoordinator` (`HC:79`, `BLEC:21-23`). These coordinators override it to `BOTH`, which upstream then routes to Bluetooth Classic:

| Coordinator (upstream)            | Cite                                            | Note          | Our registry id            |
| --------------------------------- | ----------------------------------------------- | ------------- | -------------------------- |
| AmazfitActive2Round               | `W/AmazfitActive2RoundCoordinator.java:39-40`   |               | `amazfit_active_2`         |
| AmazfitActive2Nfc (extends Round) | `W/AmazfitActive2NfcCoordinator.java:28`        | inherits BOTH | `amazfit_active_2`         |
| AmazfitActive2Square              | `W/AmazfitActive2SquareCoordinator.java:32-33`  |               | `amazfit_active_2`         |
| AmazfitActive3Premium             | `W/AmazfitActive3PremiumCoordinator.java:32-33` |               | `amazfit_active_3_premium` |
| AmazfitBalance3                   | `W/AmazfitBalance3Coordinator.java:32-34`       | "unconfirmed" | `amazfit_balance_3`        |
| AmazfitBalanceUltra               | `W/AmazfitBalanceUltraCoordinator.java:39-41`   | "unconfirmed" | `amazfit_balance_ultra`    |
| AmazfitBipMax                     | `W/AmazfitBipMaxCoordinator.java:33-35`         | "unconfirmed" | `amazfit_bip_max`          |
| AmazfitCheetah2Pro                | `W/AmazfitCheetah2ProCoordinator.java:37-38`    |               | `amazfit_cheetah_2_pro`    |
| AmazfitCheetah2Ultra              | `W/AmazfitCheetah2UltraCoordinator.java:38-40`  | "unconfirmed" | `amazfit_cheetah_2_ultra`  |

`ZeppOsBtbrSupport` wraps the same `ZeppOsSupport` (`Btbr:95`) inside an SPP framing: `55 cmd seq len16 payload crc16 aa`, with channel and session commands (`Btbr:73-85`, `Btbr:196-233`). GATT characteristic UUIDs are mapped to SPP channels (`Btbr:97-98`, `Btbr:218-233`). The chunked encoder and decoder and everything above them are unchanged.

The forced-connection-type setting is offered for every Zepp OS model (`Coord:370-380`). That implies these watches also expose BLE GATT FEE0. **INFERRED:** that is how a phone without SPP (iOS) has to reach them. Hardware has not confirmed that BLE history works on these 7 models.

### 2.3 Chunked channel: same framing; upstream is more lenient than us

- Chunked framing on `00000016`/`00000017`: `03 flags 00 handle count [len32 type16 on first chunk] data`, with flags `01` first, `02` last, `04` needs-ack, `08` encrypted. Zepp OS always uses the extended-flags header, so `force2021Protocol = true` (`Sup:162-163`, `Sup:1275-1277`, `Enc:64-157`, `Dec:67-104`).
- Outbound encryption (`Enc:76-105`): `payload ‖ u32le seq ‖ crc32(payload‖seq)`, zero-padded to 16, AES-128-ECB with `sessionKey ^ handle`. `ours/chunk` matches this.
- Inbound decryption (`Dec:105-127`): AES-ECB decrypt, then truncate to the declared length. **Upstream does not check an inbound CRC or the padding.** `ours/chan` requires a valid CRC32 at `originalLength+4` and zero padding, and throws `CHANNEL_CRC_ERROR`/`CHANNEL_PADDING_ERROR` otherwise. INFERRED: if watches do not append seq+CRC to inbound messages the way they expect them outbound, our check would reject every encrypted reply. It is unvalidated on hardware.
- Channel ack after the last fragment: `04 00 handle 01 count` written to `00000017` (`Sup:1199-1206`). `ours/chan` matches this.
- Service list (`Svc:62-96`): upstream accepts an encryption byte other than 0/1 by treating it as unknown and keeping the default (`AZS:128-139`). It also ignores trailing bytes. `ours/codec` `decodeServiceList` throws on both, and throws `HISTORY_UNSUPPORTED` when `0x004b` is absent (see 2.4).
- After auth, upstream asks for MTU 247 if allowed (`Btle:190-195`). We use whatever MTU the OS negotiated.

### 2.4 Activity control: endpoint `0x004b` or characteristic `0004`, chosen at runtime

```java
// Sup:1008-1017
public void writeActivityControl(final String name, final byte[] value) {
    if (mSupportedServices.contains(activityFetchService.getEndpoint())) {
        activityFetchService.writeActivityControl(name, value);           // chunked 0x004b, encrypted by default (AFS:30-36)
    } else {
        builder.write(HuamiService.UUID_CHARACTERISTIC_5_ACTIVITY_CONTROL, value);  // 00000004-0000-3512-2118-0009af100700 (HS:44)
    }
}
```

Replies come through either `AFS.handlePayload → fetcher.onActivityControl` (`AFS:44-48`) or a notification on `0004` (`Sup:1121-1123`). Data always arrives as notifications on `00000005-…` (`HS:45`, `Sup:1118-1120`). The fetcher enables notifications on both `0004` and `0005` (`Sup:1000-1006`, `Fetcher:180-182`, `AFO:219`).

UNKNOWN: which models or firmware lack `0x004b`. No coordinator flag decides this. INFERRED: older Zepp OS 1.x firmware (GTR 3, GTS 3, Mi Band 7 era) is the likely case. `ours/codec:decodeServiceList` throws `HISTORY_UNSUPPORTED` when `0x004b` is missing, and `ours/link` cannot subscribe to `0004`. Those devices would therefore fail outright.

## 3. Q2: activity history fetch sequence

`HuamiFetcher.onFetchRecordedData` queues one operation per requested type (`Fetcher:54-112`). Operations run strictly one after another (`Fetcher:170-202`). Each operation is an `AbstractRepeatingFetchOperation`. Its `since` is a phone-side per-type preference (`ARFO:46-51`, `AFO:287-303`) that defaults to now − 100 days.

### 3.1 Byte sequence for one round (any data type; activity uses type `0x01`)

Command and response constants: `RESPONSE 0x10`, `SUCCESS 0x01`, `START_DATE 0x01` (`HS:224-227`); `FETCH_DATA 0x02` (`HS:121`); `ACK 0x03` (`HS:125`).

| #   | Dir      | Bytes                                                                                                 | Source                       |
| --- | -------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | → ctrl   | `01 <type> yy yy MM dd hh mm ss tz`, 10 bytes                                                         | `AFO:145-151`, `Sup:716-726` |
| 2   | ← ctrl   | `10 01 01 <len u32le> yy yy MM dd hh mm ss tz` (15 bytes; 16 on MB7 with trailing `00`)               | `AFO:183-202`                |
| 2a  |          | if `len == 0`: send ack `03 09` (keep) and finish when the ack reply arrives                          | `AFO:204-209`                |
| 3   | → ctrl   | `02`                                                                                                  | `AFO:218-220`                |
| 4   | ← `0005` | notifications `<counter u8> <data…>`, counter 0,1,2… wrapping at 8 bits; the counter byte is stripped | `AFO:123-143`                |
| 5   | ← ctrl   | `10 02 01` (3 bytes) or `10 02 01 <crc32 u32le>` (7 bytes) over the counter-stripped buffer           | `AFO:223-246`, `AFO:117-119` |
| 6   | (local)  | parse and persist the buffer (`processBufferedData`)                                                  | `AFO:248`, `ARFO:63-93`      |
| 7   | → ctrl   | ack `03 01` (drop/mark saved) or `03 09` (keep)                                                       | `AFO:250-277`                |
| 8   | ← ctrl   | `10 03 …` → operation finished; next round or next type                                               | `AFO:173-176`                |

Request time encoding (`Sup:716-726`, `BTC:121-134`, `BTC:380-387`): local calendar fields of the phone's default time zone. Seconds are sent as `0` because `huami_truncate_fetch_operation_timestamps` defaults to true (`Fetcher:150-156`). `tz` is the signed offset in quarter hours, DST included, for that instant. Response time decoding (`BTC:161-184`): the same fields, with byte 7 used as the quarter-hour offset on a raw-offset UTC zone. Seconds are honoured.

### 3.2 The ack: is it destructive, and when is it sent?

```java
// AFO:248-255
final boolean success = operationValid && processBufferedData();
final boolean keepActivityDataOnDevice = !success || HuamiCoordinator.getKeepActivityDataOnDevice(getDevice().getAddress());
if (fetcher.isZeppOs() || !keepActivityDataOnDevice) { sendAck(keepActivityDataOnDevice); return; }

// AFO:266-270
// 0x01 to ACK, mark as saved on phone (drop from band)
// 0x09 to ACK, but keep it marked as not saved
// If 0x01 is sent, detailed information seems to be discarded, and is not sent again anymore
final byte ackByte = (byte) (keepDataOnDevice ? 0x09 : 0x01);
```

- `keep_activity_data_on_device` defaults to `false` (`HC:407-410`). **Upstream's default on Zepp OS is therefore the destructive `03 01`.** It is sent for every successful round of every data type, after the data has been persisted to the phone DB (step 6 runs before step 7).
- `03 09` is sent when processing failed (`!success`), when the CRC was invalid (`AFO:236-243`), when the transfer was empty (`AFO:204-209`), or when the user opts to keep data.
- The device pointer is not in the protocol. The phone resends `since` on every round. UNKNOWN: what the watch does with "saved on phone" beyond the upstream comment. INFERRED: the flag is what the Zepp app uses to decide what is still unsynced. Always sending `03 09` therefore also keeps the official app able to sync the same data.

### 3.3 Repeating rounds

After a successful parse, `since := lastSampleTime + 1 min` is saved (`ARFO:83-84`). The same operation is pushed back to the front of the queue (`ARFO:86-90`) unless one of these holds (`ARFO:95-114`):

- the round covered less than 1 s;
- `fetchCount > 10` (at most about 11 rounds per sync; INFERRED from the counter increment at `AFO:85-91`);
- the new `since` is at or after phone now.

UNKNOWN: how many minutes the watch returns per round.

### 3.4 Differences from `runHelioStepsHistory`

| Aspect                   | Upstream                                                                                                                                              | `ours/hist`                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Request                  | `01 01` + time                                                                                                                                        | same (`ours/codec historyStart`)                                         |
| Control path             | `0x004b`, or `0004` when `0x004b` is absent                                                                                                           | `0x004b` only; throws `HISTORY_UNSUPPORTED`                              |
| Ack after success        | `03 01` by default (destructive)                                                                                                                      | always `03 09`                                                           |
| Ack when length 0        | `03 09`                                                                                                                                               | `03 09`                                                                  |
| CRC on 7-byte completion | **ignored for activity**: `FAO:135-140` overrides `validChecksum` to always return true (`// TODO actually check it`). Enforced for every other type. | enforced; a mismatch throws `HISTORY_INTEGRITY_ERROR` before the ack     |
| Sample parse             | all 8 bytes stored                                                                                                                                    | byte 2 (steps) only                                                      |
| Old minutes              | all stored (DB upsert)                                                                                                                                | minutes before the cursor and the current in-progress minute are dropped |
| Metadata seconds         | honoured                                                                                                                                              | ignored (`deviceDateToUtcMinute`)                                        |
| Metadata length          | lax check (`AFO:190-195` lets most lengths through)                                                                                                   | exactly 15, or 16 ending `00`                                            |
| Ack reply                | any `10 03 …` finishes                                                                                                                                | must be exactly `10 03 01`                                               |
| Break on `maxMinutes`    | n/a                                                                                                                                                   | breaks **without** sending any ack for the transfer just received        |
| Data types               | 13+ types in one session, each with its own `since`                                                                                                   | activity only, one cursor                                                |
| Rounds                   | ≤ about 11                                                                                                                                            | `maxPages` 32                                                            |
| Default backfill         | 100 days                                                                                                                                              | 24 h (`ours/sync` default cursor)                                        |

## 4. Q3: activity sample format

### 4.1 Size

`ZeppOsSupport.getActivitySampleSize()` returns `8` unconditionally (`Sup:1024-1027`). `FetchActivityOperation` handles only 4 (legacy) and 8 and fails on any other value (`FAO:79-91`). On Zepp OS the format does not vary by model or firmware version. A buffer whose length is not a multiple of 8 is rejected (`FAO:72-75`). Our `length % 8` check therefore matches upstream for all 36 models.

### 4.2 Layout: one record per minute

| Offset | Field          | Type | Upstream use                                  |
| ------ | -------------- | ---- | --------------------------------------------- |
| 0      | `rawKind`      | u8   | see the kinds table below                     |
| 1      | `rawIntensity` | u8   | normalised `/256` (`HESP:48-51`)              |
| 2      | `steps`        | u8   | steps in the minute                           |
| 3      | `heartRate`    | u8   | bpm; invalid values filtered at display time  |
| 4      | `unknown1`     | u8   | stored, unused                                |
| 5      | `sleep`        | u8   | sleep "intensity" for the fallback classifier |
| 6      | `deepSleep`    | u8   | `& 127`; > 42 → deep (fallback only)          |
| 7      | `remSleep`     | u8   | `& 127`; > 55 → REM (fallback only)           |

Source: `FAO:152-164`, entity `Dao:628-640`.

```java
// FAO:154-161
huamiExtendedActivitySample.setRawKind(value[i] & 0xff);
huamiExtendedActivitySample.setRawIntensity(value[i + 1] & 0xff);
huamiExtendedActivitySample.setSteps(value[i + 2] & 0xff);
huamiExtendedActivitySample.setHeartRate(value[i + 3] & 0xff);
huamiExtendedActivitySample.setUnknown1(value[i + 4] & 0xff);
huamiExtendedActivitySample.setSleep(value[i + 5] & 0xff);
huamiExtendedActivitySample.setDeepSleep(value[i + 6] & 0xff);
huamiExtendedActivitySample.setRemSleep(value[i + 7] & 0xff);
```

Zepp OS kinds (`HESP:35-42`, `HESP:148-167`). These differ from legacy `HuamiConst`, where kinds 9/11 mean sleep, so the `huami_legacy` kind mapping must not be reused:

| Raw kind | Meaning                                                    |
| -------- | ---------------------------------------------------------- |
| 64       | outdoor running                                            |
| 115      | not worn                                                   |
| 118      | charging (shown as not worn)                               |
| 120      | sleep (any stage)                                          |
| 121–123  | phone-side synthetic: deep, REM, awake (never on the wire) |
| other    | `UNKNOWN` (normal activity)                                |

### 4.3 Timestamps, time zone and alignment

- Sample `i` gets timestamp `metadataStart + i minutes` (`FAO:112-121`). The start is the absolute instant decoded from the metadata, including its quarter-hour offset (`BTC:161-184`). Because offsets are multiples of 15 minutes, local minute boundaries coincide with UTC minute boundaries. INFERRED: seconds in the metadata are 0, since the request truncates to the minute (`Fetcher:150-156`). Our parser drops them, which is equivalent only if that holds.
- After the round, `since = last sample + 1 min` (`FAO:124`, `ARFO:83-84`). Our `nextCursor = last emitted minute end` with the offset from the metadata is the same instant.
- Upstream does not drop the current minute. Our "never publish the in-progress minute" rule is stricter, and safe.

## 5. Q4: sleep

There are two sources, combined by `FallbackSleepSessionProvider` (`HC:169-177`, `FbSSP:5-23`). Primary is `HuamiSleepSessionProvider`, fed by `0x48` records. Fallback is `DefaultSleepSessionProvider`, which segments activity minutes. A fallback session is used only where it does not overlap a primary one (`FbSSP:12-14`).

### 5.1 Primary: sleep-session fetch, type `0x48`

- Queued only when `coordinator.supportsSleepScore(device)` is true (`Fetcher:101-103`; `Coord:238-241` defaults to true). 10 coordinators override it to false; see 8.2.
- Same round protocol as section 3, with type `0x48` (`FDT:35`) and its own `since` key `lastSleepSessionTimeMillis` (`FSS:102-105`). The CRC is enforced, because the base `validChecksum` applies (`AFO:117-119`).
- Buffer length must be a multiple of **594** (`FSS:60-63`). Each record's u32le at offset 0 becomes the next `since` base (`FSS:73-74`, then +1 min at `ARFO:83-84`).

594-byte record layout (`HSSSP:93-127`):

| Offset         | Field               | Type                            | Notes                                                                                      |
| -------------- | ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `0x00`         | `timestampSession`  | u32le s                         | record/report time (`HSSP:17`: "may be on the following day")                              |
| `0x04`         | `timestampMidnight` | u32le s                         | "midnight boundary of the day, in the user's timezone"                                     |
| `0x08`, `0x09` | constant `1`, `1`   | u8, u8                          |                                                                                            |
| `0x0a`         | `sleepStart`        | u16le                           | unused by the provider (UNKNOWN units)                                                     |
| `0x0c`         | `sleepEnd`          | u16le                           | unused (UNKNOWN units)                                                                     |
| `0x15`         | `avgHr`             | u8                              |                                                                                            |
| `0x16`         | `score`             | u8                              | sleep score (also `AbstractHuamiSleepSessionSample.getSleepScore`)                         |
| `0x54`         | `numStages`         | u8                              |                                                                                            |
| `0x56 + 5·i`   | stage `i`           | u16le start, u16le end, u8 type | minutes; type `4` light, `5` deep, `7` awake, `8` REM, other → any sleep (`HSSSP:155-170`) |
| `0x024a`       | total REM min       | u16le                           |                                                                                            |
| `0x024c`       | total light min     | u16le                           |                                                                                            |
| `0x024e`       | total deep min      | u16le                           |                                                                                            |
| `0x0250`       | total wake min      | u16le                           |                                                                                            |

INFERRED: at most `(0x024a − 0x56) / 5 = 100` stages fit.

How sessions are built (`HSSP:13-49`):

```kotlin
val start = (rawSession.timestampMidnight - 24 * 3600 + stage.start * 60) * 1000L
// Huami includes both endpoint minutes in each native stage.
val end = (rawSession.timestampMidnight - 24 * 3600 + (stage.end + 1) * 60) * 1000L
...
// Revised sleep bounds can shift, so identify revisions by overlap before filtering
sleepSessions.removeAll { it.startTime < candidate.endTime && candidate.startTime < it.endTime }
sleepSessions.add(candidate)
```

- Records with no stages are skipped (`HSSP:25-27`).
- The watch can re-report a revised night. A later record replaces any earlier overlapping one (`HSSP:38-43`). Our `externalRecordId` keyed on `startTime` (`ours/sync huamiHistoryRecords`) would create a duplicate when the start moves. The upsert or delete must be keyed by overlap.
- The stage boundaries also overwrite per-minute kinds for display (`HESP:95-123`). A kind-120 minute outside any session is unset.

### 5.2 Fallback: activity kind 120

Used when no `0x48` session covers a time span. That is every night on the 10 models without sleep score.

- Stage per minute (`HESP:124-145`): a minute is sleep only if `rawKind == 120`. Within it, `remSleep & 127 > 55` → REM, otherwise `deepSleep & 127 > 42` → deep, otherwise light. Upstream calls these thresholds "arbitrary" (`HESP:129`).
- Segmentation (`Seg:19-24`, `Seg:36-135`; `DSSP:26-67`): a session opens at the first sleep minute. It closes when a non-sleep minute has `steps > 0`, or after more than 60 min of non-sleep. A session of 5 min or less (including a 60 s trailing pad) is dropped. Non-sleep minutes inside a session count as awake, and the last stage is extended by 60 s.

## 6. Q5: heart rate

| Source                 | Type   | Record                                                         | Cadence         | Cite                                          |
| ---------------------- | ------ | -------------------------------------------------------------- | --------------- | --------------------------------------------- |
| Activity sample byte 3 | `0x01` | u8 bpm                                                         | 1/min           | `FAO:157`                                     |
| Manual HR              | `0x02` | 6 B: u32le ts s, i8 tz quarter-hours, u8 bpm                   | per measurement | `F/FetchHeartRateManualOperation.java:63-90`  |
| Resting HR             | `0x3a` | 6 B, same layout ("Official app only shows this at day-level") | about daily     | `F/FetchHeartRateRestingOperation.java:63-91` |
| Max HR                 | `0x3d` | 6 B, same layout                                               | about daily     | `F/FetchHeartRateMaxOperation.java:63-90`     |

- The three separate HR fetches are queued when `supportsHeartRateStats` is true (`Fetcher:87-91`), which holds for every Zepp OS model (`Coord:218-221`).
- Validity: upstream filters at display time with `value > 0 && min ≤ value ≤ max`, defaulting to 10..250 (`HRU:24-25`, `HRU:66-68`). Its sleep estimator uses 1..254 (`G/devices/huami/HuamiEstimatedSleepSessionProvider.kt:53`). Our `huami_legacy` uses 1..254 (`protocol/huami-legacy.ts:553`). INFERRED: 255 (and 0) mean "not measured", as on legacy Huami.
- **Worth publishing as `heart_rate`:** the per-minute activity-sample byte 3 (from the same transfer as steps, so no extra fetch) and, optionally, manual readings. Resting and max HR are daily aggregates and not per-minute samples, so do not publish them as `heart_rate`. Also drop minutes whose kind is 115 or 118 (not worn, charging). That last filter is INFERRED and defensive; upstream does not filter on it.

## 7. Q6: other data types (listed, not mapped)

| Type code     | Operation                                                                | Record format (short)                                                     | Gate                                                                     |
| ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `0x05`/`0x06` | `FetchSportsSummaryOperation` → `FetchSportsDetailsOperation` (workouts) | summary protobuf/binary + per-workout details                             | `supportsRecordedActivities` (`Coord:198-201`)                           |
| `0x07`        | `FetchDebugLogsOperation`                                                | logs                                                                      | `supportsDebugLogs`                                                      |
| `0x0d`        | `FetchPaiOperation`                                                      | 102 B (`F/FetchPaiOperation.java:67`)                                     | `supportsPai`                                                            |
| `0x12`        | `FetchStressManualOperation`                                             | 5 B                                                                       | `supportsStressMeasurement`                                              |
| `0x13`        | `FetchStressAutoOperation`                                               | 1 B/min, `0xff` = skip (`F/FetchStressAutoOperation.java:62-91`)          | same                                                                     |
| `0x25`        | `FetchSpo2NormalOperation`                                               | `02` version byte + n×65 B (u32 ts, spo2 with bit 7 = auto, 60 B unknown) | `supportsSpo2`                                                           |
| `0x26`        | `FetchSpo2SleepOperation`                                                | 1 + n×30 B; **never queued** at this pin                                  | —                                                                        |
| `0x2c`        | `FetchStatisticsOperation`                                               | ignored                                                                   | only on explicit request                                                 |
| `0x2e`        | `FetchTemperatureOperation`                                              | 8 B/min, i16 at +2 = °C×100 (skin)                                        | `!hasDisplay` or "thermometer" display item (`Coord:619-622`)            |
| `0x38`        | `FetchSleepRespiratoryRateOperation`                                     | 8 B: u32 ts, i8 tz, u8 rate, 2 B unknown                                  | `supportsSleepRespiratoryRate`                                           |
| `0x49`        | `FetchHrvOperation`                                                      | 6 B: u32 ts, u8 unknown, u8 hrv                                           | `!hasDisplay` or hrv/readiness/bio_charge display item (`Coord:248-251`) |

Codes are from `FDT:19-37`. The queueing order is in `Fetcher:58-107`. Each type gets the destructive-by-default ack from 3.2.

## 8. Q7: per-model differences that matter for history

### 8.1 What is the same for all 36

- Auth (2.1), chunked framing (2.3), 8-byte sample (4.1), sample provider `HuamiExtendedSampleProvider` (`Coord:303-306`), and HR stats, stress, SpO2, PAI and respiratory-rate gates (`Coord:173-241`).

### 8.2 Buckets that do differ

| Bucket                                                          | Flag / mechanism                               | Registry ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T-classic** (BT Classic default)                              | `getConnectionType() = BOTH`, see 2.2          | `amazfit_active_2`, `amazfit_active_3_premium`, `amazfit_balance_3`, `amazfit_balance_ultra`, `amazfit_bip_max`, `amazfit_cheetah_2_pro`, `amazfit_cheetah_2_ultra` (7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T-ble (BLE default)                                             | inherited `BLE`                                | the other 29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **S-noscore** (no `0x48` sleep session; kind-120 fallback only) | `supportsSleepScore() = false`                 | `amazfit_band_7` (`W/AmazfitBand7Coordinator.java:57-59`, "Zepp OS 1.0"), `xiaomi_mi_band_7` (`W/MiBand7Coordinator.java:77-79`, 1.0), `amazfit_gtr_3` (`W/AmazfitGTR3Coordinator.java:61-63`, 1.0), `amazfit_gtr_3_pro` (`W/AmazfitGTR3ProCoordinator.java:63-65`, 1.0), `amazfit_gts_3` (`W/AmazfitGTS3Coordinator.java:56-58`, 1.0), `amazfit_gts_4_mini` (`W/AmazfitGTS4MiniCoordinator.java:56-58`, 1.0), `amazfit_gtr_mini` (`W/AmazfitGTRMiniCoordinator.java:82-84`, 2.0), `amazfit_bip_5` (`W/AmazfitBip5Coordinator.java:66-68`, 2.1), `amazfit_trex_2` (`W/AmazfitTRex2Coordinator.java:71-73`, 2.1), `amazfit_bip_5_unity` (`W/AmazfitBip5UnityCoordinator.java:62-64`, 3.0) (10) |
| S-score (has `0x48`)                                            | default `true`                                 | the other 26, including `amazfit_helio_strap` and `amazfit_helio_ring`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| No display                                                      | `hasDisplay() = false`                         | `amazfit_helio_strap` (`Strap:53-54`), `amazfit_helio_ring` (`Ring:51-52`): HRV and temperature always on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Control path `0004`                                             | runtime: `0x004b` absent from the service list | UNKNOWN per model; INFERRED to be the Zepp OS 1.x group (Band 7, MB7, GTR/GTS 3, GTS 4 Mini)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The remaining coordinators set no `supportsSleepScore`, `getConnectionType` or `hasDisplay` override (for example GTR 4, GTS 4, Balance, Active, Falcon, T-Rex Ultra). They carry no history-relevant flags beyond the defaults.

## 9. Q8: gap list, in priority order

1. **Keep the ack non-destructive for every type (invariant, P0).** Never send `03 01`. Add a test asserting that no `03 01` is written for any fetch type as new types are added. Also send `03 09` before abandoning a transfer. Today the `records.length + minutes > maxMinutes` branch breaks without acking. INFERRED to be harmless, because the next session re-requests the data, but it differs from upstream, which always acks.
2. **Unblock models without `0x004b` (P0).** Stop throwing `HISTORY_UNSUPPORTED` inside `decodeServiceList` (`ours/codec`). When `0x004b` is absent, write control bytes in plain text to `00000004-0000-3512-2118-0009af100700` and read replies from notifications on it. `ours/link` must add `activity_control` subscribe and write. Make the service-list parser lenient as upstream is: an unknown encryption byte keeps the default, and trailing bytes are ignored.
3. **Activity CRC policy (P0 risk).** Upstream deliberately skips the activity CRC (`FAO:135-140`). Our code throws before the ack, so a systematic mismatch would stall sync forever on the same page. Options: verify on hardware, or treat an activity CRC mismatch as a warning. If we keep rejecting, send `03 09` first, as upstream does on a bad CRC (`AFO:236-243`). Apply the same review to our inbound encrypted-frame CRC and padding checks (2.3).
4. **Parse the full 8-byte sample and publish `heart_rate` (P1).** Extend the page from `{count}` per minute to `{steps, heartRate, kind, intensity, sleep, deep, rem}`. Emit `heart_rate` samples for bpm in 1..254 (or 10..250), skipping kinds 115/118. Allow `zepp_os` for `heart_rate` in `directDeviceFamilySupportsRecordType` (`ours/ingest`: the `heart_rate` list currently excludes `zepp_os`). This needs no extra BLE traffic.
5. **Sleep sessions, S-score bucket (P1).** After activity, run a second fetch type `0x48` in the same authenticated channel, with its own cursor. Parse 594-byte records (section 5.1). Build stages with `midnight − 24h + min·60` and inclusive end minutes. Handle revisions by overlap, not by exact start, so the external ID or a delete strategy must cope with shifting bounds. Allow `zepp_os` for `sleep_session` in `ours/ingest`. The CRC is enforced upstream here, so keep ours.
6. **Sleep fallback, S-noscore bucket and gaps (P1).** Segment kind-120 minutes with the `Seg` rules: close on steps > 0 or a 60-min non-sleep run, require at least 5 min, add a 60 s trailing pad. Use the threshold stage map from `HESP:124-145`. Use it only where no `0x48` session overlaps (`FbSSP:12-14`). It needs the activity bytes from gap 4. A session can span two fetch pages, so segmentation has to run over a persisted window, not per page. INFERRED.
7. **Multi-type orchestration and checkpoint format (P1).** `HelioCursor` is a single activity cursor stored as the CAS checkpoint (`ours/sync`). It needs a versioned composite checkpoint (`{activity, sleepSession, …}`) and one sequential op queue per session, mirroring `Fetcher:170-202`. Each type is committed and then acked with `03 09` separately.
8. **BT-Classic-default models (P2).** For the 7 T-classic ids, history must run over BLE (iOS has no SPP). Verify on hardware that BLE GATT with FEE0, `0016`/`0017` and `0005` works on them. Upstream supports this only via the forced-connection-type preference (`Coord:120-133`, `Coord:370-380`). Until verified, show them as unvalidated.
9. **Robustness parity (P2).** Accept a metadata length of 16 regardless of the last byte. Honour metadata seconds, or assert they are 0. Accept any `10 03 …` ack reply. Request MTU 247 after auth for throughput (`Btle:190-195`).
10. **Backfill window (P3, product decision).** Upstream starts 100 days back (`AFO:300-302`); we start 24 h back. A longer first sync needs more than 32 pages, or the page caps must be raised.
11. **Optional (P3).** Manual HR `0x02` as additional `heart_rate` samples. Resting HR `0x3a` needs a daily record type. SpO2, stress, HRV, PAI and temperature stay out of scope.

Hardware gate: no model, the Helio Strap included, has a hardware-validated history sync (`ours/reg` header). Every item above should land behind real-device checks on at least one model from each bucket in 8.2 (for example Helio Strap, GTR 3 or Band 7, and Active 2).

## 10. Q9: uncertainties

- **Activity CRC.** Whether the 7-byte completion CRC32 actually matches the counter-stripped activity buffer. Upstream disables the check with a TODO (`FAO:135-140`). This is the biggest risk to our current Helio path.
- **Inbound encryption trailer.** Whether watch-to-phone encrypted frames carry seq+CRC32 like outbound ones. Upstream never checks (`Dec:105-127`); we do.
- **Which models lack `0x004b`.** No coordinator flag decides it. It is decided by the firmware's service list at runtime.
- **BLE on T-classic models.** Whether BLE history works on the 7 Classic-default models. INFERRED from the forced-connection setting, never observed.
- **What `03 01` actually deletes.** The upstream comment says detailed data "seems to be discarded, and is not sent again". The extent, and the effect on the official Zepp app, are UNKNOWN. That is a reason to keep `03 09`.
- **Round size and retention.** Minutes per round, and how much history the watch retains, are UNKNOWN.
- **Sleep-session fields.** Units of `sleepStart`/`sleepEnd` (`0x0a`/`0x0c`) and the meaning of stage types other than 4/5/7/8 are UNKNOWN. Revisions are confirmed by upstream's overlap handling (`HSSP:38-43`), but how often they happen is UNKNOWN.
- **Heart-rate sentinels.** Whether 0 or 255 is the "not measured" value on Zepp OS. INFERRED from legacy Huami.
- **Kind-120 fallback quality.** Upstream calls the thresholds arbitrary (`HESP:129`), so stage quality on the S-noscore bucket is poor.
- **Unknown sample byte.** The meaning of `unknown1` (byte 4) is UNKNOWN.
