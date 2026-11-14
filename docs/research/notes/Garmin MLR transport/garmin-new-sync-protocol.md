# Garmin "new sync protocol": protobuf FileSync plus ML/MLR file transfer services

Checked: 2026-11-14. For issue #421. Companion to `garmin-mlr-transport.md` (same folder), which covers the ML and MLR transports this protocol runs on.

Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. Each file below was downloaded as raw bytes from `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/<sha>/<path>` and read directly. Nothing was built or run. Line numbers refer to that commit. Upstream is AGPL-3.0-or-later, and so is OpenValens.

Notation:

- **INFERRED** means I deduced it and did not read it in source.
- **UNKNOWN** means the source does not settle it.
- Everything else is read from the cited line.
- No byte sequence below is a hardware capture. Upstream has no recorded new-sync traces; the vectors are encoded from the `.proto` files by hand.

## 0. Path aliases used in citations

| Alias      | Path at the pin                                                       |
| ---------- | --------------------------------------------------------------------- |
| `G/`       | `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`             |
| `P/`       | `GBProtobufGenerator/src/main/proto/garmin/`                          |
| `Sup`      | `G/service/devices/garmin/GarminSupport.java`                         |
| `FileSync` | `G/service/devices/garmin/FileSyncServiceHandler.kt`                  |
| `Pbh`      | `G/service/devices/garmin/ProtocolBufferHandler.java`                 |
| `PbMsg`    | `G/service/devices/garmin/messages/ProtobufMessage.java`              |
| `PbStatus` | `G/service/devices/garmin/messages/status/ProtobufStatusMessage.java` |
| `Gfdi`     | `G/service/devices/garmin/messages/GFDIMessage.java`                  |
| `Fth`      | `G/service/devices/garmin/FileTransferHandler.java`                   |
| `FileType` | `G/service/devices/garmin/FileType.java`                              |
| `V2`       | `G/service/devices/garmin/communicator/v2/CommunicatorV2.java`        |
| `Zlib`     | `G/util/CompressionUtils.kt`                                          |
| `AU`       | `G/util/ArrayUtils.java`                                              |
| `FA`       | `P/gdi_file_access.proto`                                             |
| `DT`       | `P/gdi_data_types.proto`                                              |
| `Smart`    | `P/gdi_smart_proto.proto`                                             |
| `ours/`    | `apps/native/lib/direct-devices/` in this repo                        |

## 1. Short answer

1. The new sync protocol replaces the legacy GFDI directory listing and `DOWNLOAD_REQUEST`/`FILE_TRANSFER_DATA` chunks with three layers: protobuf `Smart.file_access_service` messages carried in GFDI `PROTOBUF_REQUEST` (5043) and `PROTOBUF_RESPONSE` (5044); a per-file ML service registration on one of six `FILE_TRANSFER_*` service ids; and a raw zlib stream on that service's handle, plain ML or MLR (`FileSync:118-215`, `Sup:2027-2213`, `V2:254-276`).
2. Upstream still downloads the legacy root directory first, "so that the watch flushes the data", and only then asks for the protobuf file list (`Sup:716-717`, `Fth:252-258`, `Sup:323-333`).
3. Everything needed to download, inflate and parse the files is in source. The downloaded bytes are ordinary FIT files (`Sup:2082-2125`), so our existing FIT decoders apply unchanged.
4. What source does not settle: real byte traces, whether the watch can close the transfer handle before MLR has delivered every data packet, and what the 3-byte first message on the transfer handle means. See section 9.
5. Upstream enables this only for the 5 models whose coordinators override `defaultNewSyncProtocol()` (see `garmin-mlr-transport.md` §6), and forces MLR on with it because "new sync protocol without MLR fails to sync large workouts" (`GarminCoordinator.java:127`).

## 2. Sequence

```
phone                                                   watch
  | (GFDI registered, DEVICE_INFORMATION / CONFIGURATION answered, SYNC_READY)
  |-- DOWNLOAD_REQUEST index 0 (legacy directory, "flush") ---->|   Sup:716-717, Fth:146-147
  |<- directory FILE_TRANSFER_DATA … (entries are ignored) ------|   Fth:254-258
  |-- PROTOBUF_REQUEST Smart{43: ItemListRequest} -------------->|   Sup:327-330, FileSync:178-197
  |<- PROTOBUF_* Smart{43: ItemListResponse{items, session_id?}} |   FileSync:118-176
  |   session_id present → PROTOBUF_REQUEST ItemListRequest{session_id} again
  | for each wanted item, one at a time:
  |-- PROTOBUF_REQUEST Smart{43: PullItemDataRequest{item}} ---->|   Sup:1256-1262, FileSync:199-215
  |<- PROTOBUF_* Smart{43: PullItemDataResponse{SUCCESS, transfer_handle}}   FileSync:102-116
  |-- ML 00 00 <client> 18 20 02  (REGISTER FILE_TRANSFER_2, reliable) ->|  V2:254-276, V2:677-685
  |<- ML 00 01 <client> 18 20 00 <h> <rel>  (grant) -------------|   V2:356-431
  |-- on h: 00 00 <transfer_handle u16 LE> 00 00 --------------->|   Sup:2038-2047
  |<- on h: 00 00 00   (first message) ---------------------------|   Sup:2197-2208
  |<- on h: zlib bytes … ------------------------------------------|   Sup:2209-2211
  |<- ML 00 03 <client> 18 20 <h> <status>  (CLOSE_HANDLE_RESP) --|   V2:433-469 → onClose
  |   inflate, parse FIT, then (unless keep-on-device):
  |-- PROTOBUF_REQUEST Smart{43: ModifyFlagsRequest{uid, set SYNCED}} ->|   Sup:2180-2186, FileSync:217-244
  |<- PROTOBUF_* Smart{43: ModifyFlagsResponse} (logged only) ----|   FileSync:72-76
  |-- SYSTEM_EVENT SYNC_COMPLETE ------------------------------->|   Sup:1327-1330
```

The watch may also send, at any time: `TransferStatusRequest` (answered, section 5.6), `ItemAddedNotification` (adds files to the queue), `ItemUpdatedNotification`, `ResourceUpdateNotification`, `SyncButtonNotification` (no reply; the last starts a sync) (`FileSync:32-100`).

Upstream drives the queue from `processDownloadQueue()`, which runs after every incoming GFDI message (`Sup:532`, `Sup:1200-1270`). Only one file is in flight (`currentlyDownloading`). INFERRED: nothing else advances the queue, so after a transfer closes the next file starts when the next GFDI message arrives, normally the `ModifyFlagsResponse`.

## 3. GFDI protobuf carriage

### 3.1 Message ids (`Gfdi:171-173`)

| Id   | Name                |
| ---- | ------------------- |
| 5043 | `PROTOBUF_REQUEST`  |
| 5044 | `PROTOBUF_RESPONSE` |
| 5045 | `CANCEL_PROTOBUF`   |

Both directions use both ids. The phone sends its own requests as 5043 (`Pbh:677-682`) and its replies to the watch as 5044 with the watch's request id (`Pbh:690-694`). Upstream handles an incoming 5043 and 5044 identically (`Gfdi:74-75`, `Pbh:110-117`).

### 3.2 Payload (`PbMsg:44-52`, `PbMsg:83-93`), little-endian

| Offset | Size | Field                                               |
| ------ | ---- | --------------------------------------------------- |
| 0      | 2    | request id                                          |
| 2      | 4    | data offset of this chunk within the whole protobuf |
| 6      | 4    | total protobuf length                               |
| 10     | 4    | this chunk's length                                 |
| 14     | n    | chunk bytes                                         |

Request ids are a 16-bit counter that starts at 1 for each session (`Pbh:104-107`). A message is complete when offset is 0 and chunk length equals total length (`PbMsg:74-80`).

### 3.3 Outgoing chunking (`Pbh:684-711`, `Pbh:779-789`)

- `maxChunkSize = maxPacketSize - 20` (18 bytes of GFDI header and 2 of CRC). `maxPacketSize` is `DEVICE_INFORMATION` offset 10 (`Sup:606-610`). Before that arrives, `maxChunkSize` is 375 (`Pbh:76`).
- A longer protobuf goes out as chunk 0 of `maxChunkSize` bytes. Each ACKed protobuf status for that request id (section 3.4) sends the next chunk at `statusOffset + maxChunkSize` (`Pbh:300-321`).
- The requests this protocol sends are far below 355 bytes (section 4 vectors), so they never chunk. INFERRED from the sizes.

### 3.4 Status replies (`PbStatus:62-73`, `PbStatus:91-102`)

A `RESPONSE` (5000) whose original type is 5043 or 5044 carries:

| Offset | Size | Field                                                                                                                                                                              |
| ------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | 2    | original message type                                                                                                                                                              |
| 2      | 1    | GFDI status (`0` ACK)                                                                                                                                                              |
| 3      | 2    | request id                                                                                                                                                                         |
| 5      | 4    | data offset                                                                                                                                                                        |
| 9      | 1    | chunk status: `0` KEPT, `1` DISCARDED                                                                                                                                              |
| 10     | 1    | status code: `0` NO_ERROR, `100` UNKNOWN_REQUEST_ID, `101` DUPLICATE_PACKET, `102` MISSING_PACKET, `103` EXCEEDED_TOTAL_PROTOBUF_LENGTH, `200` PROTOBUF_PARSE_ERROR, `201` UNKNOWN |

Which status the phone sends for an incoming protobuf (`PbMsg:29-33`, `Pbh:119-298`, `Sup:503`):

| Incoming                                                         | Status sent                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| a chunk of a longer message (offset ≠ 0 or chunk length ≠ total) | protobuf status ACK, KEPT, NO_ERROR (11 bytes)           |
| complete, handled, phone replies with a protobuf                 | generic status ACK (3 bytes, `buildGarminStatusPayload`) |
| complete, handled, no protobuf reply                             | protobuf status ACK, KEPT, NO_ERROR                      |
| complete, not handled by any service                             | protobuf status ACK, DISCARDED, UNKNOWN_REQUEST_ID       |

Order on the wire: the status first, then the protobuf reply if any (`Sup:495-514`).

### 3.5 Incoming reassembly (`Pbh:324-339`, `Pbh:756-795`)

- A chunk at offset 0 starts (or replaces) the buffer for its request id. A chunk at any other offset is appended only when it starts exactly at the bytes already held; upstream throws on a mismatch (`Pbh:772-776`).
- The message is complete once the held length equals the total length. It is then parsed as `Smart`.

## 4. Protobuf messages used

All are `proto2`. Only the fields this protocol touches are listed. Field numbers are from the cited lines.

### 4.1 Containers

- `Smart.file_access_service = 43` (`Smart:88`), type `FileAccess.Service`.
- `FileAccess.Service` (`FA:263-289`): `pull_item_request = 1`, `pull_item_response = 2`, `transfer_status_request = 5`, `item_list_request = 9`, `item_list_response = 10`, `item_added_notification = 12`, `modify_flags_request = 15`, `modify_flags_response = 16`, `item_updated_notification = 17`, `resource_update_notification = 20`, `transfer_status_response = 21`, `sync_button_notification = 22`. `FileSync.handle` dispatches on the first present of: 12, 10, 2, 16, 5, 17, 22, 20 (`FileSync:32-47`).
- `DataTypes.UUID` (`DT:140-143`): `most_significant = 1` and `least_significant = 2`, both `required fixed64`.

### 4.2 `ItemListRequest` (`FA:121-133`, built at `FileSync:178-197`)

`session_id = 1`, `transaction_id = 2`, `exclude_all_flags = 4` (repeated UUID), `get_flags = 5` (repeated UUID). Upstream always sets one `exclude_all_flags` and one `get_flags`, each `UUID{42405, 42405}` (`FILES_SYNCED`, `FileSync:307`; the comment at `FileSync:182` says that without it the watch "sends back already synced files going back months"). It adds `session_id` when the previous response carried one, otherwise `transaction_id` when a previous response gave `next_transaction_id`.

`42405 = 0xA5A5`, so the fixed64 is `a5 a5 00 00 00 00 00 00`.

Vector, first page (no session, no transaction), 45 bytes, wrapped as `Smart{43: Service{9: …}}`:

```
UUID         = 09 a5a5000000000000 11 a5a5000000000000                      (18 bytes)
ItemListReq  = 22 12 <UUID> 2a 12 <UUID>                                     (40 bytes)
Service      = 4a 28 <ItemListReq>                                           (42 bytes)
Smart        = da 02 2a <Service>                                            (45 bytes)
```

(`43 << 3 | 2 = 346`, varint `da 02`.)

### 4.3 `ItemListResponse` (`FA:135-153`, handled at `FileSync:118-176`)

`status = 1` (0 SUCCESS), `session_id = 2`, `next_transaction_id = 3`, `items = 4` (repeated `ItemReference`). A non-SUCCESS or missing status is only logged; the items are still processed (`FileSync:119-133`). When `session_id` is present, upstream requests the next page at once with that session id (`FileSync:163-173`).

### 4.4 `ItemReference` (`FA:155-169`) and `DataType` (`FA:35-56`)

`ItemReference`: `uid = 1` (UUID), `data_type = 2`, `data_size = 3` (uint64), `requested_flags = 4`, `transaction_id = 5`, `urgency = 6`, `modified_time = 7` (Garmin epoch seconds).

`DataType`: `format = 1`, `gdxml_string = 2`, `gdxml_string_key = 3`.

File selection (`FileSync:135-156`, `FileSync:246-302`):

- An item without `data_type` is ignored.
- Within one response, the first item of a type carries `gdxml_string` with its `gdxml_string_key`; later items may carry only the key. The type name comes from the item's string, else from the key's string seen earlier in the same response.
- With no name, an item with `data_type.format` set is named `DEVICE_XML` when the key is 3, else `TYPE_<key>`; an item with neither is ignored.
- The name maps to `FileType.FILETYPE` case-insensitively by `typeName` (`FileType:259-270`). For data type 128, `typeName` is `FIT_TYPE_<subtype>` (`FileType:230-232`). The health types we decode are `FIT_TYPE_4` (ACTIVITY), `FIT_TYPE_15` (MONITOR_A), `FIT_TYPE_28` (MONITOR_DAILY), `FIT_TYPE_32` (MONITOR), `FIT_TYPE_49` (SLEEP) and `FIT_TYPE_68` (HRV_STATUS), all `pull = true` (`FileType:63-127`).
- Before queueing, upstream replaces the item's `data_type` with `DataType{gdxml_string = <canonical typeName>}` unless the item already carries exactly that string; every other field of the item is kept (`FileSync:284-293`).

### 4.5 `PullItemDataRequest` (`FA:213-219`, built at `FileSync:199-215`)

`item = 1` (the queued `ItemReference`), `priority = 2` (24), `supported_transports = 3` (repeated, `MULTILINK_TRANSPORT_PIPE = 0`, `FA:348-350`), `offset = 4` (0), `requested_compression_window = 5` (15).

Vector for `uid = {0x1122334455667788, 0x99aabbccddeeff00}` and type `FIT_TYPE_32`, as fixed64 little-endian:

```
UUID       = 09 8877665544332211 11 00ffeeddccbbaa99
DataType   = 12 0b "FIT_TYPE_32"
Item       = 0a 12 <UUID> 12 0d <DataType>
PullReq    = 0a 23 <Item> 10 18 18 00 20 00 28 0f
```

### 4.6 `PullItemDataResponse` (`FA:221-231`, handled at `FileSync:102-116`)

`result = 1` (`ItemAccessResult`, 0 SUCCESS, `FA:98-111`), `transport = 2`, `transfer_handle = 3`. On SUCCESS upstream calls `downloadFileFromServiceV2(transfer_handle)`. Otherwise it signals a failed download and moves on.

### 4.7 `ModifyFlagsRequest` (`FA:177-181`, built at `FileSync:217-244`)

`uid = 1`, `set_flags = 2` (repeated UUID): one `UUID{42405, 42405}`. Sent after a file is processed, unless keep-on-device is set (`Sup:2180-2186`). With `fetchUnknownFiles` on, upstream skips it for types it does not process; we only ever fetch processed types.

### 4.8 `TransferStatusRequest` → `TransferStatusResponse` (`FA:325-346`, `FileSync:78-86`)

Reply `Service{21: TransferStatusResponse{next_transfer_priority = 1}}` as a `PROTOBUF_RESPONSE` with the watch's request id. Vector: `da 02 05 aa 01 02 08 01` (Smart → Service field 21 = tag `aa 01`).

## 5. File transfer services

### 5.1 Service ids (`V2:245-252`, `V2:770-775`)

`FILE_TRANSFER_2 = 0x2018`, `_4 = 0x4018`, `_6 = 0x6018`, `_A = 0xa018`, `_C = 0xc018`, `_E = 0xe018`. `startTransfer` takes the first id that is not currently registered (`V2:258-270`). With one file in flight that is `0x2018` every time (INFERRED).

### 5.2 Registration (`V2:273-275`, `V2:677-685`)

`REGISTER_ML_REQ` for that service with `reliable = 2` when MLR is enabled. The grant is handled exactly as for GFDI (`V2:356-431`): reliable non-zero means an `MlrCommunicator` on the granted handle, zero means plain ML. A failed grant (status ≠ 0) is only logged (`V2:364-367`) and the callback never runs; upstream's queue then stalls (INFERRED).

Vector (client id 2, `FILE_TRANSFER_2`, reliable): `00 00 02 00 00 00 00 00 00 00 18 20 02`.

### 5.3 Request on the granted handle (`Sup:2038-2047`)

Six bytes, little-endian: `00 00 <transfer_handle u16> 00 00`. On ML it goes out as `[handle][6 bytes]` (`V2:836-843`); on MLR as one MLR data message (`V2:873-875`). Upstream writes the transfer handle with `putShort((short) fileHandle)`, so a handle above 0xffff is truncated (INFERRED).

### 5.4 Data (`Sup:2197-2212`)

- Incoming bytes are the ML payload after the handle byte (`V2:230-235`), or MLR in-order data (`Mlr:162-168`). They are raw: no COBS, no GFDI framing, no CRC.
- The first message must satisfy `AU.equals({0,0,0}, value, 0)`, which is true only when `value` is at most 3 bytes long and all zero (`AU:35-55`). In practice the first message is `00 00 00`. Anything else is "unexpected first message": the file is abandoned (`Sup:2199-2206`).
- Every later message is appended to a buffer (`Sup:2209-2211`).

### 5.5 End of transfer (`V2:433-469`, `Sup:2051-2066`)

The watch ends the transfer by closing the handle: an unsolicited `CLOSE_HANDLE_RESP` for the transfer service. Upstream then closes the MLR communicator for that handle, drops the registration and calls `onClose`, which inflates the buffer. An empty buffer is only logged (`Sup:2052-2055`).

### 5.6 Decompression (`Zlib:30-46`)

`java.util.zip.Inflater()` with the default `nowrap = false`, i.e. a zlib stream (RFC 1950 header and Adler-32 trailer) around raw deflate. The window the phone asks for is 2^15 (`requested_compression_window = 15`). INFERRED: upstream's loop `while (!inflater.finished())` never ends on a truncated stream (`inflate` returns 0 and needs input), so a truncated file would hang upstream's thread.

### 5.7 After inflate (`Sup:2068-2190`)

The type name decides whether the bytes are FIT (`FileType.isFitFile()`: data type 128). FIT bytes go to the same `FitImporter` as legacy files (`Sup:2099-2125`). Non-FIT files are saved to storage. Then `ModifyFlagsRequest` (4.7) and the queue moves on.

## 6. How we port it

- `ours/protocol/garmin-new-sync.ts`: the protobuf messages above (encoders for 4.2, 4.5, 4.7, 4.8; decoders for 4.3, 4.4, 4.6 and the `Service` dispatch), the GFDI protobuf payload and status codec (3.2, 3.4), the incoming reassembler (3.5), the type-name selection (4.4), the transfer stream rules (5.4) and the zlib inflate (5.6). The protobuf wire codec is the existing hand-written one in `ours/protocol/xiaomi-proto.ts`.
- zlib: React Native has no Node `zlib` at runtime. We use `fflate` (MIT, pure JS) through its streaming `Unzlib`, so the inflated size can be capped while it grows.
- `ours/transport/garmin-new-sync.ts` (`GarminNewSyncDriver`): request ids, outgoing chunking and the status replies (section 3), and the loop of section 2. `ours/transport/garmin.ts` owns the BLE link and the ML/MLR handles, including the per-file `FILE_TRANSFER_*` registration (`openTransfer`). Models with `newSyncProtocol: true` in the registry (the same 5 as `mlr: "preferred"`) use it; every other model keeps the legacy directory download and still leaves protobufs unanswered.
- Downloaded bytes go through `garminFitRecords`, the same function as the legacy path, so record types and ids are unchanged and the server needs no change.
- Only the six health FIT types we decode are pulled (4.4). Upstream also pulls its other `pull = true` types (METRICS, SCORE, …); we leave those on the watch unflagged.
- Like upstream, the phone does not match replies to request ids; it waits for the next message of the expected kind.
- Local bounds and failure handling that upstream does not have:
  - a watchdog on every awaited protobuf reply, transfer grant and transfer message, plus the legacy path's overall cap per file;
  - caps on compressed and inflated bytes (8 MiB, the legacy cap), on reassembled protobuf size (1 MiB) and on concurrent reassemblies, list pages (32), queued files (1024) and files per sync;
  - a failed, skipped file on every path where upstream's queue would stall (failed grant, unexpected first message, empty buffer, inflate error), with the transfer handle given back by `CLOSE_HANDLE_REQ`;
  - a transfer that stops mid-way, or a pull that gets no answer, ends the sync as incomplete (no `SYNC_COMPLETE`), like a stalled legacy transfer;
  - the Adler-32 trailer is verified (`fflate` does not), assuming it is the last 4 bytes received (INFERRED; `java.util.zip.Inflater` would ignore trailing bytes);
  - a failed legacy flush does not block the protobuf list (upstream only lists after the directory completes).
- Sync state: files are keyed by their UUID (`uid:<most>:<least>` in hex), so a kept-on-device file is not downloaded twice. A file already downloaded but still listed (a lost `ModifyFlagsRequest`) is flagged again without a download.

## 7. Differences from the legacy path that matter

- File identity is the 128-bit UUID, not the directory index. The upper 32 bits of `most_significant` are the file's creation time (`Sup:2138-2143`).
- No per-chunk CRC or offset check exists. Integrity rests on MLR (or BLE) delivery and on zlib's Adler-32.
- Archiving is `ModifyFlagsRequest` with the SYNCED flag, not `SET_FILE_FLAG` ARCHIVE.

## 8. Test strategy

- Protobuf vectors 4.2, 4.5 and 4.8 byte for byte, plus decode of hand-built `ItemListResponse`/`PullItemDataResponse`.
- GFDI protobuf payload, chunk reassembly (in order, mismatched offset, oversize) and the four status shapes in 3.4.
- Type selection: string, key-only, unknown type, missing type, case-insensitive match, canonical rewrite keeps the other fields.
- Transfer stream: first message rules, append, empty buffer, inflate of a zlib stream, inflate cap, truncated stream.
- Session end to end with a fake watch over ML and over MLR: directory flush, paged list, pull, transfer registration, the 6-byte request, `00 00 00`, zlib data split across packets, close, records equal to the legacy path for the same FIT bytes, `ModifyFlagsRequest` (or not, with keep-on-device), `TransferStatusRequest` answered, and failures that skip a file instead of stalling.

## 9. Uncertainties

1. **No traces.** Every vector is hand-encoded from the `.proto` files. A capture from one of the 5 models is needed before this can be called working.
2. **Close versus in-flight MLR data.** `CLOSE_HANDLE_RESP` arrives on the ML management handle, which has no MLR sequencing. If the watch closes the transfer handle while some MLR data packets still await retransmission, upstream inflates a truncated buffer (INFERRED from `V2:433-451`). We do the same and fail the file on an inflate error, leaving it on the watch.
3. **The 3-byte first message.** Source only checks that it is zeros. Its meaning (status, offset) is UNKNOWN.
4. **The phone-side request `00 00 <handle> 00 00`.** The meaning of the zero bytes is UNKNOWN.
5. **Response message id.** Whether the watch answers our 5043 requests with 5044 or 5043 is not stated; upstream handles both identically, and so do we.
6. **Whether these watches still need the legacy directory "flush"**, and whether they answer it, is UNKNOWN. Upstream sends it unless `PREF_GARMIN_LEGACY_SYNC_FLUSH` is off, whose comment says "Some firmwares will freeze on the legacy sync request" (#6700, `Sup:689-697`). We send it, as upstream's default, and continue to the file list even if it fails.
7. **Paging.** `next_transaction_id` is kept by upstream for the next listing in the same app session (`FileSync:161`). Our sessions are per connection, so we only follow `session_id` within one sync (INFERRED equivalent for a fresh connection).
