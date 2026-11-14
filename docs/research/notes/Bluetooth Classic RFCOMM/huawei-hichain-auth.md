# Huawei full HiChain authentication (HiChain and HiChain3)

Byte-level spec of the Huawei **full HiChain** app-layer authentication as Gadgetbridge implements it, written so we can port it into `HuaweiSession`. Scope: `deviceSupportType` 1, 3 and 4 (and the `deviceSupportType` 2 devices whose negotiation lands on HiChain), the classic HiChain ISO exchange on `0x01/0x28`, and the PIN fetch on `0x01/0x2C`. Out of scope: HiChainLite (`GetAuthRequest` digest; see §7.7) and Honor PAKE/STS (`GetHiChainPakeRequest`; see `honor-pake-sts.md`).

Today our session refuses this path with `HuaweiUnsupportedAuthError("hichain")` (`ours/transport/huawei.ts:438`, `:457-458`). The parent spec is `bluetooth-classic-rfcomm.md` §3.4 (P2 in its plan).

## 0. Sources and citation keys

Upstream is Gadgetbridge (AGPL-3.0-or-later), pinned at commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. Raw files are at `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/<path>`. Before citing them, I diffed the copies in the scratchpad against fresh downloads at the pin. They are identical.

| Key    | Upstream path (under `…/gadgetbridge/`)                              |
| ------ | -------------------------------------------------------------------- |
| `GHR`  | `service/devices/huawei/requests/GetHiChainRequest.java`             |
| `GPR`  | `service/devices/huawei/requests/GetPincodeRequest.java`             |
| `GSNR` | `service/devices/huawei/requests/GetSecurityNegotiationRequest.java` |
| `GAR`  | `service/devices/huawei/requests/GetAuthRequest.java`                |
| `GLPR` | `service/devices/huawei/requests/GetLinkParamsRequest.java`          |
| `Req`  | `service/devices/huawei/requests/Request.java`                       |
| `RM`   | `service/devices/huawei/ResponseManager.java`                        |
| `SP`   | `service/devices/huawei/HuaweiSupportProvider.java`                  |
| `BRS`  | `service/devices/huawei/HuaweiBRSupport.java`                        |
| `LES`  | `service/devices/huawei/HuaweiLESupport.java`                        |
| `DC`   | `devices/huawei/packets/DeviceConfig.java`                           |
| `Cry`  | `devices/huawei/HuaweiCrypto.java`                                   |
| `Pkt`  | `devices/huawei/HuaweiPacket.java`                                   |
| `TLV`  | `devices/huawei/HuaweiTLV.java`                                      |
| `HCo`  | `devices/huawei/HuaweiConstants.java`                                |
| `CU`   | `util/CryptoUtils.java`                                              |
| `GBU`  | `util/GB.java`                                                       |
| `SU`   | `util/StringUtils.java`                                              |

`ours/` means `apps/native/lib/direct-devices/` in this repo.

Upstream has **no HiChain tests**. The test directories at the pin hold `TestHuaweiCrypto`, `TestHuaweiPacket`, `TestHuaweiTLV`, `packets/TestDeviceConfig`, `TestHiChainPakeUtils` (PAKE only) and `TestHuaweiSupportProvider`. None of them touches `0x28`, `0x2C` or `0x33`. The vectors in §6 are therefore **synthesized by us** (see §6.4).

Conventions used below:

- "hex" means `StringUtils.bytesToHex`, which is `GB.hexdump`. It produces **uppercase** hex with no separators (`SU:246-248`, `GBU:431-446`).
- "unhex" means `GB.hexStringToByteArray`, which is case-insensitive via `Character.digit` (`GBU:502-510`).
- All multi-byte integers are big-endian (Java `ByteBuffer`).

## 1. Decision tree

### 1.1 Inputs from LinkParams (`0x01/0x01`)

| Response tag | Field               | Parse                                              | Cite         |
| ------------ | ------------------- | -------------------------------------------------- | ------------ |
| `0x05`       | auth version, nonce | `[1]` is `authVersion`, `[2..18)` is `serverNonce` | `DC:101-102` |
| `0x07`       | `deviceSupportType` | byte, default 0                                    | `DC:104-105` |
| `0x08`       | `authAlgo`          | byte                                               | `DC:107-108` |
| `0x0C`       | `encryptMethod`     | byte (1 means GCM)                                 | `DC:113-114` |
| `0x02/0x03`  | slice size / MTU    | short                                              | `DC:92-96`   |

These are stored on `ParamsProvider` (`GLPR:75-87`). Ours already parses all of them (`ours/protocol/huawei.ts` `parseHuaweiLinkParamsResponse`).

### 1.2 Path to the auth mode

On BR, `GetDeviceStatusRequest` runs first. Only status `-1`, `0` or `1` continues (`SP:554-578`). Then `initializeDeviceDealHiChain` decides (`SP:608-637`):

```
deviceSupportType (LinkParams tag 0x07)
├── 1, 3, 4  → isHiChain()            (SP:585-597)
├── 2        → isHiChainLite() → isHiChain() is also true (SP:596, 599-602)
└── other (0, 8, …) → initializeDeviceNormalMode (SP:629-631)

isHiChain():
  authMode := (deviceSupportType == 4) ? 4 : 2            (SP:612-615)
  send SecurityNegotiation 0x01/0x33 (authMode)            (SP:616-628)
  on response:
    coordinator.supportsHiChainPake() → Honor PAKE/STS     (SP:620-621)   [out of scope]
    else finalizeSecurityNegotiationHiChain:               (SP:663-673)
      authType == 0x0186A0 or isHiChain3(authType) → initializeDeviceHiChainMode   ← THIS SPEC
      authType == 1 or 2                           → initializeDeviceHiChainLiteMode
      anything else                                 → nothing happens (chain stalls)
isHiChain3(a) := (a ^ 1) == 4 || (a ^ 2) == 4,  i.e. a ∈ {5, 6}   (SP:604-606)
```

The source comment records the vendor meanings: "HiChain: 1 || 3, HiChainLite: 2 || 3 || 8, HiChain3: 4 & API>=23" (`SP:586-594`).

So `deviceSupportType` alone does not pick the mode. **The SecurityNegotiation `authType` does**, for both type 2 and types 1/3/4. A type-2 device can land on full HiChain. A type-1/3/4 device can land on HiChainLite. Our session currently sends the negotiation only for type 2 and refuses the HiChain outcome there too (`ours/transport/huawei.ts:440-462`).

### 1.3 SecurityNegotiation request (`0x01/0x33`), non-PAKE form

Built by `DC:1852-1878`. It is unencrypted (`DC:1877`) and the TLV order is exactly as below. Upstream passes `deviceUUID = getAndroidId()` (`GSNR:63-68`) and `phoneModel = android.os.Build.MODEL`.

| Order | Tag    | Value                               | Present when         |
| ----- | ------ | ----------------------------------- | -------------------- |
| 1     | `0x01` | `authMode` (1 byte: 2 or 4)         | always               |
| 2     | `0x02` | `0x01` ("force to not reconnected") | `authMode` is 2 or 4 |
| 3     | `0x05` | `deviceUUID` (32 ASCII bytes, §3.1) | always               |
| 4     | `0x03` | `0x01`                              | always               |
| 5     | `0x04` | `0x00`                              | always               |
| 6     | `0x06` | empty                               | `authMode == 4`      |
| 7     | `0x07` | phone model, UTF-8                  | `authMode == 4`      |
| 8     | `0x0D` | `0x01`                              | `encryptMethod == 1` |

Ours, `buildHuaweiSecurityNegotiationRequest`, already emits this layout, including the `authMode == 4` tags (`ours/protocol/huawei.ts:763-786`). There is one gap: the session passes a **fresh random lowercase** hex UUID every time (`ours/transport/huawei.ts:448`). Upstream passes the **persisted uppercase** `androidId`, the same value it uses as the HiChain `authIdSelf` (`GSNR:66`, `GHR:101`, `:201`). See §7.

### 1.4 SecurityNegotiation response → `authType`

Parsed by `DC:1923-1945`. `getByte` returns the first byte of the value, signed (`TLV:237-239`).

```
authType := -1 ; pw := -1
if tag 0x01 present:  if [0x01]==0x01 → authType := 0x0186A0 (100000)
                      if [0x01]==0x04 → pw := 4
if tag 0x02 present:  authType := [0x02]; if pw != -1 → authType ^= 4
if tag 0x7F present:  authType := [0x7F]          (first byte of the error value)
responseNonce := tag 0x03 (PAKE only)
```

| tag `0x01` | tag `0x02` | tag `0x7F` | `authType` | Path                            |
| ---------- | ---------- | ---------- | ---------- | ------------------------------- |
| `01`       | absent     | absent     | `0x0186A0` | **HiChain**                     |
| `04`       | `01`       | absent     | `5`        | **HiChain3**                    |
| `04`       | `02`       | absent     | `6`        | **HiChain3**                    |
| not `04`   | `05`/`06`  | absent     | `5`/`6`    | **HiChain3**                    |
| any        | `01`/`02`  | absent     | `1`/`2`    | HiChainLite (when `tag01 ≠ 04`) |
| `04`       | absent     | absent     | `-1`       | stall (no branch)               |
| any        | any        | `v…`       | `v[0]`     | usually stall                   |

Ours, `parseHuaweiSecurityNegotiationResponse`, implements the same rules with unsigned bytes (`ours/protocol/huawei.ts:792-812`). The only difference is the sign for values ≥ `0x80`, which never reaches a branch either way.

**HiChain and HiChain3 run the same exchange.** `initializeDeviceHiChainMode` is called for both (`SP:665-667`), and `GetHiChainRequest` has no HiChain3 branch. For the differences that do exist, see §4.

### 1.5 `initializeDeviceHiChainMode`

`SP:708-722`:

```
hiChainReq := GetHiChainRequest(firstConnection); finalize := configureReq
if firstConnection: GetPincodeRequest → then hiChainReq
else:               hiChainReq
```

`firstConnection` is set to `true` only by `connectFirstTime()`, which runs when the user pairs the device from the GB UI (`BRS:74-77`, `LES:80-83`). The field defaults to `false` (`SP:271`) and is never reset. **INFERRED:** GB builds a new support object per connection attempt, so automatic reconnects run with `false`.

## 2. PIN (`GetPincodeRequest`, `0x01/0x2C`)

### 2.1 Request

`DC:1693-1706`: one empty tag `0x01`, unencrypted, `complete = true`.

```
TLV   : 01 00
Frame : 5A 00 05 00 01 2C 01 00 AF 3B
```

We computed the frame CRC with the upstream algorithm. The same code reproduces upstream's LinkParams test frame `…F1 3B` (`TestDeviceConfig.java:86`).

### 2.2 Response and decryption

`DC:1718-1729`: `message = tag 0x01` and `iv = tag 0x02`. Both are required; `getBytes` throws `MissingTagException` (`TLV:222-227`). Then `HuaweiCrypto.decryptPinCode(encryptMethod, message, iv)` (`Cry:248-257`) runs:

- **Key:** the digest secret for `authVersion` (`Cry:107-117`). It is 16 bytes, so AES-128.
  - `authVersion` 1 or 4: `DIGEST_SECRET_v1` = `70FB6C24035FDB552F38898AEEDE3F69`
  - `authVersion` 2: `DIGEST_SECRET_v2` = `93ACDEF76ACB09857DBFE5261AABCD78`
  - any other: `DIGEST_SECRET_v3` = `9C2763A9CCE134766DE3FF6118200553`

  (`Cry:65-76`. Ours has these as `HUAWEI_DIGEST_SECRET_V1..V3`, `ours/crypto/huawei-auth.ts`.)

- **`encryptMethod == 1`:** `AES/GCM/NoPadding`, 128-bit tag appended, IV = tag `0x02` as-is, no AAD (`CU:100-109`).
- **Otherwise:** `AES/CBC/PKCS5Padding` (PKCS#7), IV = tag `0x02` (`CU:67-73`).
- The plaintext is stored **raw** in `ParamsProvider.pinCode` (`GPR:53`, `Pkt:73`, `:130-135`).

### 2.3 How the PIN is used

`GHR:206-209`: `pinKey = SHA-256( UTF-8( hex(pinCode) ) )`. The PIN bytes are uppercase-hexed, the hex string is SHA-256'd, and the result keys the PSK HMAC (§3.4). Whatever the plaintext is (ASCII digits or binary), it is used opaquely. **UNKNOWN:** the real plaintext format.

### 2.4 When it is fetched, where it is kept, and what the user does

- It is fetched **only when `firstConnection`**, right before the bind (`SP:712-715`). On reconnect it is not fetched (`SP:716-717`).
- It is **never persisted.** It lives in memory on `ParamsProvider` only. What is persisted is the bind result, `authToken` (§3.6).
- The user does **not** type the PIN. The phone reads it from the watch over the link, encrypted with a constant key.
- The confirmation happens on the watch. `GHR:56-57` reads: "The user needs to confirm the pairing request on the device itself", with `firstAuthenticateTimeout = 30 * 1000` and `authenticateTimeout = 5000`.
  - The 30 s timeout is armed on the **first** `GetHiChainRequest` object of a bind (`GHR:64-66`). That is operation 1, step 1.
  - The 5 s timeout is armed for an authenticate (`GHR:67-69`).
  - The step-copy constructor sets no timeout (`GHR:73-89`), so steps 2-4 have none.
  - The timer starts when the request is queued (`Req:364-369`) and is cleared when any `0x01/0x28` response arrives (`Req:246-248`).
- **INFERRED:** the watch shows its "pair with this phone?" prompt when it receives op-1 step 1, and holds back its step-1 response until the user taps. This is why only that step gets 30 s.
- **UNKNOWN:** whether the watch displays the PIN at all.
- `GetPincodeRequest` itself has no timeout (`GPR:31-35`, no `setupTimeoutUntilNext`).

## 3. HiChain ISO exchange (`GetHiChainRequest`, `0x01/0x28`)

### 3.1 Identity and constants

- **`androidId`.** `createAndroidID()` generates it once per device: `hex(16 random bytes)`, a 32-character uppercase string, persisted as `PREF_FAKE_ANDROID_ID` (`SP:926-937`).
- **`authIdSelf`.** `getAndroidId()` returns the **UTF-8 bytes of that string**, 32 bytes (`SP:939-941`). These bytes are what gets HMAC'd and hexed.
- **`groupId`.** `HuaweiConstants.GROUP_ID` = `"7B0BC0CBCE474F6C238D9661C63400B797B166EA7849B3A370FC73A9A236E989"`, used as a string (`HCo:36`).
- **`requestId`.** `System.currentTimeMillis()` at the first `createRequest` of an operation (`GHR:93-95`). It is fixed for every step of that operation. Op 2 is a fresh request object, so it gets a fresh `requestId` (`GHR:183`).
- **Operation codes.** `0x01` is used when `firstConnection` (`GHR:64-66`) and `0x02` otherwise (`GHR:42`).
  - In HiChain/device-auth terms, **1 = bind** (register us in the watch's group using the PIN) and **2 = authenticate** (using the bound token).
  - Upstream's log strings are swapped: at the end of op 1 it logs "Finished auth operation, go to bind" (`GHR:182`). The code itself matches bind-then-auth.
- **First connection runs op 1 and then op 2 in the same connection** (`GHR:181-185`). A reconnect runs op 2 only.

### 3.2 Packet framing

Every request step is `HiChain.Request.BaseStep` (`DC:1048-1061`): service `0x01`, command `0x28`, `isSliced = true`, `isEncrypted = false`.

Request TLV, in this order (`DC:1087-1090`, same in every step):

| Tag    | Value                                    |
| ------ | ---------------------------------------- |
| `0x01` | UTF-8 JSON string (`value.toString()`)   |
| `0x02` | `operationCode`, 1 byte                  |
| `0x03` | `requestId` as an 8-byte big-endian long |

Response TLV (`DC:1441-1455`):

| Tag    | Value                                                                               |
| ------ | ----------------------------------------------------------------------------------- |
| `0x04` | type byte. `0x00` means tag `0x01` is JSON. Any other value means "step 4 / final". |
| `0x01` | UTF-8 JSON (type 0) or opaque string (`Step4Data.data`, `DC:1270-1285`)             |

If tag `0x04` is absent, the parser falls into the Honor-PAKE framing branch (`DC:1461-1470`). On a classic device that leaves `step = 0`; see §5.

Slicing uses the normal sliced serializer: one frame if `2 + len(TLV)` fits `sliceSize − 7`, otherwise slices `01, 02…, 03` (`Pkt:877-936`). Ours, `encodeHuaweiPacket`, is the same algorithm. Op-1 JSON is about 670 bytes, so with slice size `0xF4` a step-1 request is 3 slices.

### 3.3 JSON envelope (request side)

`createJson(messageId)` (`DC:1173-1203`). Android `org.json` keeps insertion order and prints with no whitespace. The key order below is the upstream order.

```
message := messageId | (operationCode == 2 ? 0x10 : 0)
value = {
  "authForm": 0,
  "payload": { "version": {"minVersion":"1.0.0","currentVersion":"2.0.16"}, <step fields…> },
  "groupAndModuleVersion": "2.0.1",
  "message": <message>,
  // op 1 only:
  "requestId": "<requestId as decimal string>",
  "groupId": GROUP_ID,
  "groupName": "health_group_name",
  "groupOp": 2,
  "groupType": 256,
  "peerDeviceId": "<androidId string>",
  "connDeviceId": "<androidId string>",
  "appId": "com.huawei.health",
  "ownerName": "",
  // step-specific trailing keys (below)
}
```

The step fields go into `payload` after `version`. `value` holds a reference to `payload`, so the step's later `put`s land inside it.

`messageId` equals `step` at the top of `createRequest` (`GHR:105`). In op 2, step 3 is skipped by incrementing `step` **after** `messageId` was taken (`GHR:143-145`). So op-2's step-four payload goes out with `message = 3 | 0x10 = 0x13`. The commented-out `createJson(3)` (`DC:1153-1157`) shows this is intended.

| Op  | Step sent | `message` | `payload` keys after `version` (in order)                                                                             | Trailing `value` keys    | Cite           |
| --- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------- |
| 1   | StepOne   | 1         | `isoSalt`=hex(randSelf), `peerAuthId`=hex(authIdSelf), `operationCode`=1, `seed`=hex(seed), `peerUserType`=0          | —                        | `DC:1065-1097` |
| 1   | StepTwo   | 2         | `peerAuthId`=hex(authIdSelf), `token`=hex(selfToken)                                                                  | —                        | `DC:1100-1120` |
| 1   | StepThree | 3         | `nonce`=hex(nonce12), `encData`=hex(encData)                                                                          | —                        | `DC:1123-1143` |
| 1   | StepFour  | 4         | `nonce`=hex(nonce12), `encResult`=hex(encResult), `operationCode`=1                                                   | —                        | `DC:1146-1171` |
| 2   | StepOne   | 0x11 (17) | as op 1 with `operationCode`=2, then `pkgName`="com.huawei.devicegroupmanage", `serviceType`=GROUP_ID, `keyLength`=32 | `"isDeviceLevel": false` | `DC:1080-1086` |
| 2   | StepTwo   | 0x12 (18) | `peerAuthId`, `token`                                                                                                 | `"isDeviceLevel": false` | `DC:1111`      |
| 2   | StepFour  | 0x13 (19) | `nonce`, `encResult`, `operationCode`=2                                                                               | —                        | `GHR:143-155`  |

Note on `peerAuthId`: we send `hex(UTF-8(androidId))`, which is 64 hex characters, while `peerDeviceId`/`connDeviceId` carry the 32-character `androidId` itself (`DC:1076`, `:1195-1196`).

### 3.4 Steps, crypto and checks

Notation: `‖` is concatenation, `HMAC` is HMAC-SHA256 (`CU:111-116`), `SHA` is SHA-256 (`CU:118-121`). `HKDF(ikm, salt, info, L)` is RFC 5869 HKDF-SHA256: `PRK = HMAC(salt, ikm)`, `T(i) = HMAC(PRK, T(i−1) ‖ info ‖ i)` (`CU:124-150`). We checked that it equals Node's `hkdfSync("sha256", …)` (§6.4). `GCM(k, iv, aad, pt)` is AES-GCM, no padding, 128-bit tag appended; the AES size follows the key length (32 bytes means AES-256) (`CU:89-109`).

Randoms upstream draws per operation, all from `java.util.Random` (not a CSPRNG; ours must use one):

| Name             | Size | Wire name   | Cite          |
| ---------------- | ---- | ----------- | ------------- |
| `seed`           | 32 B | `seed`      | `GHR:108-109` |
| `randSelf`       | 16 B | `isoSalt`   | `GHR:110-111` |
| `nonce` (step 3) | 12 B | `nonce`     | `GHR:135-136` |
| `challenge`      | 16 B | (encrypted) | `GHR:137-138` |
| `nonce` (step 4) | 12 B | `nonce`     | `GHR:149-150` |

**Step 1, phone to watch.** Send StepOne (`GHR:107-113`).

**Step 1, watch to phone.** The response JSON payload must have `isoSalt` (this routes it, `DC:1480-1482`), `peerAuthId`, `peerUserType` (int, **required**) and `token`, all unhexed (`DC:1216-1221`). Then (`GHR:199-227`):

```
authIdSelf := UTF-8(androidId) ; authIdPeer := unhex(peerAuthId) ; randPeer := unhex(isoSalt)
key  := op==1 ? SHA( UTF-8( hex(pinCode) ) )        // GHR:206-209
             : stored authToken ("authkey")         // GHR:210-212, SP:864-872
psk  := HMAC(key, seed)                              // GHR:213  → 32 B
check: unhex(token) == HMAC(psk, randPeer ‖ randSelf ‖ authIdSelf ‖ authIdPeer)   // GHR:214-227
```

**Step 2, phone to watch.** `selfToken = HMAC(psk, randSelf ‖ randPeer ‖ authIdPeer ‖ authIdSelf)` (`GHR:115-123`). This is the mirror of the peer's message.

**Step 2, watch to phone.** The payload has `returnCodeMac` (routing, `DC:1483-1485`). Check `unhex(returnCodeMac) == HMAC(psk, 00 00 00 00)` (`GHR:228-236`).

**Step 3, phone to watch (op 1 only).** (`GHR:125-142`):

```
sessionKey := HKDF(psk, randSelf ‖ randPeer, "hichain_iso_session_key", 32)   // GHR:126-132
encData    := GCM(sessionKey, nonce12, aad="hichain_iso_exchange", challenge16) // 32 B = 16 ct + 16 tag
```

Op 2 computes the same `sessionKey` at this point and goes straight to step 4 (`GHR:143-145`).

**Step 3, watch to phone (op 1).** The payload has `nonce` and `encAuthToken` (routing, `DC:1486-1488`):

```
authToken := GCM-decrypt(sessionKey, unhex(nonce), aad = challenge16, unhex(encAuthToken))   // GHR:239-241
persist authToken as "authkey" (uppercase hex) and set it as the packet key                 // GHR:242, SP:874-882
```

**Step 4, phone to watch.** `encResult = GCM(sessionKey, nonce12, aad="hichain_iso_result", 00 00 00 00)`. That is 20 bytes: 4 ciphertext plus 16 tag (`GHR:147-155`).

**Step 4, watch to phone.** A response whose tag `0x04` is not `0x00` (`DC:1446-1453`). Its content is **not verified** by upstream.

- op 1: start a fresh `GetHiChainRequest(support, false)`, which is op 2 with a 5 s timeout and the same finalize callback (`GHR:181-185`).
- op 2 (`GHR:186-196`):

```
packetKey := HKDF(sessionKey, randSelf ‖ randPeer, "hichain_return_key", 32)
paramsProvider.setSecretKey(packetKey)            // NOT persisted
```

Then the finalize callback `configureReq.call()` runs `initializeDeviceConfigure()` (`SP:679-683`, `:781-848`).

### 3.5 From result to packet encryption

- The packet key is **32 bytes**. `HuaweiTLV.encryptRaw/decryptRaw` pass it straight into `SecretKeySpec(key, "AES")` (`TLV:391-417`, `CU:59-73`, `:89-109`). **So every encrypted transaction after HiChain is AES-256**: CBC/PKCS7, or GCM when `encryptMethod == 1 || deviceSupportType == 4`.
- Ours hard-requires 16-byte keys (`ours/protocol/huawei.ts:514`, `:526`) and hard-codes `aes-128-*` (`:605-620`). This must change (§7.2).
- The IV is `ParamsProvider.getIv()` (`Pkt:150-160`).
  - `deviceSupportType == 4`: 16 fully random bytes, no counter.
  - Otherwise: 12 random bytes plus a counter.
  - The HiChain path never runs `BondParams`, so the counter starts at 0 and the first IV ends in `00000001`.
- The HiChain requests are `isEncrypted = false` (`DC:1054`). Responses are decrypted only when they carry `0x7C = 1` (`Pkt:282-300`).
- Transactions-crypted-off models (`isTransactionCrypted() == false`) still run HiChain. They just send `0x07` in the clear afterwards (`Pkt:1097-1105`).

### 3.6 Persistence and the reconnect path

| Value                        | Upstream storage                                           | Lifetime           | Cite                    |
| ---------------------------- | ---------------------------------------------------------- | ------------------ | ----------------------- |
| `androidId`                  | device prefs `PREF_FAKE_ANDROID_ID` (uppercase hex string) | forever per device | `SP:926-937`            |
| `authToken`                  | device prefs `"authkey"` (uppercase hex)                   | until re-bind      | `GHR:242`, `SP:874-882` |
| PIN                          | memory (`ParamsProvider.pinCode`)                          | one connection     | `GPR:53`, `Pkt:130-135` |
| `sessionKey`, `psk`, randoms | memory (request objects)                                   | one operation      | `GHR:40-54`, `:73-89`   |
| packet key                   | memory (`ParamsProvider.secretKey`)                        | one connection     | `GHR:196`               |

- **Reconnect** is LinkParams, then DeviceStatus (BR), then SecurityNegotiation, then op 2 (steps 1, 2, 4) keyed by the stored `authToken`, then the packet key.
- No PIN and no watch confirmation are needed. The step-1 timeout is 5 s.
- `"authkey"` is the **same pref** normal mode and HiChainLite use for their random local key (`SP:850-862`).
  - **INFERRED:** if a device's `authkey` came from another mode, op 2 fails the step-1 token check.
  - If there is no `authkey` at all, `getSecretKey()` unhexes `null`, which is an NPE; the source marks this `TODO` (`SP:864-872`).

## 4. HiChain3 differences

The exchange is identical: same class, same JSON, same crypto (§1.4). The differences come from `deviceSupportType == 4`, not from `authType`:

1. **SecurityNegotiation `authMode = 4`** (`SP:612-613`). The request adds empty tag `0x06` and tag `0x07` with the phone model (`DC:1869-1871`).
2. **GCM always.** `useGCM = encryptMethod == 1 || deviceSupportType == 4` (`TLV:395`, `:413`). Ours already has this (`huaweiUsesGcm`, `ours/protocol/huawei.ts:503`).
3. **Random 16-byte IVs**, no counter (`Pkt:150-154`). Ours always uses the counter IV (`ours/transport/huawei.ts:685-692`).

An `authType` of 5 or 6 (the "HiChain3" values) reached with `deviceSupportType` 1, 2 or 3 keeps `authMode = 2` and the counter IV. Only the branch label differs.

The PIN decrypt for HiChain3 uses `encryptMethod` only (`DC:1725`), not `deviceSupportType`.

## 5. Errors and timeouts

How upstream behaves, mapped to the typed errors we should raise.

| Situation                                                          | Upstream behaviour                                                                                                      | Cite                                        | Ours (proposed)                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- |
| SecurityNegotiation gives no response                              | no timeout set, so it hangs                                                                                             | `GSNR:38-42`                                | watchdog: `HUAWEI_REQUEST_TIMEOUT` |
| Negotiated `authType` matches no branch                            | nothing called, so it hangs                                                                                             | `SP:663-673`                                | `HUAWEI_AUTH_NEGOTIATION_FAILED`   |
| PinCode gives no response                                          | no timeout, so it hangs                                                                                                 | `GPR:31-35`                                 | watchdog                           |
| PinCode decrypt fails or a tag is missing                          | `ParseException` in `parseTlv`. `finalizeReq` is null on the pincode request, so it is only logged and the chain stops  | `DC:1720-1728`, `Req:250-256`               | `HUAWEI_HICHAIN_PIN_FAILED`        |
| Op-1 step 1 not answered in 30 s (user did not confirm)            | `configureReq.timeout`: `reportPairingError(authentication_failed_negotiation)`, device goes to `WAITING_FOR_RECONNECT` | `GHR:57`, `SP:685-694`                      | `HUAWEI_HICHAIN_CONFIRM_TIMEOUT`   |
| Op-2 step 1 not answered in 5 s                                    | same as above                                                                                                           | `GHR:58`, `SP:685-694`                      | `HUAWEI_REQUEST_TIMEOUT`           |
| Steps 2-4 not answered                                             | no timeout, so it hangs                                                                                                 | `GHR:73-89`                                 | watchdog                           |
| `payload.errorCode != 0` in any step                               | `ResponseParseException`, then `handleException`: `reportPairingError` and **disconnect**                               | `DC:1538-1540`, `GHR:173-175`, `SP:696-705` | `HUAWEI_HICHAIN_REJECTED(code)`    |
| Peer token mismatch (wrong PIN, or stale `authkey`)                | same as above                                                                                                           | `GHR:222-224`                               | `HUAWEI_HICHAIN_TOKEN_MISMATCH`    |
| `returnCodeMac` mismatch                                           | same as above                                                                                                           | `GHR:231-233`                               | `HUAWEI_HICHAIN_TOKEN_MISMATCH`    |
| GCM tag failure on `encAuthToken`                                  | same as above (wrapped at `GHR:251-253`)                                                                                | `GHR:241`                                   | `HUAWEI_HICHAIN_TOKEN_MISMATCH`    |
| Malformed JSON, or a missing `peerUserType`                        | `JsonException` from `parseTlv`, then `handleException`                                                                 | `DC:1219`, `:1542-1544`                     | `HUAWEI_HICHAIN_PROTOCOL`          |
| Response without tag `0x04`, or JSON with none of the routing keys | `step` stays 0, so upstream re-sends step 1 with new randoms (an accidental loop)                                       | `DC:1461-1470`, `GHR:176`, `:246-249`       | `HUAWEI_HICHAIN_PROTOCOL`          |
| Response is not a `HiChain.Response`                               | `ResponseTypeMismatchException`                                                                                         | `GHR:169-170`                               | `HUAWEI_HICHAIN_PROTOCOL`          |

Watch error codes, when present, are ints in `payload.errorCode`. Their meanings are not documented in source.

## 6. Byte layouts and vectors

### 6.1 SecurityNegotiation request (vector)

Inputs: `androidId = "000102030405060708090A0B0C0D0E0F"`, so `deviceUUID` is its 32 ASCII bytes.

```
authMode 2, encryptMethod 0
TLV   01 01 02 | 02 01 01 | 05 20 3030303130323033303430353036303730383039304130423043304430453046 | 03 01 01 | 04 01 00
Frame 5A 00 31 00 01 33 <TLV> 1B 92

authMode 4, encryptMethod 1, phoneModel "Pixel 8"
TLV   01 01 04 | 02 01 01 | 05 20 <32 B> | 03 01 01 | 04 01 00 | 06 00 | 07 07 506978656C2038 | 0D 01 01
Frame 5A 00 3F 00 01 33 <TLV> BB 29
```

### 6.2 PinCode

```
request frame   5A 00 05 00 01 2C 01 00 AF 3B
response TLV    01 <len> <ciphertext> | 02 <len> <iv>
```

Vector: `authVersion` 2, so the key is `DIGEST_SECRET_v2`. Plaintext is ASCII `"12345678"` (`3132333435363738`) and IV is `C0C1…CF`.

| `encryptMethod` | tag `0x01` ciphertext                              |
| --------------- | -------------------------------------------------- |
| 0 (CBC/PKCS7)   | `A996CC6AF9999707D362FC68953C5A3C`                 |
| 1 (GCM, no AAD) | `46ED99574DF7C876921E5FC1E7BFFE448D2CD6952ED9C126` |

### 6.3 HiChain request TLV (op 1, step 1)

With `requestId = 1700000000000` the JSON is 671 bytes, so the TLV length varint is `85 1F`:

```
01 85 1F <671 B JSON> | 02 01 01 | 03 08 00 00 01 8B CF E5 68 00
TLV = 687 B; body = 689 B; sliceSize 0xF4 → 3 slices (flags 01, 02, 03)
```

The exact JSON for the §6.4 inputs (`seed = 20…3F`, `randSelf = 40…4F`):

```
{"authForm":0,"payload":{"version":{"minVersion":"1.0.0","currentVersion":"2.0.16"},"isoSalt":"404142434445464748494A4B4C4D4E4F","peerAuthId":"3030303130323033303430353036303730383039304130423043304430453046","operationCode":1,"seed":"202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F","peerUserType":0},"groupAndModuleVersion":"2.0.1","message":1,"requestId":"1700000000000","groupId":"7B0BC0CBCE474F6C238D9661C63400B797B166EA7849B3A370FC73A9A236E989","groupName":"health_group_name","groupOp":2,"groupType":256,"peerDeviceId":"000102030405060708090A0B0C0D0E0F","connDeviceId":"000102030405060708090A0B0C0D0E0F","appId":"com.huawei.health","ownerName":""}
```

The watch's response TLV is `04 01 00 | 01 <len> <JSON>`, where the JSON looks like `{"message":…,"payload":{"isoSalt":"…","peerAuthId":"…","peerUserType":0,"token":"…"}}`. Tag order in the response is not significant: the parser looks tags up by number. The envelope keys besides `payload` and `errorCode` are not read (`DC:1534-1545`).

### 6.4 Synthesized end-to-end vector (ours, not upstream)

We computed these with a Node `crypto` script that follows §3.4 line by line. The HKDF is written out as in `CU:124-150` and matches Node's `hkdfSync`. They prove internal consistency with the upstream algorithm **as read**, not interoperability with a real watch. All values are uppercase hex.

Inputs:

| Name                                  | Value                                                                 |
| ------------------------------------- | --------------------------------------------------------------------- |
| `androidId`                           | `"000102030405060708090A0B0C0D0E0F"`                                  |
| `authIdSelf` (bytes)                  | `3030303130323033303430353036303730383039304130423043304430453046`    |
| `authIdPeer`                          | ASCII `"WATCH-AUTH-ID-0001"` = `57415443482D415554482D49442D30303031` |
| PIN plaintext                         | `3132333435363738`                                                    |
| op 1: `seed`, `randSelf`, `randPeer`  | `20…3F` (32 B), `40…4F`, `50…5F`                                      |
| op 1: step-3 nonce, `challenge`       | `60…6B`, `70…7F`                                                      |
| op 1: watch step-3 nonce, `authToken` | `80…8B`, `90…AF` (32 B)                                               |
| op 1: step-4 nonce                    | `B0…BB`                                                               |
| op 2: `seed`, `randSelf`, `randPeer`  | `21…40`, `41…50`, `51…60`                                             |
| op 2: step-4 nonce                    | `B1…BC`                                                               |

Outputs:

| Value                                               | Hex                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| op 1 `pinKey` = SHA(UTF-8(hex(PIN)))                | `C0DFA082246E2A2EC22F143D46901665533DDE9EEB8170ABD6BAD6705BD96E2C`                                 |
| op 1 `psk`                                          | `F67940D7A4837F51EE59C71F1957335D0B5FC737907A88B75EC237F1E890CBA1`                                 |
| op 1 expected peer `token`                          | `C4887D26C6C8C0E12BAE0ADA1116DFA5966D8F4601B83FE86C3547C6C80534EF`                                 |
| op 1 `selfToken` (step 2)                           | `950B7455989DD2E86696C94D4605DEA7585517AC180176127514FB44A114EBE7`                                 |
| op 1 expected `returnCodeMac`                       | `C34687AC89913FB20B8011637D304FFA19780199812440C855A48AADBA2AE87C`                                 |
| op 1 `sessionKey`                                   | `050C282F63416BAC48F03CEB813DF1DBD82A2040D199EB1070DFEAD16E476719`                                 |
| op 1 step-3 `encData`                               | `5D1E1D875BEDD819A9B807C83C10C161EA5A20C3A63B8F315E93C61B73D9A4D5`                                 |
| op 1 watch `encAuthToken` (decrypts to `authToken`) | `0F7F22173BBBC03619F020057CEE67E489268F6151D62E7B59E13E4E22BFF301BD2250764486BB6FF40F517A1657AE09` |
| op 1 step-4 `encResult`                             | `DAE1227AA5E384F8A69FC22366B21418AECB58C8`                                                         |
| op 2 `psk` (key = `authToken`)                      | `17B39D65D90AC6AD5A5439E45407F2560A587AD4AFFE64198ACE979F8F830EA0`                                 |
| op 2 expected peer `token`                          | `36E3A594881955B73B2A72293BE8D4400BB5020A684A9DF29F7D6ABB0859B5EB`                                 |
| op 2 `selfToken`                                    | `8BA82765EA4B026006294B69DA28E1E9B71124A5171D8095E599D6C3B2F76DDB`                                 |
| op 2 expected `returnCodeMac`                       | `F11345832D23482BAE7B4FDDD276AB84F4F97C341B346AECC0DDF0BF32E99391`                                 |
| op 2 `sessionKey`                                   | `3A224DA789B0070EB60F848E30AF9335EA3DF1FF38D794E03CC8403D2CFCB0AA`                                 |
| op 2 step-4 `encResult`                             | `B34EC44DE586D6F39D1DA8CADD517516B1063BC8`                                                         |
| op 2 final packet key                               | `4078F9B3CC3A4C1EFE5E2F35F1D3B1EF80C253C5B7F47F87D9FF93B55DFB3E7F`                                 |

### 6.5 Message sequence

First connection (bind, then authenticate):

| #   | Dir | Svc/Cmd   | Content                                                               | Timeout (upstream)                |
| --- | --- | --------- | --------------------------------------------------------------------- | --------------------------------- |
| 1   | →←  | `01/01`   | LinkParams: `deviceSupportType`, `authVersion`, `encryptMethod`       | —                                 |
| 2   | →←  | `01/16`   | DeviceStatus (BR): continue on −1/0/1                                 | —                                 |
| 3   | →←  | `01/33`   | SecurityNegotiation (`authMode` 2/4): `authType`                      | none                              |
| 4   | →←  | `01/2C`   | PinCode: encrypted PIN                                                | none                              |
| 5   | →   | `01/28`   | op 1, message 1: `isoSalt`, `seed`, our id                            | **30 s** (user confirms on watch) |
| 6   | ←   | `01/28`   | `isoSalt`, `peerAuthId`, `token`: check token                         |                                   |
| 7   | →←  | `01/28`   | message 2 `token`, then ← `returnCodeMac`: check                      | none                              |
| 8   | →←  | `01/28`   | message 3 `encData`, then ← `encAuthToken`: **persist `authToken`**   | none                              |
| 9   | →←  | `01/28`   | message 4 `encResult`, then ← tag `04 ≠ 0`                            | none                              |
| 10  | →←  | `01/28`   | op 2, message 0x11, then ← step 1: check token                        | **5 s**                           |
| 11  | →←  | `01/28`   | message 0x12, then ← `returnCodeMac`                                  | none                              |
| 12  | →←  | `01/28`   | message 0x13 (step-four payload), then ← tag `04 ≠ 0`: **packet key** | none                              |
| 13  | …   | encrypted | configure (upstream) / `0x07` sync (ours)                             |                                   |

A reconnect is rows 1-3, then 10-13.

## 7. Implementation plan (our codebase)

### 7.1 Crypto primitives we have and need

Already present:

- `HuaweiCryptoProvider` has `randomBytes`, `sha256` and `hmacSha256` (`ours/crypto/huawei-auth.ts:41-45`, `:250-272`).
- `HuaweiAesProvider` has AES-**128**-CBC (PKCS7 via the default auto-padding) and AES-**128**-GCM (16-byte tag appended, **no AAD**) (`ours/protocol/huawei.ts:473-478`, `:580-628`).
- There is **no HKDF and no PBKDF2** wrapper.

`react-native-quick-crypto@1.1.9` (`apps/native/package.json:82`) does export the missing pieces:

- `hkdfSync` (`src/hkdf.ts:137`)
- `pbkdf2Sync` (`src/pbkdf2.ts:105`)
- `Cipher.setAAD`, `getAuthTag` and `setAuthTag` (`src/cipher.ts:317-348`)

To add:

1. **`hkdfSha256(ikm, salt, info, length)`** in `crypto/huawei-auth.ts`. Write it on top of `hmacSha256`: it is about 10 lines (`CU:124-150`), the test fakes keep working, and the native `hkdfSync` is not needed.
2. **`aesGcmEncrypt/Decrypt(key, iv, data, aad?)`** with any key length, any IV length and optional AAD. Add these to `HuaweiAesProvider` (or a new `HuaweiHiChainCipher`). The algorithm follows the key: `aes-${key.length * 8}-gcm`.
3. **AES-256 transactions.** In `encryptHuaweiPayload`/`decryptHuaweiPayload` accept 16- or 32-byte keys (`ours/protocol/huawei.ts:514`, `:526`). In `loadHuaweiAesProvider`, pick `aes-128-*` or `aes-256-*` by key length (`:605-620`). Keep the 16-byte IV assertion for transactions.
4. **PIN decrypt** with AES-128 CBC/GCM and the IV from tag `0x02`. Do not assert the IV length for GCM.

### 7.2 Modules and functions

**`protocol/huawei-hichain.ts`** is new and pure: no I/O, no randomness.

- `HUAWEI_HICHAIN_COMMAND = 0x28`, `HUAWEI_PINCODE_COMMAND = 0x2C`, `HUAWEI_HICHAIN_GROUP_ID`.
- `buildHuaweiPincodeRequest(): Uint8Array` returns `01 00`.
- `parseHuaweiPincodeResponse(tlv): { cipherText; iv }`. It throws `HUAWEI_HICHAIN_PIN_FAILED` on a missing tag.
- `decryptHuaweiPinCode({ authVersion, encryptMethod, cipherText, iv, aes })`.
- `buildHuaweiHiChainStepJson({ op, step, requestId, androidId, fields })` returns a string with the exact §3.3 key order. Build the string by hand or with ordered objects; `JSON.stringify` keeps insertion order for non-integer keys.
- `buildHuaweiHiChainRequest({ op, requestId, json }): Uint8Array` returns TLV `01 json | 02 op | 03 u64be` (`requestId` as a `bigint`).
- `parseHuaweiHiChainResponse(tlv)` returns a discriminated union: `{ step: 1, isoSalt, peerAuthId, peerUserType, token } | { step: 2, returnCodeMac } | { step: 3, nonce, encAuthToken } | { step: 4, data } | { error: number }`. It throws `HUAWEI_HICHAIN_PROTOCOL` for a missing tag `0x04` or unknown JSON. It never loops (§5).
- `classifyHuaweiAuthType(authType): "hichain" | "hichain3" | "hichain_lite" | null`.

**`crypto/huawei-hichain.ts`** is new and pure. It takes a `HuaweiCryptoProvider` plus the GCM functions.

- `hichainPinKey(pin)`: `SHA(utf8(hexUpper(pin)))`
- `hichainPsk(key, seed)`
- `hichainPeerTokenExpected(psk, randPeer, randSelf, authIdSelf, authIdPeer)`
- `hichainSelfToken(psk, randSelf, randPeer, authIdPeer, authIdSelf)`
- `hichainReturnCodeMac(psk)`
- `hichainSessionKey(psk, randSelf, randPeer)`
- `hichainEncryptChallenge(sessionKey, nonce, challenge)`
- `hichainDecryptAuthToken(sessionKey, nonce, enc, challenge)`
- `hichainEncryptResult(sessionKey, nonce)`
- `hichainPacketKey(sessionKey, randSelf, randPeer)`

All comparisons are constant-time.

**`transport/huawei-hichain.ts`** is new: the exchange driver, decoupled from `HuaweiSession`.

```ts
type HiChainIo = { request(commandId: number, tlv: Uint8Array, watchdogMs: number): Promise<HuaweiTlv> };
runHuaweiHiChainOperation(io, {
  op: 1 | 2,
  key,
  androidId,
  random,
  now,
  step1WatchdogMs,
  crypto,
  aes,
}): Promise<{ authToken?: Uint8Array; packetKey?: Uint8Array }>
```

- op 1 returns `authToken`.
- op 2 returns `packetKey`.

### 7.3 State machine inside `HuaweiSession`

Replace the `throw new HuaweiUnsupportedAuthError("hichain")` sites (`ours/transport/huawei.ts:433-462`) with:

```
NEGOTIATE
  LinkParams → (BR) DeviceStatus
  dst ∈ {1,2,3,4}:
    authMode := dst==4 ? 4 : 2
    SecNeg(authMode, deviceUuid = identity.androidIdAscii, phoneModel)
    kind := classifyHuaweiAuthType(authType)
      "hichain" | "hichain3" → HICHAIN
      "hichain_lite"         → existing Lite path (authVersion 2), else typed refusal
      null                   → fail HUAWEI_AUTH_NEGOTIATION_FAILED
  else → NORMAL (existing)

HICHAIN
  token := hichainStore.getAuthToken(deviceId)
  if token == null:                                  // "first connection"
    BIND_PIN:     pin := PinCode request (watchdog default)
    BIND_CONFIRM: onAuthPrompt("confirm_on_watch"); op1 step1 (watchdog 30 s)
    BIND_STEPS:   op1 steps 2-4 → hichainStore.setAuthToken(deviceId, authToken)
    token := authToken
  AUTH: op2 steps 1, 2, 4 (step-1 watchdog 5 s; consider 10 s for BR latency)
    on TOKEN_MISMATCH / REJECTED with a stored (not fresh) token:
      hichainStore.clearAuthToken(deviceId); throw HUAWEI_HICHAIN_REBIND_REQUIRED
  this.secretKey := packetKey (32 B); this.encryptionCounter := 0
  this.randomIv := (dst == 4)
SYNC (existing; encrypt with AES-256, IV random when dst == 4)
```

Notes on the state machine:

- **Bind trigger.** We use "no stored `authToken`" in place of upstream's UI-driven `firstConnection` (§1.5). That is functionally the same, and it also avoids upstream's null `authkey` NPE.
- **No silent re-bind.** We do not re-bind silently on a background sync, because that would pop a prompt on the watch unannounced. Instead, surface `HUAWEI_HICHAIN_REBIND_REQUIRED`. A user-initiated "Sync now" may retry once with a bind.
- **Request flags.** `request()` must pass `{ encrypted: false }` for `0x2C`, `0x33` and `0x28`. Set the packet key only after op 2.
- **Stage.** Add a `"pairing"` stage (`HuaweiFailure`) so `onFailure` distinguishes confirm-timeouts from sync failures.

### 7.4 Storage

`HuaweiSecretKeyStore` is a synchronous `get/set(deviceId)` holding the normal-mode local key, with only a memory default (`ours/protocol/huawei.ts:658-684`). Do **not** reuse its slot for `authToken`. Upstream's sharing of `"authkey"` across modes is a known foot-gun (§3.6).

Add a `HuaweiHiChainStore` with the same sync style:

```ts
type HuaweiHiChainStore = Readonly<{
  getAndroidId(deviceId: string): string | null;
  setAndroidId(deviceId: string, id: string): void;
  getAuthToken(deviceId: string): Uint8Array | null;
  setAuthToken(deviceId: string, t: Uint8Array): void;
  clear(deviceId: string): void;
}>;
```

- **Backing.** Use `expo-secure-store`'s synchronous `getItem`/`setItem` (`expo-secure-store@57`, `SecureStore.ts:193`, `:214`); the app already uses it (`apps/native/lib/auth-session-storage.ts`).
- **Key names.** Use `huawei.hichain.<sanitized deviceId>.androidId` and `….authToken`. SecureStore keys allow `[A-Za-z0-9._-]`.
- **`androidId`.** Generate it once per device as uppercase hex of 16 CSPRNG bytes, and keep it across re-binds. The watch's group entry is keyed by it.
- **Forget device.** "Forget device" must call `clear`.
- **Wiring.** Thread the store through `HuaweiSessionOptions` and `runHuaweiBrSync` (`ours/transport/huawei-rfcomm.ts:130-137`). Today it passes no stores, so it gets the memory defaults.

### 7.5 UX

- Add `onAuthPrompt?: (prompt: "confirm_on_watch") => void` to `HuaweiSessionOptions`. Fire it immediately before op-1 step 1.
- In the setup/sync UI, show: "Confirm the pairing on your watch. You have 30 seconds." Show a countdown, and clear it on success or failure.
- New messages in `components/direct-device-settings.tsx`, next to the existing `HUAWEI_AUTH_UNSUPPORTED` copy (`:685-686`):
  - `HUAWEI_HICHAIN_CONFIRM_TIMEOUT`: "The watch did not confirm in time. Unlock it, keep it near the phone, sync again and tap Confirm on the watch."
  - `HUAWEI_HICHAIN_REJECTED` and `HUAWEI_HICHAIN_TOKEN_MISMATCH`: "The watch rejected pairing. If it is paired with the Huawei Health app or another phone, unpair or reset it first."
  - `HUAWEI_HICHAIN_REBIND_REQUIRED`: "The watch no longer recognises this phone. Tap Sync now to pair again (you will confirm on the watch)."
  - `HUAWEI_AUTH_NEGOTIATION_FAILED`.
- Narrow `HUAWEI_AUTH_UNSUPPORTED` to `honor_pake`. Also narrow `hichain_lite_pincode` until the follow-on in §7.7.

### 7.6 Test strategy

1. **Known-answer tests** for `crypto/huawei-hichain.ts` and the PIN decrypt, from the §6.2 and §6.4 tables. They must use the Node-backed providers already in `transport/huawei.test.ts:58-110`, extended with GCM+AAD and AES-256.
2. **Codec tests** for `protocol/huawei-hichain.ts`:
   - the exact op-1 step-1 JSON string and TLV head and tail (§6.3);
   - op-2 `message` values `0x11`, `0x12`, `0x13` and `isDeviceLevel` placement;
   - SecurityNegotiation frames (§6.1);
   - `classifyHuaweiAuthType` over the §1.4 table;
   - response parsing: each routing key, `errorCode`, a missing `0x04`, and a missing `peerUserType`.
3. **Synthesized watch.** Write a `hichainPeer({ pin, authIdPeer, authToken, random })` helper for the `fakeDevice` responder pattern (`transport/huawei.test.ts:112-187`, `:215-268`). For each `0x28` request it:
   - parses the JSON;
   - computes `psk` from its own `pin`/`authToken`;
   - answers with the step-1 `token` (and verifies the phone's `selfToken`), then `returnCodeMac`, then `encAuthToken`, then a `04 01 01` final.

   Because the peer reuses our crypto module, also pin one full run to the §6.4 hex by injecting fixed randoms, so a symmetric bug cannot pass.

4. **Session scenarios**, using fake timers (`HuaweiTimers`):
   - first bind: PIN request, then op 1, then op 2. Assert `authToken` is persisted and the `0x07` requests decrypt with AES-256 and the §6.4 packet key;
   - reconnect with a stored token: no `0x2C`, op 2 only;
   - wrong PIN, then `TOKEN_MISMATCH`;
   - no step-1 answer, then `HICHAIN_CONFIRM_TIMEOUT` at 30 s and `onAuthPrompt` fired once;
   - stale token, then `REBIND_REQUIRED` and the store cleared;
   - `dst 4`: `authMode 4` tags, GCM, random IVs (no counter suffix);
   - `dst 2` with `authType 0x0186A0`: the HiChain path, no longer a refusal (update `transport/huawei.test.ts:388-433`);
   - BR over a chunked `rfcommLink` (`transport/huawei.test.ts:481-512`), with 3-slice requests and sliced responses;
   - crypt-off model: HiChain runs, then `0x07` goes in the clear.
5. **Hardware probe.** Before enabling the path, the probe mode from the parent spec's P0 should log `deviceSupportType`, `authType`, `authVersion` and `encryptMethod` per model.

### 7.7 Cheap follow-on: HiChainLite with a PIN

`GetPincodeRequest` also unlocks `hichain_lite_pincode` (`SP:747-753`):

- The digest key is `pinCode` (`GAR:70-74`), used through `computeDigestHiChainLite` (`Cry:132-153`).
- The digest key bytes are `SHA(utf8(hexUpper(pin)))` XORed into the digest secret.
- When `authAlgo == 1` it uses PBKDF2-SHA256 with 1000 iterations and 256 bits over the hex strings. `pbkdf2Sync` is available.

This is separate work, but it shares §7.2's PIN code.

**Status (2026-11-14): implemented.** Details read from source while porting:

- `initializeDeviceHiChainLiteMode` fetches the PIN when `pinCode == null & authVersion != 2`, with no `authMode` check (`SP:747-753`). So a type-4 watch on HiChainLite (`authMode` 4) also fetches it, but `GetAuthRequest` only uses it as the key when `authMode == 2` (`GAR:70-74`); with `authMode` 4 the digest is normal mode. Ours mirrors both.
- `computeDigestHiChainLite(message, key, nonce)` (`Cry:132-153`): `hashKey = SHA(UTF-8(hex(pin)))`; `secret = digestSecret(authVersion) XOR hashKey[0..16)`; `m = secret ‖ message` (18 bytes); `step1 = authAlgo == 1 ? PBKDF2-HMAC-SHA256(password = hex(m), salt = UTF-8(hex(nonce)), 1000, 256 bits) : HMAC(m, nonce)`; result `HMAC(step1, nonce) ‖ step1`. `CU:152-156` builds the `PBEKeySpec` from `hex(m).toCharArray()`; the hex is ASCII, so the char-to-byte encoding cannot matter.
- In auth mode 2, `digestChallenge` always uses `MESSAGE_CHALLENGE` (`01 00`), never the v4 one (`Cry:155-177`).
- The bond uses `firstKey = digest[0x20..0x30)` (`GAR:83-85`, `ByteBuffer.get` continues after the challenge), which is `step1[0..16)`. `GetBondRequest` picks it when `authMode == 2`, else the MAC key; `GetBondParamsRequest` stops on status 1 only when `authMode != 2` (`requests/GetBondRequest.java:54-58`, `requests/GetBondParamsRequest.java:58-62`). Ours now branches on `authMode` the same way.
- No timeout and no user step: the PIN request has none (`GPR:31-35`), and nothing is shown on the watch for it.

Vectors (ours, computed with Node `createHmac`/`pbkdf2Sync` from the lines above): PIN ASCII `"12345678"`, nonce `10…1F ‖ 20…2F`, in `crypto/huawei-auth.test.ts` and `protocol/huawei.test.ts`.

### 7.8 Follow-on: a silent watch on op 2 (2026-11-14)

Upstream, an op-2 step 1 with no reply in 5 s hits `configureReq.timeout` (`SP:685-694`): it reports a pairing error and sets `WAITING_FOR_RECONNECT`. The reconnect runs op 2 again (`firstConnection` is still false), so a watch that was factory-reset and dropped our group entry loops until the user re-pairs from the UI (`BRS:74-77` sets `firstConnection`). Upstream does not distinguish "slow" from "forgot us".

Ours, in `HuaweiSession.hichain()`:

1. A stored token runs op 2. If step 1 gets no answer in 10 s (§7.3), op 2 runs once more with fresh randoms, a fresh `requestId` and a 20 s wait (`HUAWEI_HICHAIN_AUTH_ATTEMPTS = 2`). A slow watch therefore never re-confirms on one timeout.
2. A rejection or a token mismatch is still `HUAWEI_HICHAIN_REBIND_REQUIRED` (the token is cleared).
3. Two silent attempts, and no late reply proved the token (below): if the caller passed `onAuthPrompt`, the session fetches the PIN, binds (op 1 with the "confirm on your watch" prompt), then authenticates with the new token, all in the same sync. Both production callers are user-started syncs from the device sheet and pass it (`ours/setup/controller.ts`).
4. The stored token is replaced only by a successful bind. A PIN request that times out, a bind the user does not confirm, or a failed bind leaves it in place.
5. Without `onAuthPrompt`, or when a late reply proved the token, it fails with `HUAWEI_HICHAIN_AUTH_TIMEOUT` and keeps the token.

**Late replies.** A reply to an abandoned step 1 may arrive while a later request on the same `0x01/0x28` waits. Upstream's response JSON is not known to echo `requestId` (`DC:1534-1545` reads only `payload` and `errorCode`), so the session drops any step-1 reply whose token verifies against an abandoned attempt's `psk`/`randSelf`; that cannot match the current attempt except by an HMAC collision. Such a reply proves the watch still holds our token, so it also rules out the re-bind. **UNKNOWN:** whether a reset watch answers a stale op 2 late with an `errorCode`. Such a reply cannot be told apart: during the retry it surfaces as `HUAWEI_HICHAIN_REJECTED` (a watch that rejects one attempt rejects both, so `REBIND_REQUIRED` is still right); during the bind it surfaces as `REJECTED` and the old token stays.

## 8. Uncertainties

1. **Real `deviceSupportType`/`authType` per model.** There is no source evidence for which of the 41 BR models land here. That needs the probe.
2. **Where the confirmation happens.** It is INFERRED that the on-watch prompt is triggered by op-1 step 1. The only evidence is the comment and the 30 s timeout on that request (`GHR:56-66`). It is unknown whether the PIN is ever displayed, and whether the watch must first be unpaired or reset from Huawei Health. DeviceStatus values outside −1/0/1 go to an unimplemented path (`SP:563-565`).
3. **PIN plaintext format and IV length.** Neither matters to the algorithm, which hexes the bytes, but both are unknown.
4. **`authToken` length.** The vectors assume 32 bytes. HMAC accepts any length, so only storage validation cares. Do not assert 32.
5. **Content of the watch's step-4 response.** Upstream only checks that tag `0x04 ≠ 0` and never verifies `data`. We should log it, not check it.
6. **JSON strictness on the watch.** It is unknown whether firmware is sensitive to key order, whitespace, `requestId` as a string versus a number, or Android's `\/` escaping (no `/` occurs in our values). Emit exactly the §6.3 form.
7. **`firstConnection` lifetime in GB.** It is INFERRED to be per support instance (§1.5). We replace it with stored-token presence, which is a deliberate deviation.
8. **AES-256 after HiChain.** This follows from a 32-byte `SecretKeySpec` (`TLV:391-417`) and is certain for upstream's code. That watches accept it is only implied by upstream shipping this path.
9. **Watch-initiated HiChain.** `HiChain.OutgoingRequest` parses watch-sent `0x01/0x28` steps (`DC:1548-1687`, `Pkt:858-859`). It is unclear when the watch drives the exchange; it is not part of GB's auth chain. If an unsolicited `0x28` arrives during our exchange, it will not match a pending request and is dropped.
10. **No upstream tests.** Every vector here is self-computed (§6.4), so a misreading of upstream would be mirrored in both the code and the tests. Mitigate this with a hardware capture on one device before broad enablement.
11. **Signedness and the error tag.** Java reads `authType` from tags `0x02`/`0x7F` as a signed byte, while ours is unsigned. Tag `0x7F` normally holds a 4-byte error code, of which only the first byte is used. Both differences are harmless for the branch values.
