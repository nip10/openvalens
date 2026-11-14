# Honor PAKE/STS authentication (Honor Watch 5, 5 Pro, 6)

Byte-level spec of the Honor **PSK-SPEKE PAKE bind** and **STS reconnect** as Gadgetbridge implements it, written so we can port it into `HuaweiSession`. Scope: models whose coordinator returns `supportsHiChainPake() == true`. Everything else (normal mode, HiChainLite, classic HiChain) is in `huawei-hichain-auth.md` and the parent `bluetooth-classic-rfcomm.md`.

Before this port, our session refused these models with `HuaweiUnsupportedAuthError("honor_pake")` (`ours/transport/huawei-rfcomm.ts:94`).

## 0. Sources and citation keys

Upstream is Gadgetbridge (AGPL-3.0-or-later), pinned at commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. Raw files: `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/<main|test>/java/nodomain/freeyourgadget/gadgetbridge/<path>`. Line numbers below are at the pin.

| Key    | Upstream path (under `…/gadgetbridge/`)                                    |
| ------ | -------------------------------------------------------------------------- |
| `GHPR` | `service/devices/huawei/requests/GetHiChainPakeRequest.java`               |
| `HPU`  | `service/devices/huawei/HiChainPakeUtils.java`                             |
| `THPU` | `service/devices/huawei/TestHiChainPakeUtils.java` (under `app/src/test/`) |
| `GSNR` | `service/devices/huawei/requests/GetSecurityNegotiationRequest.java`       |
| `SP`   | `service/devices/huawei/HuaweiSupportProvider.java`                        |
| `DC`   | `devices/huawei/packets/DeviceConfig.java`                                 |
| `TLV`  | `devices/huawei/HuaweiTLV.java`                                            |
| `CU`   | `util/CryptoUtils.java`                                                    |
| `HCo`  | `devices/huawei/HuaweiCoordinator.java`                                    |
| `HW5`  | `devices/huawei/honorwatch5/HonorWatch5Coordinator.java`                   |
| `HW5P` | `devices/huawei/honorwatch5pro/HonorWatch5ProCoordinator.java`             |
| `HW6`  | `devices/huawei/honorwatch6/HonorWatch6Coordinator.java`                   |

`ours/` means `apps/native/lib/direct-devices/`.

Upstream's own sources name their origins: the PAKE/STS mechanics "follow the open-source OpenHarmony HiChain implementation (base/security/device_auth)", and "the Honor-specific MBB wire framing of the 0x28 packet was derived from a pairing capture" (`GHPR:40-42`). The `PAKE_PROTOCOL.md` the comments cite is **not** in the repository at the pin; I could not read it.

Conventions: "hex" is `StringUtils.bytesToHex` (uppercase, no separators); "lowerhex" is `HPU.toLowerHex`; "unhex" is case-insensitive `GB.hexStringToByteArray`. X25519 and Ed25519 values are little-endian byte strings as on the wire (RFC 7748, RFC 8032). `‖` is concatenation.

## 1. Which models, and the gate

- `supportsHiChainPake()` is `false` by default (`HCo:93-101`) and `true` for Honor Watch 5, 5 Pro and 6 (`HW5:35-38`, `HW5P:35-38`, `HW6:35-38`). The same three coordinators return `isTransactionCrypted() == false` (`HW5:30-33`, `HW5P:30-33`, `HW6:30-33`). All three extend `HonorBRCoordinator`, so they are Bluetooth Classic only.
- The gate sits after SecurityNegotiation: when `isHiChain()` (`deviceSupportType` 1-4), `initializeDeviceDealHiChain` sends `0x01/0x33` and then branches on `supportsHiChainPake()` **before** reading `authType` (`SP:608-628`). A PAKE model therefore never reaches classic HiChain or HiChainLite. With `deviceSupportType` 0 it would still run normal mode (`SP:629-631`). **INFERRED:** the real watches report a HiChain support type, otherwise upstream's PAKE code would be dead.
- `finalizeSecurityNegotiationPake` reads `honorPairType` (tag `0x02` of the response): `2` runs the STS reconnect, anything else (including `1`, FIRST_PAIR, and `-1`, absent) runs a full PAKE bind (`SP:639-656`). `authType` is ignored on purpose (`SP:646-648`).

## 2. SecurityNegotiation, PAKE form (`0x01/0x33`)

Request (`GSNR:47-61`, `DC:1880-1904`), unencrypted, TLV in this order:

| Tag    | Value                                                                   |
| ------ | ----------------------------------------------------------------------- |
| `0x01` | `authMode` byte: 4 when `deviceSupportType == 4`, else 2 (`SP:612-615`) |
| `0x02` | `pairType`: 2 if we hold a stored peer authId, else 1 (`GSNR:55`)       |
| `0x03` | `androidId` as 32 UTF-8 bytes (`SP:939-941`)                            |

There is no `0x05` UUID, no `0x03 01`/`0x04 00`, and no `0x0D`. Response parsing is shared with the classic form (`DC:1922-1945`): `honorPairType := tag 0x02` (signed byte), `responseNonce := tag 0x03`. The nonce is kept but never used (`GHPR:84-85`, `SP:728`).

## 3. Wire framing on `0x01/0x28` (Honor "MBB")

Requests are sliced and unencrypted (`GHPR:174-183`, `:214-223`). TLV:

| Tag    | Value                                                     |
| ------ | --------------------------------------------------------- |
| `0x01` | `dataType` byte: `0x01` X25519 exchange, `0x02` PAKE JSON |
| `0x02` | the raw 32-byte public key, or the JSON as UTF-8          |

Responses (`DC:1441-1473`): if tag `0x04` is present, it is classic HiChain framing (not used by these watches). Otherwise `dataType := tag 0x01`:

- `0x01`: X25519 exchange; `publicKey := tag 0x02` (`DC:1387-1400`).
- `0x02`: PAKE JSON in tag `0x02`, routed by `parsePakeJsonPayload` (`DC:1504-1531`).
- `0x03`: "device identity string in tag 0x02 (e.g. serial;mac;name); not consumed yet" (`DC:1467-1470`); it sets `step = 4`, which no branch of `GHPR.processResponse` handles.

JSON envelope (`GHPR:139-187`): `{ ["authForm":0,] "message": <id>, "payload": { … } }`, Android `org.json`, insertion order, no whitespace. `authForm` is present only on the STS messages (`GHPR:150-153`, `:190`, `:433`). The **first** message of a flow appends to the payload, after its own fields, `"version":{"minVersion":"1.0.0","currentVersion":"2.0.15"}` (note: 2.0.15, classic HiChain sends 2.0.16) and then `"operationCode":<1|2>` as a number (`GHPR:158-164`).

Response envelope (`DC:1534-1546`): `payload` is required; `payload.errorCode` (int), when non-zero, fails the request (`GHPR:293-295`). Routing (`DC:1504-1531`):

| Condition (in order)                      | Step                       |
| ----------------------------------------- | -------------------------- |
| `message == 32785`                        | STS start (`0x11`)         |
| `message == 32786`                        | STS ack (`0x13`)           |
| payload has `challenge`, `salt` and `epk` | PAKE response (`0x01`)     |
| payload has `kcfData`                     | PAKE confirm (`0x02`)      |
| payload has `exAuthInfo`                  | exchange response (`0x03`) |
| otherwise                                 | step stays 0 (see §7)      |

Message ids are OpenHarmony device_auth codes (`GHPR:64-69`): requests 1, 2, 3 (bind) and 17, 18 (STS); responses are the request id `| 0x8000` (32769-32771, 32785, 32786).

## 4. Crypto primitives (`HPU`)

All HKDFs are `CU.hkdfSha256(ikm, salt, info, L)` (RFC 5869, `CU:124-150`). HMAC is HMAC-SHA256.

| Name                                                                          | Definition                                                                                                                                                                               | Cite                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `x25519(k, u)`                                                                | RFC 7748: clamp `k`, mask the top bit of `u`, Montgomery ladder, little-endian out. `u` shorter than 32 bytes is zero-padded (`{9}` is the base point). No check for an all-zero result. | `HPU:450-508`             |
| `derivePin(shared)`                                                           | hex of `shared[0..6)` (12 uppercase chars)                                                                                                                                               | `HPU:518-535`             |
| `derivePasswordKey(pin, salt)`                                                | `HKDF(ISO-8859-1(pin), salt, "hichain_speke_base_info", 32)`                                                                                                                             | `HPU:340-348`             |
| `hashToCurve25519(s)`                                                         | Elligator2, §4.1                                                                                                                                                                         | `HPU:539-590`             |
| `computeSharedBase(pk)` (EC)                                                  | `hashToCurve25519(pk)`                                                                                                                                                                   | `HPU:159-166`             |
| `computePublicParameter(base, a)` (EC)                                        | `x25519(a, base)`                                                                                                                                                                        | `HPU:171-178`             |
| `computeSharedSecret(B, a)` (EC)                                              | `x25519(a, B)`                                                                                                                                                                           | `HPU:183-191`             |
| `deriveSessionKeys(K, salt)`                                                  | `t = HKDF(K, salt, "hichain_speke_sessionkey_info", 48)`; `sessionKey = t[0..16)`; `kcfKey = t[16..48)` (EC) or `t[16..32)` (DL)                                                         | `HPU:205-217`             |
| `generateProof(kcf, c1, c2)`                                                  | `HMAC(kcf, c1 ‖ c2)`                                                                                                                                                                     | `HPU:223-229`             |
| `verifyProof(kcf, c1, c2, p)`                                                 | constant-time `p == HMAC(kcf, c1 ‖ c2)`                                                                                                                                                  | `HPU:235-240`             |
| `encryptAesGcm(pt, key, aad)`                                                 | `iv12 ‖ AES-GCM(key, iv12, aad, pt)` (16-byte tag); the key is the 16-byte `sessionKey`, so AES-128                                                                                      | `HPU:358-369`             |
| `decryptAesGcm(ct, key, aad)`                                                 | inverse; input `≤ 12` bytes returns an empty array                                                                                                                                       | `HPU:375-389`             |
| `ed25519PublicKey(seed)`, `ed25519Sign(seed, m)`, `ed25519Verify(m, sig, pk)` | RFC 8032 PureEdDSA. Verify rejects `s ≥ L`, `y ≥ p` and non-decompressible points; the check is cofactorless `sB == R + kA`.                                                             | `HPU:592-664`, `:669-698` |
| `ed25519PrivateToX25519(seed)`                                                | `clamp(SHA-512(seed)[0..32))`                                                                                                                                                            | `HPU:280-291`             |
| `ed25519PublicToX25519(pk)`                                                   | drop the sign bit, `u = (1+y)/(1−y) mod p`, 32 bytes LE; no point validation                                                                                                             | `HPU:293-305`             |
| `computeStsPsk(seed, peerPk)`                                                 | `x25519(ed25519PrivateToX25519(seed), ed25519PublicToX25519(peerPk))`                                                                                                                    | `HPU:307-313`             |
| `deriveStsPin(psk, nonce)`                                                    | lowerhex of `HKDF(psk, nonce, "hichain_tmp_auth_enc_key", 32)` (64 chars)                                                                                                                | `HPU:315-333`, `:262-265` |

Constants (`HPU:60-70`): `"hichain_speke_base_info"`, `"hichain_speke_sessionkey_info"`, `"hichain_tmp_auth_enc_key"`, `"hichain_exchange_request"`, `"hichain_exchange_response"`. `"hichain_return_key"` and `"hichain_auth_info"` are declared but unused by this flow (`HPU:63`, `:66`, `:246-249`).

**Algorithm.** `determineAlgorithm(true, …)` is the only call (`GHPR:322`, `:481`), so EC-SPEKE over Curve25519 with a 32-byte private parameter is the only mode reached. The DL-SPEKE branches (Oakley groups 14 and 15, `HPU:72-103`, `:125-191`) are dead code for these watches.

### 4.1 Elligator2 (`hashToCurve25519`, `HPU:539-581`)

With `p = 2^255 − 19`, `A = 486662`, non-square `u = 2`:

```
h := first 32 bytes of the input (zero-padded); h[31] &= 0x3F
r := little-endian integer of h
b := −A · (1 + 2·r²)^−1  mod p
a := b³ + A·b² + b       mod p
x := b             if a == 0 or a^((p−1)/2) == 1
     (−b − A) mod p otherwise
be  := minimal big-endian bytes of x (OpenSSL BN_bn2bin; x == 0 gives one 00 byte)
buf := 32 zero bytes; buf[0..len(be)) := be     ← left-aligned, NOT left-padded
out := reverse(buf)
```

The left alignment is deliberate: upstream says it replicates the OpenHarmony reference "including its non-left-padded byte placement for x < 2^248" (`HPU:552-553`). For `x ≥ 2^248` (the usual case) it is the ordinary 32-byte little-endian encoding; for smaller `x` the result is **not** `x` in little-endian. Upstream validated five inputs against that C code (`THPU:40-62`); we use them as known answers.

## 5. Bind: PSK-SPEKE (operation code 1)

Identities, persisted per watch:

- `androidId`: the same 32-char uppercase hex id classic HiChain uses (`SP:926-941`). `authId := UTF-8(androidId)`.
- `seed`: a 32-byte Ed25519 seed, generated once (two 16-byte `SecureRandom` nonces) and kept, so the watch keeps trusting our key (`SP:943-957`).
- Peer identity, saved at the end of the bind: watch `authId` and Ed25519 `authPk` (`SP:959-984`).

Sequence (`GHPR:189-286` builds, `:288-428` parses; random sizes from the code):

| #   | Dir | Content                                                                                 | Computation                                                                                                                                                                                                                                                                                                         |
| --- | --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | →   | `01:01`, `02: devPub`                                                                   | `devPriv := rand(32)`, `devPub := x25519(devPriv, 9)` (`GHPR:208-224`)                                                                                                                                                                                                                                              |
| 0   | ←   | `01:01`, `02: watchPub`                                                                 | `pin := derivePin(x25519(devPriv, watchPub))` (`GHPR:300-310`)                                                                                                                                                                                                                                                      |
| 1   | →   | msg 1 `{"support256mod":true,"serviceType":"WEAR_MBB","version":{…},"operationCode":1}` | (`GHPR:226-231`)                                                                                                                                                                                                                                                                                                    |
| 1   | ←   | msg 32769 `{challenge, salt, epk}`                                                      | `pk := derivePasswordKey(pin, salt)`; `g := hashToCurve25519(pk)`; `selfChallenge := rand(16)`; `a := rand(32)`; `selfEpk := x25519(a, g)` (`GHPR:312-339`)                                                                                                                                                         |
| 2   | →   | msg 2 `{"challenge":hex(selfChallenge),"epk":hex(selfEpk),"kcfData":hex(proof)}`        | `K := x25519(a, peerEpk)`; `(sessionKey, kcfKey) := deriveSessionKeys(K, salt)`; `proof := HMAC(kcfKey, selfChallenge ‖ peerChallenge)` (`GHPR:233-254`)                                                                                                                                                            |
| 2   | ←   | msg 32770 `{kcfData}`                                                                   | check `kcfData == HMAC(kcfKey, peerChallenge ‖ selfChallenge)` (`GHPR:341-360`)                                                                                                                                                                                                                                     |
| 3   | →   | msg 3 `{"exAuthInfo":hex(…)}`                                                           | `info := {"authId":hex(authId),"authPk":hex(edPub)}` (UTF-8); `sig := ed25519Sign(seed, SHA-256(selfChallenge ‖ peerChallenge ‖ info))`; `exAuthInfo := encryptAesGcm(info ‖ sig, sessionKey, "hichain_exchange_request")` (`GHPR:256-279`)                                                                         |
| 3   | ←   | msg 32771 `{exAuthInfo}`                                                                | `pt := decryptAesGcm(…, sessionKey, "hichain_exchange_response")`, require `len(pt) > 64`; `peerInfo := pt[0..len−64)`, `peerSig := last 64`; JSON `authId`, `authPk` (unhex); verify `ed25519Verify(SHA-256(peerChallenge ‖ selfChallenge ‖ peerInfo), peerSig, authPk)`; save `(authId, authPk)` (`GHPR:362-399`) |

Notes:

- `hex(authId)` is the hex of the 32 ASCII bytes (64 chars), not the 32-char id itself, the same convention as classic HiChain's `peerAuthId`.
- The signature is Ed25519 over a **SHA-256 digest**, not over the message: "The Honor secure element pre-hashes the message with SHA-256 before signing" (`HPU:597-599`).
- The challenge order flips for the peer: ours is `self ‖ peer`, the watch's is `peer ‖ self` from our point of view (`GHPR:355-358`, `:383-388`).
- The PIN is derived from an anonymous X25519 exchange, so **the user enters nothing**; upstream calls the re-bind "PIN-less, DH-derived" and "seamless" (`SP:645-646`, `GHPR:105-106`). **UNKNOWN:** whether the watch asks the user to confirm. Upstream sets a 30 s timeout "for both paths" because "the watch may interleave an async PermissionCheck round-trip before replying" (`GHPR:114-116`).
- The bind produces no packet key. These models do not encrypt transactions (§1), and upstream only creates a random local key to open its async-packet gate (`SP:781-789`). No `"hichain_return_key"` derivation runs.

## 6. Reconnect: STS (operation code 2)

Runs when the watch answers `honorPairType == 2`, which happens when we asked for it (we hold a peer identity, §2) and the watch still trusts us (`SP:639-656`, `GSNR:48-55`).

| #   | Dir | Content                                                                                                                                                                         | Computation                                                                                                                                                                                                              |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | →   | msg 17, with `authForm:0`: `{"challenge":hex(c),"epk":hex(e),"serviceType":"WEAR_MBB","peerAuthId":hex(authId),"keyLength":32,"keyInfoSize":0,"version":{…},"operationCode":2}` | `c := rand(16)`; `e := x25519(rand(32), 9)`; neither is used again ("cosmetic", `GHPR:91-95`, `:435-450`)                                                                                                                |
| 1   | ←   | msg 32785 `{challenge, epk, salt, nonce[, peerAuthId]}`                                                                                                                         | `psk := computeStsPsk(seed, storedPeerPk)`; `pin := deriveStsPin(psk, nonce)`; then exactly the bind's steps 1-2 computation with this `pin`: fresh `selfChallenge`, `a`, `selfEpk`, `K`, keys, `proof` (`GHPR:452-505`) |
| 2   | →   | msg 18, with `authForm:0`: `{"challenge":hex(selfChallenge),"epk":hex(selfEpk),"kcfData":hex(proof)}`                                                                           | (`GHPR:199-206`)                                                                                                                                                                                                         |
| 2   | ←   | msg 32786 `{kcfData}`                                                                                                                                                           | check `kcfData == HMAC(kcfKey, peerChallenge ‖ selfChallenge)`; done (`GHPR:407-421`)                                                                                                                                    |

The STS PIN is the **lowercase** 64-char hex, fed through the same `derivePasswordKey` as the bind's uppercase 12-char PIN (`HPU:315-323`). There is no exchange step and no new identity. The optional `peerAuthId` in 32785 is parsed but not checked (`DC:1346-1364`).

## 7. Errors and timeouts

| Situation                                             | Upstream                                                                               | Cite                                   | Ours                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Any response's `payload.errorCode != 0`               | `ResponseParseException`, `configureReq.handleException`: pairing error and disconnect | `GHPR:293-295`, `SP:696-705`           | bind: `HUAWEI_PAKE_REJECTED`; STS: forget the peer identity, `HUAWEI_PAKE_REBIND_REQUIRED` |
| Bind proof or signature mismatch, GCM tag failure     | same                                                                                   | `GHPR:349-352`, `:390-393`             | `HUAWEI_PAKE_FAILED`                                                                       |
| STS proof mismatch                                    | same                                                                                   | `GHPR:416-419`                         | forget the peer identity, `HUAWEI_PAKE_REBIND_REQUIRED`                                    |
| STS with no stored peer key                           | `ResponseParseException("…must be re-paired")`                                         | `GHPR:466-470`                         | `HUAWEI_PAKE_REBIND_REQUIRED`                                                              |
| Wrong/missing fields, unknown routing                 | step stays 0 and **re-sends step 0** (a fresh DH exchange)                             | `DC:1504-1531`, `GHPR:296`, `:300-303` | `HUAWEI_PAKE_PROTOCOL` (no loop)                                                           |
| `dataType 0x03` (device identity) in place of a reply | step 4: no branch, so the chain finalizes as if done                                   | `DC:1467-1470`, `GHPR:299-422`         | skipped; keep waiting for the real reply (deviation, §9)                                   |
| First request unanswered                              | 30 s, `configureReq.timeout`: `WAITING_FOR_RECONNECT`                                  | `GHPR:98-116`, `SP:685-694`            | 30 s watchdog, `HUAWEI_REQUEST_TIMEOUT`                                                    |
| Later steps unanswered                                | no timeout (the copy constructor sets none)                                            | `GHPR:121-138`                         | session watchdog (30 s)                                                                    |

After a failed STS, upstream keeps the stored peer identity, so the next connection asks for `pairType 2` again; the watch "downgrades us to FIRST_PAIR if it has not persisted our trust" (`SP:643-646`). Ours forgets it on an STS failure so the next sync binds, which needs no user input (§5).

## 8. Implementation plan (our codebase)

**Crypto.** `apps/native` had SHA-256/HMAC/AES (`react-native-quick-crypto`) and our own HKDF (`ours/crypto/huawei-auth.ts`), but no Curve25519 or Ed25519 in pure JS. We add `@noble/curves@2.4.0` (MIT; audited; pure JS on `BigInt`) for X25519 (`x25519.scalarMult`), Ed25519 (`ed25519.getPublicKey/sign/verify`) and the Ed25519-secret-to-X25519 map (`ed25519.utils.toMontgomerySecret`, the same clamp of SHA-512). Elligator2 (§4.1) and the Ed25519-public-to-X25519 map are ported by hand on `BigInt`: the first has a non-standard byte placement, and noble's `toMontgomery` validates the point where upstream does not.

**Modules.**

- `ours/protocol/huawei-pake.ts` (pure): the §4 primitives, the §2 request, the §3 codec (`buildHuaweiPakeDhRequest`, `buildHuaweiPakeJsonRequest`, `parseHuaweiPakeResponse`), and the JSON builders in upstream key order.
- `ours/transport/huawei-pake.ts`: the bind and STS drivers over an injected `request(tlv)`, with injected randomness.
- `ours/transport/huawei.ts`: an `honorPake` session option. With a HiChain support type it sends the PAKE-form `0x33` and runs the drivers, then syncs in the clear.
- Storage: `HuaweiHiChainStore` gains the Ed25519 seed and the peer identity; the keystore purge on sign-out deletes them too.

## 9. Uncertainties

1. **No hardware, no upstream end-to-end vectors.** Upstream tests cover only Elligator2, X25519, `derivePin`, Ed25519 and the Ed25519-to-X25519 PSK agreement (`THPU`). Everything else (the JSON, the transcripts) is checked against our own reading of `GHPR`. The upstream comments say the framing came from a pairing capture, which we cannot see.
2. **The `PAKE_PROTOCOL.md` the comments cite is missing** at the pin. Its sections C1-C10 (capture analysis) are unknown to us.
3. **User confirmation.** Not in source. If the watch shows a prompt, it is not driven by anything we send differently.
4. **`dataType 0x03`.** When and why the watch sends the identity string is unknown. Upstream would end the flow early on it; we skip it.
5. **Verification strictness.** `@noble/curves` `ed25519.verify` with `zip215: false` follows RFC 8032 strictly but uses the cofactored equation; upstream is cofactorless. They differ only for crafted signatures with small-order components. `x25519` in noble throws on an all-zero result; upstream returns zeros.
6. **DL-SPEKE.** Unreachable upstream (§4), so not ported.
7. **`authMode` 4.** Upstream would send `0x01 04` for a `deviceSupportType` 4 Honor watch. Which value the three watches report is unknown.
