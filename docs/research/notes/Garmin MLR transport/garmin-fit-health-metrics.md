# Garmin FIT import: HRV, resting heart rate and workouts (plus SpO₂, stress, respiration, Body Battery)

Checked: 2026-11-13. For issue #421.

Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2`. I downloaded each file below as raw bytes from `https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/commit/<sha>/<path>` and read it directly. Nothing was executed or built. All upstream line numbers refer to that commit. Upstream is AGPL-3.0-or-later, and so is OpenValens.

Upstream's `Fit*` message classes (`FitHrvStatusSummary`, `FitHrvValue`, `FitMonitoringHrData` and so on) are **generated at build time** from `fit_profile.json` by `FitCodeGen.java`. They are not in the tree, so field numbers, base types and scales below are cited from the profile JSON. Only a few hand-written subclasses exist (`FitSession`, `FitStressLevel`, `FitMonitoring`, `FitRecord`). The sample providers (`GarminHrvSummarySampleProvider` and the rest) are generated as well, from `GBDaoGenerator.java` and the `time-sample-provider.ftl` template.

Notation:

- **INFERRED** means I deduced it and did not read it in source.
- **UNKNOWN** means the source does not settle it.
- Everything else is read from the cited line.

## 0. Path aliases used in citations

| Alias      | Path at the pin                                                                         |
| ---------- | --------------------------------------------------------------------------------------- |
| `G/`       | `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/`                               |
| `Prof`     | `FitCodeGenerator/src/main/resources/fit_profile.json`                                  |
| `Codegen`  | `FitCodeGenerator/src/main/java/.../service/devices/garmin/fit/codegen/FitCodeGen.java` |
| `Imp`      | `G/service/devices/garmin/fit/FitImporter.java`                                         |
| `WP`       | `G/devices/garmin/GarminWorkoutParser.java`                                             |
| `Sport`    | `G/service/devices/garmin/fit/enums/GarminSport.java`                                   |
| `Session`  | `G/service/devices/garmin/fit/messages/FitSession.java`                                 |
| `Stress`   | `G/service/devices/garmin/fit/messages/FitStressLevel.java`                             |
| `FitFile`  | `G/service/devices/garmin/fit/FitFile.java`                                             |
| `RD`       | `G/service/devices/garmin/fit/RecordData.java`                                          |
| `RH`       | `G/service/devices/garmin/fit/RecordHeader.java`                                        |
| `RDef`     | `G/service/devices/garmin/fit/RecordDefinition.java`                                    |
| `FD`       | `G/service/devices/garmin/fit/FieldDefinition.java`                                     |
| `NFM`      | `G/service/devices/garmin/fit/NativeFITMessage.java`                                    |
| `BT/`      | `G/service/devices/garmin/fit/baseTypes/`                                               |
| `DT`       | `G/service/devices/garmin/fit/fieldDefinitions/FieldDefinitionDateTime.java`            |
| `FTD`      | `G/service/devices/garmin/fit/fieldDefinitions/FieldDefinitionFileType.java`            |
| `FT`       | `G/service/devices/garmin/FileType.java`                                                |
| `Sup`      | `G/service/devices/garmin/GarminSupport.java`                                           |
| `FTH`      | `G/service/devices/garmin/FileTransferHandler.java`                                     |
| `FSync`    | `G/service/devices/garmin/FileSyncServiceHandler.kt`                                    |
| `SFF`      | `G/service/devices/garmin/messages/SetFileFlagsMessage.java`                            |
| `Time`     | `G/service/devices/garmin/GarminTimeUtils.java`                                         |
| `DevPrefs` | `G/util/preferences/DevicePrefs.java`                                                   |
| `Gen`      | `GBDaoGenerator/src/nodomain/freeyourgadget/gadgetbridge/daogen/GBDaoGenerator.java`    |
| `TSP`      | `G/devices/AbstractTimeSampleProvider.java`                                             |
| `ASP`      | `G/model/ActivitySummaryParser.java`                                                    |
| `HrvS`     | `G/model/HrvSummarySample.java`                                                         |
| `HRVF`     | `G/activities/charts/HRVStatusFragment.java`                                            |
| `HRF`      | `G/activities/charts/HeartRatePeriodFragment.java`                                      |
| `HCHrv`    | `G/util/healthconnect/syncers/HrvSyncer.kt`                                             |
| `HCRhr`    | `G/util/healthconnect/syncers/RestingHeartRateSyncer.kt`                                |
| `ours/`    | `apps/native/lib/direct-devices/` in this repo                                          |
| `contract` | `packages/api/src/contracts/direct-device.ts` in this repo                              |

## 1. Short answer

1. **We need two more file types.** HRV comes from `HRV_STATUS` (128/68) and workouts from `ACTIVITY` (128/4). Upstream downloads both by default (`FT:63`, `FT:127`). Resting heart rate (`monitoring_hr_data`, 211) most likely already arrives in the `MONITOR` (128/32) files we download today. That is INFERRED: upstream persists it from whichever file carries it (`Imp:583-591`).
2. **HRV.** `hrv_status_summary` (370) field 1 `last_night_average` is the upstream value that best matches a nightly RMSSD sample. It is `UINT16`, scale 128, unit ms: `ms = raw / 128` (`Prof:3486`). Upstream rounds it to an integer and stores it keyed by the message's UTC `timestamp` (`Imp:369-395`). It files the summary under the phone-local calendar day that contains that timestamp (`HRVF:540-544`).
3. **Resting HR.** `monitoring_hr_data` (211) has two `UINT8` bpm fields: `resting_heart_rate` (0) and `current_day_resting_heart_rate` (1). Upstream prefers field 1, "that matches what the watch displays" (`Imp:443-448`). It stores every sample keyed by timestamp. Its charts take the **latest** sample in each local day (`HRF:144-153`).
4. **Workouts.** One `BaseActivitySummary` per `ACTIVITY` file, from the **first** `session` (18) only. Start is `start_time` (field 2) or else `file_id.time_created`. End is start plus `total_elapsed_time` (field 7, raw/1000 s). The kind comes from `(sport, sub_sport)` through `GarminSport` (`WP:446-465`, `WP:1286-1308`). The FIT file is kept on the phone and linked from the summary (`Imp:524-549`, `Imp:724`).
5. **Our parser gaps.** `parseGarminFitFile` returns raw unscaled numbers, so every scaled field needs `raw / scale - offset` in the decoder. It drops strings, keeps only the first element of arrays, and gives no timestamp to a record that has neither field 253 nor a compressed header. Upstream carries the running timestamp forward to such records (`RD:105-117`).
6. **Archiving.** Upstream sets `ARCHIVE` (0x10) on every file after a successful download, and on files it already has. It skips this only for `DEVICE_XML` or when "keep activity data on device" is on (`Sup:639-641`, `Sup:1238-1243`). This matches what `ours/transport/garmin.ts:340-383` already does.

## 2. Our side today

- `ours/protocol/garmin.ts:178-196`: `GARMIN_FILE_TYPE` and `GARMIN_HEALTH_FILE_TYPES` list only `MONITOR_A` 128/15, `MONITOR_DAILY` 128/28, `MONITOR` 128/32 and `SLEEP` 128/49.
- `ours/protocol/garmin.ts:202-211`: `GARMIN_FIT_MESSAGE` knows 0, 21, 55, 211, 274, 275, 346 and 412. Message 211 is declared there, but no decoder reads it.
- `ours/protocol/garmin.ts:1008-1127`: `parseGarminFitFile` yields `{ messageNumber, timestamp, fields: Map<number, number> }`, with raw unscaled values (`:891-897`).
- `ours/protocol/garmin.ts:1580-1600`: `garminFitRecords` emits only `steps`, `heart_rate` and `sleep_session`.
- `ours/transport/garmin.ts:340-375`: it downloads the directory, keeps entries where `isGarminHealthFile` is true, downloads and parses each one, then archives it. Already-downloaded entries are archived and skipped.
- `contract:164-190`: `hrv_rmssd { rmssdMs }`, `resting_heart_rate { bpm int 20..250 }` and `workout { activity, title }` already exist. Each has `startTime`, `endTime` and `externalRecordId`. The `hrv_rmssd` doc comment already says "Garmin HRV status, last-night average".

## 3. File types

`FileType.FILETYPE(type, subtype, pull)`. Upstream downloads a directory entry only when `pull` is true or the "fetch unknown files" preference is on (`FTH:316-320`). That preference defaults to `false` (`DevPrefs:75-77`). Newer watches using V2 file sync apply the same `pull` gate (`FSync:226-227`).

| File type       | dataType/subType | `pull` (downloaded by default) | Metrics it carries                                                                                                                     |
| --------------- | ---------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTIVITY`      | 128/4            | yes (`FT:63`)                  | Workouts: `session` 18, `lap` 19, `record` 20, `sport` 12 and others. Routed to `GarminWorkoutParser` (`Imp:194-198`, `Imp:556-557`).  |
| `MONITOR_A`     | 128/15           | yes (`FT:74`)                  | `monitoring` 55 (INFERRED).                                                                                                            |
| `MONITOR_DAILY` | 128/28           | yes (`FT:87`)                  | `monitoring` 55 (INFERRED).                                                                                                            |
| `MONITOR`       | 128/32           | yes (`FT:91`)                  | `monitoring` 55 (`Imp:559-560`). INFERRED: also `monitoring_hr_data` 211, `stress_level` 227, `spo2_data` 269, `respiration_rate` 297. |
| `METRICS`       | 128/44           | yes (`FT:103`)                 | Training metrics (`Imp:562-563` has no special rules). Not needed for these three metrics. INFERRED.                                   |
| `SLEEP`         | 128/49           | yes (`FT:108`)                 | Sleep levels and assessment (`Imp:566-576`). INFERRED: may also carry SpO₂ and respiration during sleep.                               |
| `HRV_STATUS`    | 128/68           | yes (`FT:127`)                 | `hrv_status_summary` 370 and `hrv_value` 371. The folder name is "garmin/HRVSTATUS" (`FT:35`). The message placement is INFERRED.      |

Notes:

- Upstream does not route per-metric samples by file type. Every file's HRV, resting HR, stress, Body Battery, SpO₂ and respiration samples are collected in one loop and persisted after the type-specific `switch`. The code comment reads "some of these samples can occur in multiple FIT file types" (`Imp:583-599`). Only steps (MONITOR), sleep stages (SLEEP) and workouts (ACTIVITY) are type-gated (`Imp:555-581`).
- The `switch` uses the FIT `file_id.type` field (field 0), which `FTD:16-22` decodes as `FILETYPE(128, raw)`. It does not use the directory entry's type.

## 4. HRV

### 4.1 Message and field tables

`hrv_status_summary`, global message **370** (`Prof:3482-3493`):

| Field # | Name                      | Base type | Scale | Unit | Upstream getter → stored                               |
| ------- | ------------------------- | --------- | ----- | ---- | ------------------------------------------------------ |
| 0       | `weekly_average`          | UINT16    | 128   | ms   | Float → `Math.round` → `weeklyAverage` (`Imp:373-375`) |
| 1       | `last_night_average`      | UINT16    | 128   | ms   | → `lastNightAverage` (`Imp:376-378`)                   |
| 2       | `last_night_5_min_high`   | UINT16    | 128   | ms   | → `lastNight5MinHigh` (`Imp:379-381`)                  |
| 3       | `baseline_low_upper`      | UINT16    | 128   | ms   | → `baselineLowUpper` (`Imp:382-384`)                   |
| 4       | `baseline_balanced_lower` | UINT16    | 128   | ms   | → `baselineBalancedLower` (`Imp:385-387`)              |
| 5       | `baseline_balanced_upper` | UINT16    | 128   | ms   | → `baselineBalancedUpper` (`Imp:388-390`)              |
| 6       | `status`                  | ENUM      | —     | —    | `HrvStatus` → `statusNum` (`Imp:391-394`)              |
| 253     | `timestamp`               | UINT32    | —     | s    | DateTime, UTC, → `timestamp` ms (`Imp:372`)            |

`HrvStatus` enum (`Prof:5448-5455`, mirrored in `HrvS:20-26`): 0 `NONE`, 1 `POOR`, 2 `LOW`, 3 `UNBALANCED`, 4 `BALANCED`.

`hrv_value`, global message **371** (`Prof:3496-3501`):

| Field # | Name        | Base type | Scale | Unit | Stored                                                             |
| ------- | ----------- | --------- | ----- | ---- | ------------------------------------------------------------------ |
| 0       | `value`     | UINT16    | 128   | ms   | `Math.round(value)` → `GarminHrvValueSample.value` (`Imp:396-405`) |
| 253     | `timestamp` | UINT32    | —     | s    | UTC → `timestamp` ms (`Imp:403`)                                   |

A null `value` (raw `0xFFFF`) is skipped with a warning (`Imp:397-400`). The summary has no null filter: each field is copied only when it is non-null.

### 4.2 Scaling

The code generator makes the getter of any scaled 1-byte or 2-byte integer field return `Float` (`Codegen:906-907`). The decode step divides by the scale and subtracts the offset:

```java
// BT/BaseTypeShort.java:30-37
int s = unsigned ? Short.toUnsignedInt(byteBuffer.getShort()) : byteBuffer.getShort();
if (s < min || s > max) return null;
if (s == invalid) return null;
return (s / scale) - offset;
```

```java
// Imp:376-378
if (hrvSummary.getLastNightAverage() != null) {
    sample.setLastNightAverage(Math.round(hrvSummary.getLastNightAverage()));
}
```

So the stored value is `round(raw / 128)` ms. Example: raw `0x1680` = 5760 → 45.0 ms.

### 4.3 Timestamps and which night

- **Field and zone.** Both messages use field 253, a FIT `DateTime`: seconds since 1989-12-31T00:00:00Z. `DT:10` sets the offset to `-GARMIN_TIME_EPOCH`, and `Time:8` sets `GARMIN_TIME_EPOCH = 631065600`, so decoding yields Unix seconds in UTC. Upstream stores `ts * 1000L` (`Imp:372`, `Imp:403`) and never applies a time zone at import.
- **Which day.** At display time, upstream takes the **latest** summary whose timestamp falls in the phone-local day `[00:00, 24:00)` (`HRVF:540-544`). The night it describes is therefore the night that ended on that local day. INFERRED: the watch writes the summary once, when it finalizes the overnight HRV status on waking.
- **Which samples.** For the "last night" chart, upstream finds the last sleep session between local 12:00 the day before and 12:00 on the day. It then selects the `hrv_value` samples inside that sleep window (`HRVF:619-657`). INFERRED: `hrv_value` holds roughly 5-minute RMSSD values during sleep. The name `last_night_5_min_high` supports this.

### 4.4 What upstream stores and how it dedupes

- `GarminHrvSummarySample` has seven nullable `int` columns (`Gen:1274-1285`). `GarminHrvValueSample` has `value int not null` (`Gen:1287-1292`).
- Every time-sample table has the primary key `(timestamp, deviceId)` (`Gen:1635-1636`). Writes use `insertOrReplaceInTx` (`TSP:98-99`, `TSP:225-255`). Re-importing the same file overwrites rows in place. Two summaries on the same day are both kept, and the reader picks the latest (`HRVF:542-544`).
- Health Connect export sends every **`hrv_value`** sample (not the summary) as a `HeartRateVariabilityRmssdRecord`, filtered to 1..200 ms (`HCHrv:15-43`).

### 4.5 Best match for our `hrv_rmssd`

Use **`hrv_status_summary.last_night_average` (370/1), `raw / 128` ms**.

- It is Garmin's single nightly figure. It is what the watch and upstream's "last night" tile show (`HRVF:398`, `HRVF:568`). It is also the one value per night that lines up with Whoop's, Oura's and Polar's nightly RMSSD.
- It is RMSSD. Upstream treats Garmin's per-sample HRV as RMSSD by exporting `hrv_value` as `HeartRateVariabilityRmssdRecord` (`HCHrv:15`, `HCHrv:38-43`). INFERRED: the nightly mean of those samples is also RMSSD.
- The other fields do not fit. `weekly_average` is a 7-day rolling value. `last_night_5_min_high` is a maximum. The `baseline_*` fields are personal ranges, not measurements.
- The fallback, when the summary is missing or its field 1 is invalid, is the mean of the `hrv_value` samples in the same file. This is INFERRED and is not Garmin's exact figure. Upstream computes a similar "day average" only for its charts (`HRVF:545-556`).

## 5. Resting heart rate

### 5.1 Message and field table

`monitoring_hr_data`, global message **211** (`Prof:2403-2410`):

| Field # | Name                             | Base type | Unit | Invalid |
| ------- | -------------------------------- | --------- | ---- | ------- |
| 0       | `resting_heart_rate`             | UINT8     | bpm  | 0xFF    |
| 1       | `current_day_resting_heart_rate` | UINT8     | bpm  | 0xFF    |
| 253     | `timestamp`                      | UINT32    | s    | —       |

Neither field is scaled. The UINT8 invalid value 0xFF comes from `BT/BaseType.java:12`.

Other places that carry resting HR, which upstream does **not** import:

- `monitoring_info` (103) has no resting-HR field. Upstream reads only `resting_metabolic_rate` (field 5, kcal/day) from it (`Prof:1453-1463`, `Imp:406-414`).
- `true_up` (198) has fields 14 `resting_heart_rate_today_timestamp`, 15 `resting_heart_rate` and 16 `resting_heart_rate_today` (`Prof:2263-2265`). `FitImporter` has no branch for this message, so it falls into "unknown record" (`Imp:502-512`).
- `user_profile` (3) has field 8 `resting_heart_rate` (`Prof:160`). This is the user setting, not a measurement.

### 5.2 Semantics and timestamp

```java
// Imp:435-449
if (monitoringHrData.getRestingHeartRate() == null && monitoringHrData.getCurrentDayRestingHeartRate() == null) {
    LOG.warn("Resting HR at {} is null", ts);
    continue;
}
...
sample.setTimestamp(ts * 1000L);
if (monitoringHrData.getCurrentDayRestingHeartRate() != null) {
    // Prioritize the current day value - that matches what the watch displays
    sample.setHeartRate(monitoringHrData.getCurrentDayRestingHeartRate());
} else {
    sample.setHeartRate(monitoringHrData.getRestingHeartRate());
}
```

- Field 1 is "today's" RHR, as the watch shows it. INFERRED: field 0 is Garmin's 7-day average RHR, since Garmin Connect shows both numbers.
- `ts` is the record's computed timestamp: field 253, or a compressed-header timestamp, or the running timestamp (`RD:105-117`, `RD:299-301`). It is UTC.

### 5.3 What upstream stores and how it dedupes

- `GarminHeartRateRestingSample { timestamp, deviceId, userId, heartRate int not null }` with primary key `(timestamp, deviceId)` (`Gen:1301-1306`, `Gen:1635-1636`). Writes use insert-or-replace (`TSP:98-99`).
- **There is no per-day dedupe at write time.** A file with several 211 records gives several rows. Readers pick the **latest sample in the local day**:

```java
// HRF:146-152
restingHeartRate = device.getDeviceCoordinator()
        .getHeartRateRestingSampleProvider(device, db.getDaoSession())
        .getAllSamples(startTs * 1000L, endTs * 1000L)
        .stream()
        .max(Comparator.comparingLong(HeartRateSample::getTimestamp))
        .map(HeartRateSample::getHeartRate)
        .orElse(DATA_INVALID);
```

- Health Connect export sends every row as a `RestingHeartRateRecord` at its own timestamp. It skips values outside 1..300 bpm and the value 255 (`HCRhr:42-61`).

## 6. Workouts

### 6.1 Flow

1. `file_id` is read first. When `file_id.type == ACTIVITY`, each record goes to `workoutParser.handleRecord` first (`Imp:194-198`).
2. `handleRecord` keeps `session`, `lap`, `record`, `sport`, `physiological_metrics`, `time_in_zone`, `set`, `workout`, `activity`, `device_info` and some others (`WP:257-414`). For sessions, the **first** one becomes the primary, and any later ones go only into `allSessions` (`WP:268-280`). Only the first `sport` message is kept (`WP:284-291`).
3. `persistWorkout` (`Imp:680-741`):
   - Start = the primary session's `start_time`, or `file_id.time_created` when that is null (`Imp:683-706`, `WP:155-158`).
   - `findOrCreateBaseActivitySummary` looks up an existing summary by `(startTime, deviceId, userId)` (`ASP:76-90`, `ASP:110-120`). This is the dedupe key. On reprocessing, the lookup uses `time_created` instead (`Imp:687-703`).
   - It calls `updateSummary`, then sets `rawDetailsPath = <FIT file path>` and writes with `insertOrReplaceInTx` (`Imp:720-730`).
4. If a session is missing, `updateSummary` logs "Got workout, but no session" and leaves the summary empty (`WP:419-422`).

### 6.2 `session` (18) fields used for the summary

`Prof:470-666`. Values are `raw / scale - offset`. A scaled UINT32 returns `Double`; a scaled UINT8 or UINT16 returns `Float` (`BT/BaseType.java:62-102`).

| Field # | Name                             | Base type | Scale | Unit | Upstream use                                                                                                       |
| ------- | -------------------------------- | --------- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| 2       | `start_time`                     | UINT32    | —     | s    | DateTime (UTC). Becomes the summary `startTime` (`Imp:683`, `Imp:706`).                                            |
| 5       | `sport`                          | ENUM      | —     | —    | `getActivityKind(sport, sub_sport)` (`WP:446-450`). Plain integer: the profile gives it no enum type (`Prof:478`). |
| 6       | `sub_sport`                      | ENUM      | —     | —    | As above (`Prof:479`).                                                                                             |
| 7       | `total_elapsed_time`             | UINT32    | 1000  | s    | `endTime = startTime + round(s * 1000)` ms (`WP:462-465`).                                                         |
| 8       | `total_timer_time`               | UINT32    | 1000  | s    | `ACTIVE_SECONDS` (`WP:467`).                                                                                       |
| 9       | `total_distance`                 | UINT32    | 100   | m    | `DISTANCE_METERS` (`WP:468`).                                                                                      |
| 10      | `total_cycles`                   | UINT32    | —     | —    | Steps = (cycles + `total_fractional_cycles` 94/128) × 2 for step-based kinds (`WP:471-485`).                       |
| 11      | `total_calories`                 | UINT16    | —     | kcal | `CALORIES_TOTAL`. Burnt = total − `metabolic_calories` (196) (`WP:488-495`).                                       |
| 16      | `avg_heart_rate`                 | UINT8     | —     | bpm  | `HR_AVG`, falling back to `physiological_metrics` (`WP:499-501`).                                                  |
| 17      | `max_heart_rate`                 | UINT8     | —     | bpm  | `HR_MAX` (`WP:502`).                                                                                               |
| 64      | `min_heart_rate`                 | UINT8     | —     | bpm  | `HR_MIN` (`WP:498`).                                                                                               |
| 22 / 23 | `total_ascent` / `total_descent` | UINT16    | —     | m    | Used when the kind is not diving (`WP:550-556`).                                                                   |
| 110     | `sport_profile_name`             | STRING    | —     | —    | Workout name, third choice (`WP:426-444`).                                                                         |
| 197/198 | `sdrr_hrv` / `rmssd_hrv`         | UINT8     | —     | ms   | Per-workout HRV in the summary (`WP:503-504`, `Prof:639-640`). Not a nightly value.                                |
| 253     | `timestamp`                      | UINT32    | —     | s    | Session end (INFERRED). Used only for map points (`Session:33-63`).                                                |

The summary entity is `BaseActivitySummary { name, startTime, endTime, activityKind, rawDetailsPath, summaryData (JSON string), deviceId, userId, ... }` (`Gen:1931-1959`). Every number other than start, end and kind goes into the `summaryData` JSON (`WP:1266`).

### 6.3 Name and sport mapping

- **Name priority** (`WP:426-444`): `activity` (34) field 8 `name` (`Prof:1158`), then `workout` (26) field 8 `wkt_name` (`Prof:1005`), then `session` field 110 `sport_profile_name`, then `sport` (12) field 3 `name` (`Prof:312`). All four are strings.
- **Kind** (`WP:446-450`): it uses `session.sport` and `session.sub_sport`. The `sport` (12) message's fields 0 and 1 are used only when `session.sport` is null.
- **`getActivityKind`** (`WP:1286-1308`): a null sport or sub-sport becomes 0. It looks up `GarminSport.fromCodes(sport, subSport)` (`Sport:219-227`). If that fails, it tries `(sport, 0)`, and then `ActivityKind.UNKNOWN`. The table is in `Sport:12-194`. Examples: `(1,0)` RUNNING, `(1,1)` TREADMILL, `(2,0)` CYCLING, `(2,6)` INDOOR_CYCLING, `(5,17)` POOL_SWIM, `(10,20)` STRENGTH_TRAINING, `(11,0)` WALKING, `(17,0)` HIKING.
- The FIT `Sport` enum names, such as 0 `GENERIC`, 1 `RUNNING`, 2 `CYCLING` and 5 `SWIMMING`, are listed in `Prof:6790-6880`. `SubSport` starts at `Prof:7001`.

### 6.4 Is the file kept?

Yes. The downloaded file already lives under the export directory, at `[TYPE]/[YEAR]/[TYPE]_[date]_[index].fit` (`FTH:616-625`). If the file came from somewhere else, `importFile` copies it there (`Imp:524-549`). The summary stores the path (`Imp:724`). The workout detail view parses the FIT file again on demand (`WP:172-205`). Optional GPX/FIT auto-export runs afterwards (`Imp:732-740`).

### 6.5 Multi-session files

Only the first `session` drives the single `BaseActivitySummary`. Later sessions go only into `allSessions` (`WP:102-109`, `WP:268-280`). In the files I read, nothing apart from the getter `getAllSessions()` reads `allSessions` (`WP:225-227`). A triathlon or brick FIT file therefore becomes **one** workout, with the first leg's sport and the first session's elapsed time. Only the first `sport` message is kept (`WP:286-291`), and only one dive session (`WP:324-331`).

## 7. Parser details these messages need

These are compared with `ours/protocol/garmin.ts:899-1127`.

| Topic                             | Upstream                                                                                                                                                                                                                                                       | Ours                                                                                                                                                        | Action                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Scale and offset                  | Applied in decode: `raw / scale - offset` (`FD:105-108`, `BT/BaseTypeShort.java:36`). DateTime has offset `-631065600` (`DT:10`).                                                                                                                              | Raw values only (`:891-897`).                                                                                                                               | Divide in each decoder: HRV /128, elapsed and timer time /1000, distance /100, respiration /100.                      |
| Which base type decodes the bytes | The **wire** base type. Scale and name come from the profile (`NFM:133-184`). A `size == 1` UINT16/32/64 is decoded as UINT8 (COROS quirk, `NFM:167-173`).                                                                                                     | The wire base type. Reads `width` bytes even when `size < width` (`:1095`).                                                                                 | Fine for Garmin. Optionally clamp the read width to the field size.                                                   |
| Invalid sentinels                 | Per type, for each element: ENUM/UINT8/BYTE 0xFF, SINT8 0x7F, SINT16 0x7FFF, UINT16 0xFFFF, SINT32 0x7FFFFFFF, UINT32 0xFFFFFFFF, Z-types 0, SINT64 0x7FFF…, UINT64 0xFFFF…, and float NaN or all-ones (`BT/BaseType.java:10-26`, `BT/BaseTypeFloat.java:28`). | Same for 8, 16 and 32 bits. Float values return **before** the invalid check, so NaN gets through (`:983-990`). 64-bit values are reduced mod 2³² (`:978`). | Add a NaN check. No float or 64-bit field matters for these three metrics.                                            |
| Timestamp carry-forward           | Each record's `computedTimestamp` starts as the current reference timestamp, and only field 253 changes the reference (`RD:105-117`, `RD:376-382`, `FitFile:117-123`).                                                                                         | `timestamp` is null unless the record has field 253 or a compressed header (`:1104-1111`).                                                                  | **Carry the last reference forward**, as upstream does. This matters if a 211, 370 or 371 definition omits field 253. |
| Compressed timestamps             | Header bit 7. Local type = bits 5-6, offset = bits 0-4. Rollover arithmetic as in `FitFile:95-105`, `RH:27-39`.                                                                                                                                                | Same (`:1029-1037`).                                                                                                                                        | None.                                                                                                                 |
| Message-specific time             | `FitStressLevel` overrides the timestamp with `stress_level_time` (227/1) (`Stress:27-34`). Message 227 has no field 253 (`Prof:2492-2499`).                                                                                                                   | —                                                                                                                                                           | Needed only for stress and Body Battery.                                                                              |
| Developer fields                  | Typed through `field_description`. A developer field that maps onto a native field number **overrides** that native field (`RD:61-81`, `RD:165-195`, `RDef:113-120`).                                                                                          | Skipped by size (`:1065-1079`, `:1099-1102`).                                                                                                               | Skipping is safe for Garmin's own files. INFERRED: watches do not emit developer fields for these messages.           |
| Arrays                            | A field with `size > baseSize` decodes to an `Object[]`. Scalar getters take element 0 (`RD:197-208`, `RD:416-422`).                                                                                                                                           | Reads element 0 only.                                                                                                                                       | The same in effect. None of the target fields are arrays.                                                             |
| Strings                           | UTF-8, cut at the first NUL (`RD:405-415`).                                                                                                                                                                                                                    | Dropped (`fitBaseTypeInfo` returns null, `:958-959`).                                                                                                       | Add string decoding if we want workout titles (§6.3).                                                                 |
| CRC                               | A wrong file CRC is a hard error (`FitFile:127-132`). Bytes after the end of the file are only logged (`FitFile:133-136`).                                                                                                                                     | A stored CRC of 0 is tolerated (`:1119-1124`).                                                                                                              | None.                                                                                                                 |
| Unknown base type                 | Treated as BYTE so the parser can skip it (`BT/BaseType.java:39-52`).                                                                                                                                                                                          | Same idea (`:960-962`).                                                                                                                                     | None.                                                                                                                 |

## 8. Archiving

- `SetFileFlagsMessage.FileFlags`: CRYPTO 0x04, APPEND 0x08, **ARCHIVE 0x10**, ERASE 0x20, WRITE 0x40, READ 0x80 (`SFF:28-37`). These match `GARMIN_FILE_FLAG` in `ours/protocol/garmin.ts:123-130`.
- After every successful download, upstream sends `SetFileFlags(fileIndex, ARCHIVE)`. It skips this for `DEVICE_XML` and when `PREF_KEEP_ACTIVITY_DATA_ON_DEVICE` is true (default `false`) (`Sup:639-641`, `Sup:673-675`). The flag is sent when the download completes. Parsing happens later, from the pending-file queue (`Sup:629-637`, `Sup:1271-1312`), so a parse failure does not stop the archive.
- If a file already exists on the phone with non-zero size, upstream does not download it again but still archives it (`Sup:1238-1243`, `Sup:1673-1700`).
- File type makes no difference. `ACTIVITY`, `HRV_STATUS`, `MONITOR`, `SLEEP` and the rest are all archived the same way. Upstream never uses `ERASE`.
- Ours behaves the same, except that the "already have it" check uses the sync-state store instead of a file on disk (`ours/transport/garmin.ts:351-355`, `:373-382`).

## 9. Deferred metrics (one line each)

- **SpO₂.** `spo2_data` **269**: field 0 `reading_spo2` UINT8 %, field 1 `reading_confidence` UINT8, field 2 `mode` ENUM, field 253 timestamp (`Prof:2716-2723`). Values of 0 or less are skipped. Mode 1 is MANUAL, mode 3 is AUTOMATIC, anything else is UNKNOWN (`Imp:305-325`). Stored as `GarminSpo2Sample { spo2 int, typeNum int }` (`Gen:1229-1235`).
- **Stress.** `stress_level` **227**: field 0 `stress_level_value` SINT16, field 1 `stress_level_time` UINT32 DateTime (this is its timestamp, since the message has no field 253), field 2 `average_stress` SINT8 (`Prof:2492-2499`, `Stress:27-34`). Negative values are skipped (`Imp:210-217`). Stored as `GarminStressSample { stress int }` (`Gen:1207-1212`). Message 228 `manual_stress` is not imported.
- **Respiration.** `respiration_rate` **297**: field 0 `respiration_rate` SINT16, scale 100, breaths/min, field 253 timestamp (`Prof:2854-2859`). Values of 0 or less are skipped (`Imp:326-335`). Stored as `GarminRespiratoryRateSample { respiratoryRate float }` (`Gen:1294-1299`).
- **Body energy (Body Battery).** The same `stress_level` **227** record, field 3 `body_energy` SINT8, with the same `stress_level_time` timestamp (`Prof:2498`, `Imp:219-226`). There is no range filter beyond null. Stored as `GarminBodyEnergySample { energy int }` (`Gen:1214-1219`). The `true_up` (198) fields 22-25 and `true_up_body_battery` (464) are not imported (`Prof:2267-2270`, `Prof:3892-3898`).

## 10. Recommended port

1. **File types.** Add `HRV_STATUS { 128, 68 }` and `ACTIVITY { 128, 4 }` to the downloaded set. `METRICS` is not needed for these three metrics. Keep archiving every downloaded file with `0x10`.
2. **Parser.** Carry the running timestamp forward to records without field 253 (§7). Add a NaN check for floats. Optionally decode `STRING` for workout titles.
3. **`hrv_rmssd`.** For each `370` message with field 1 present and greater than 0:
   - `rmssdMs = raw / 128`. Rounding to an integer matches upstream and Garmin Connect (INFERRED for Connect).
   - Time: field 253, UTC. If the same file has `371` samples, use the first and last `371` timestamps as the window; otherwise use a point at the summary timestamp. INFERRED: the 371 samples sit in the same file and cover the sleep window.
   - `externalRecordId`: device plus the summary timestamp. This is idempotent, like upstream's `(timestamp, deviceId)` key.
4. **`resting_heart_rate`.** For each `211` message: `bpm = field 1 ?? field 0`, skipping 0xFF and values outside the contract's 20..250. Collapse to **one record per local day**, keeping the latest timestamp, as `HRF:144-153` does. Key `externalRecordId` on device plus local date, so a later sync on the same day replaces the earlier value. Use the sample timestamp, UTC, for the record time.
5. **`workout`.** For each `ACTIVITY` file, take the first `18` message:
   - `startTime` = field 2, or else `file_id` field 4.
   - `endTime` = start + field 7 / 1000 s.
   - `activity` = the lowercased FIT `Sport` enum name of field 5 (`Prof:6790-6880`), for example `running`. This is what the contract's doc comment asks for (`contract:183-188`). A null sport becomes `generic`, as upstream treats null as 0.
   - `title` = `activity.name`, then `workout.wkt_name`, then `session.sport_profile_name`, then `sport.name`, else null.
   - `externalRecordId`: device plus `startTime`, matching `ASP:76-90`.
   - Multi-session files: keep upstream's single-workout behaviour for parity, or optionally emit one record per session. That second option goes beyond what upstream does.

## 11. Uncertainties

1. **Which messages sit in which file.** That `monitoring_hr_data`, stress, SpO₂ and respiration are in `MONITOR` files, and that 370 and 371 are in `HRV_STATUS`, is INFERRED. Upstream never ties a message to a file type for these metrics (`Imp:583-599`). To check, run our parser over one archived `MONITOR` file and one `HRV_STATUS` file from a real watch.
2. **The meaning of `hrv_status_summary.timestamp`** (wake time, end of sleep, or the time the status was computed) is UNKNOWN. Upstream only buckets it by local day.
3. **The semantics of `resting_heart_rate` (field 0)** as a 7-day average are INFERRED. Upstream's comment only says that field 1 matches the watch display. How often 211 is written per day, and whether its value changes during the day, is UNKNOWN.
4. **Whether Garmin's HRV is strictly RMSSD** is INFERRED from upstream's Health Connect mapping (`HCHrv:15`). Garmin's wire format does not say.
5. **Whether real 211, 370 and 371 definitions always include field 253** is UNKNOWN. That is why §7 recommends carrying the timestamp forward.
6. **Monitoring files.** Upstream persists minute samples only when `file_id.type == MONITOR` (32) (`Imp:559-560`, `FTD:16-22`). If `MONITOR_A` and `MONITOR_DAILY` files carry `file_id.type` 15 or 28, upstream ignores their `monitoring` 55 steps, while `ours/protocol/garmin.ts:1580-1600` decodes them. This is outside the scope of this note but worth checking against a real file.
7. **Health Connect behaviour versus display behaviour.** Upstream exports every RHR row and every `hrv_value` sample to Health Connect, but its own UI shows one value per day. Our one-record-per-day choice follows the UI, not the export.
8. **Multi-session files.** The comment at `WP:102-106` says secondary sessions are "recorded for surfacing in the summary table", but no reader of `allSessions` appears in the files I read. A caller elsewhere in the tree could use `getAllSessions()`. UNKNOWN.
