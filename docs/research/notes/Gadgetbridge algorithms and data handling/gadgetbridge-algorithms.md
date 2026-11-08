# Gadgetbridge algorithms and data handling — source notes

Checked: 2026-11-08. Pinned source: Codeberg `Freeyourgadget/Gadgetbridge` commit `8976702fc3d00e6008c91fe994668cb4027f7bc2` (GitHub mirror is stale at 2024-12). All line references are from that commit. Raw HTTP fetches; nothing cloned or modified. AGPL-3.0-or-later throughout; OpenValens is AGPL, so porting with attribution is compatible.

## 1. Sleep detection and staging

### SleepStageEstimator (portable, confirmed) — `util/sleep/SleepStageEstimator.kt`
Pipeline: minute grid (duplicates last-wins, gaps filled `UNMEASURABLE`, HR NaN when absent — `MinuteGrid.of` L446–L468; watch-reported AWAKE counts as strong movement L435–L441) → Cole-Kripke sleep/wake (7-tap weights L403, threshold < 8.0, L219–L238) → Webster rescoring, 3 passes until stable (`SleepLabels.kt` L46–L97) → break/block detection (≥45 min non-sleep splits nights; block ≥180 min wide, ≥150 sleep minutes, onset/end runs ≥10 min — L241–L283) → staging per minute (`StageFeatures.of` L483–L540): deviation = smoothed HR − local median baseline; variability = local HR SD normalised by median sleeping SD; movement = ±2-min activity sum. Scores: `deep = -deviation - 0.5·variability + (0.5 - 1.0·position) - 0.6·moving`; `rem = +deviation + 0.5·variability + (-0.6 + 1.2·position) - 0.4·moving`; REM suppressed first 60 min, deep suppressed 10 min after ≥3-min wake (`decide` L324–L366) → adaptive sanity loop (deep share outside 10–25 % nudges deepThreshold ±0.1; REM outside 15–30 % similarly; max 8 iterations — L286–L322) → smoothing (deep/REM runs <5 min → light; ≤2-min light slivers bridged — L369–L386).

Pure Kotlin: only `java.time.Instant`, `kotlin.math.sqrt`. No Android, no DB. Behavioural tests exist and are worth porting (`app/src/test/.../SleepStageEstimatorTest.kt`).

Huami input adapter: movement = `rawIntensity / 8f`; `TYPE_NONWEAR`/`TYPE_CHARGING` → `UNMEASURABLE` (`devices/huami/HuamiEstimatedSleepSessionProvider.kt` L43–L56). The `/8` is a fitted constant — tunable.

### estimateSettled — incremental re-estimation (same file, L151–L186)
Returns only the zone bounded by long breaks; leaves `LABEL_REACH_MINUTES = 150` unsettled at open edges, because Cole-Kripke+Webster can propagate 148 min backward / 89 min forward. Key architectural detail for incremental ingestion: re-estimate only the settled zone, never the whole stream.

### SleepSessionSegmenter (portable) — `devices/SleepSessionSegmenter.java`
Session opens on first sleep kind; closes on non-sleep sample with `steps > 0` or >60 min non-sleep; sessions ≤5 min dropped; last stage extended 60 s for non-zero duration (L36–L131).

### Vendor stage sanitizing (portable) — `devices/SleepSessionProvider.kt`
`sanitizeStages` clips stages to next start, drops fully-overlapping, merges touching same-kind, pads pre-onset gap with LIGHT (L43–L88). `groupIntoSessions` splits on any gap (L90–L140). `getSleepSessionsEndingIn` attributes sleep to the **wake day** (L21–L26).

Vendor revision handling: `HuamiSleepSessionProvider` removes stored sessions time-overlapping a new candidate before windowing (L40–L47); Huami stage end minutes are **inclusive** → `(end + 1) * 60` (L31–L33).

## 2. Stress / HRV

### Huawei HRV math (portable; coefficients Huawei-fitted) — `devices/huawei/stress/HuaweiStressHRVCalculation.java`
- 3-stage RR outlier rejection (L34–L77): reject 400–1400 ms; reject ±20 % of mean; reject ≥20 % different from previous accepted beat.
- Time domain (L92–L205): mean HR, SDNN, RMSSD, pNN50, SD-HR, range, median NNI (20 ms histogram), normalised variance.
- Frequency domain (L207–L367): 2 Hz resample, linear detrend, Hann window, radix-2 FFT → VLF/LF/HF PSD.
- Explicit feature vector (L750–L761): `[medianNNICount, sdHR, rangeNNI, pVLF%, rmsSD, medianNNI, normVar, hfPsd, lfPsd, pLF%]` with plausibility guards.
- Quality gate (L767–L826): recording 50–70 s, 30–210 RRs, SQI == 100 only, derived SQI ≥ 0.2.

Score: `HuaweiStressScoreCalculation.java` — logistic z-score model, clamp 0–7 → `1.5 + 14·score` clamp 15–90 (L5–L44). Calibration = 80/20 blend toward user calibration score, input clamped 40–70 (L46–L51). Treat coefficients as opaque constants.

### HRV baseline/status engine (portable) — `devices/ComputedHrvSummarySampleProvider.java`
7-day rolling average (L148–L151); last night = last sleep session starting in noon→noon window, average + highest rolling 5-sample average (L153–L246); baseline = mean ± 1 SD of last 28 overnight averages, "poor" at mean − 1.5 SD (L248–L335); status POOR/LOW/BALANCED/UNBALANCED (L337–L355); **no baseline until ≥7 overnight samples** (L301–L305).

### Stress aggregation (portable) — `widgets/impl/StressData.kt`
`computeStress`: averages only `stress > 0`, optional trailing window, time-in-zone `+60 s` per sample (L85–L151). Assumes one sample = one minute.

## 3. Activity classification / intensity / calories

### StepAnalysis (portable) — `activities/charts/StepAnalysis.java`
Recorded-workout samples excluded from segmentation but counted in daily totals (L50–L74). Thresholds: min session 5 min, max idle 5 min, min steps/min 40 (L78–L83). Active minute: `steps > 40` or (`intensity > 0.40` and `steps > 0`) (L144–L145). Short breaks buffered and re-absorbed; long idle splits session (L163–L194). Kind inference (L286–L299): `spm > 120` → RUNNING; `steps > 200` → WALKING; `avgHR > 90 && intensity > 15` → EXERCISE; else ACTIVITY. Crude baseline; code says "needs tuning".

### ActivityAnalysis (portable) — `activities/charts/ActivityAnalysis.java`
Time attributed per ActivityKind; kind-change intervals split 50/50 between kinds (L87–L95).

### WidgetDataScope totals (portable) — `widgets/WidgetDataScope.kt`
`activeMinutes` = step-session span end−start (L260–L270). `activeCaloriesTotal` sums raw then **÷1000** for kcal (L173–L178 — unit trap). `restingCaloriesTotal` **averages** across devices to avoid double counting (L185–L196). `distanceTotal` falls back to `steps × stepLengthCm` (L154–L166). Multi-device sleep **averaged**, stages averaged per stage (L131–L147).

### Workout aggregation (portable) — `activities/workouts/statistics/StatisticsAggregation.kt`
`WeightedSum(sum, weight)` mergeable partials (L79–L90); `MetricTotals.plus` merges, max for maxima (L116–L136); **pace = 1 / weighted-average-speed** (harmonic mean — correct way to average pace, L153–L162).

## 4. SpO2 / body composition / units

### SpO2 (portable) — `widgets/impl/Spo2Widget.kt`
Daily headline = latest valid sample (`spo2 > 0`) + daily minimum + hourly averages; gauge 80–100; bands ≥95 / ≥90 / else (L44–L143). No averaging of the headline — deliberate "latest + nadir".

### Body composition (portable) — `util/BodyCompositionCalculator.java`
Published equations, not vendor curves: impedance index `h²/R`; FFM (Sun 2003), TBW (Sun), SMM (Janssen 2000), BMR (Katch-McArdle `21.6·FFM + 370`), bone 5.7 %/5.0 % of FFM (L84–L140). Plausibility gates: impedance 200–1200 Ω; reject fat ≤0 or ≥100 %, water out of range, muscle ≥ weight (L43–L44, L96, L130–L133). Non-binary gender = 0.5 blend of male/female equations (L100–L113). `BodyCompositionEstimates.java` recomputes at display using the user profile **as of measurement time**; persists nothing (L50–L88) — derived values not stored, inputs versioned. Header notes it mirrors openScale `StandardImpedanceLib` (GPLv3) — re-implement from the cited papers, don't copy openScale code.

### Units (portable) — `model/WeightUnit.kt`
kg canonical; jin ×2, lb ÷0.45359237, stone = lb÷14 formatted `st lb`, grams below 1 kg. Convert at the edge only.

## 5. Data pipeline patterns

### Sample-provider contract — `devices/SampleProvider.java`, `devices/AbstractSampleProvider.java`
`getAllActivitySamples` guarantees exactly one sample per minute (L213–L237); missing minutes are explicit `UNKNOWN` dummies with `-1` sentinels (L700–L711) — sentinels, not nulls. High-res data is a separate optional channel (`hasHighResData` default false, L95–L104, L239–L251); Huawei downsample = sum steps/calories/distance, take last HR/SpO2, with start/end state markers (`HuaweiSampleProvider.overlayActivitySamples` L379–L470). `fillGaps` never generates future samples (L631–L698). `convertCumulativeSteps` handles counter reset at day boundary, decrease within day (discard sample, keep baseline), and >30 min day-boundary gap (rebase, L286–L399, L498–L519). Garmin samples carry "value up to this instant" → shift timestamps −60 s (`GarminActivitySampleProvider` L87–L115). Sleep overlay projected onto minute samples at read time, clearing intensity unless `keepIntensity` (L720–L757) — one canonical minute timeline + read-time overlays.

### Timezone / DST
Correct patterns: `WidgetHistory.secondOfDay` uses Instant → ZonedDateTime → LocalTime (L110–L113); `SleepRangeUtils` nights are wall-clock days via `Calendar.add(DATE, -1)` (L50–L66); `sameDay` subtracts 1 s so exactly-00:00:00 belongs to the previous day (L621–L629). **Do not copy**: `DailyTotals.getSamplesOfDay` fixed `+24*60*60-1` window — wrong on DST days (L163–L177). Use `LocalDate.atStartOfDay(zone)` + `plusDays(1)`.

### Bucketing — `widgets/WidgetHistory.kt`
`bucketAverages` → `NaN` for empty buckets (not 0) (L31–L45); `minutesPerHour` splits `[from,to)` intervals across local hours (L50–L68); `laneStretches` merges minute stages into hypnogram segments (L74–L88); `latestPerBucket`/`dailyLatest`/`weeklyLatest` (L118–L143); `hoursStarted` = how much of today has happened, so partial-day totals aren't compared to full-day goals (L93–L100).

### Gap-aware averages — `util/TimeWeightedAverageAccumulator.java`
Time-weighted mean; a gap > `maxTimeDiff` contributes `defaultTimeDiff` instead of dominating. Correct answer to "average HR over a day with an unworn afternoon".

### Fetch state machine — `service/devices/huami/HuamiFetcher.java`, `operations/fetch/AbstractFetchOperation.java`, `AbstractRepeatingFetchOperation.java`
One-shot job queue keyed by data type; device marked busy before start, cleared after last (HuamiFetcher L54–L202). Per-operation guards: strictly increasing packet counter, expected byte length, CRC32, ack carries keep-data flag so failed parse doesn't lose source data (AbstractFetchOperation L123–L277). Bounded retry: persist last processed timestamp, re-queue only if progress ≥1 s, <10 rounds, timestamp not in future (AbstractRepeatingFetchOperation L64–L114) — the three guards that prevent infinite sync loops. Per-data-type watermark, default now−100 days (L283–L303).

### Dedupe and identity
Sample dedupe `insertOrReplace` on (device, user, timestamp) — inferred from DAO usage. Sleep-night identity (strongest pattern): `util/healthconnect/syncers/SleepSyncer.kt` — freeze `clientRecordId` on first sight, match later detections by inclusive time overlap, grow span, skip unchanged re-detections (L34–L118). Solves "estimator moved onset 20 min earlier after re-import".

## 6. Workout detection
No auto-detection algorithm exists: `capabilities/WorkoutDetectionCapability.java` is enum flags only; devices do detection. Only derivation: `StepAnalysis.detect_activity_kind`. Borrowable structure: segment first (hysteresis on idle runs), then classify, keep recorded workouts as ground truth excluded from segmentation but included in daily totals.

## 7. Negative findings — do not assume GB computes these
- No RMSSD from raw RR on Huami/Xiaomi: `FetchHrvOperation` stores vendor 0–255 byte (L60–L80). Only Huawei computes real HRV.
- No sleep score computation: `SleepScoreWidget` bands vendor scores only (L90–L94).
- No workout auto-detection algorithm.
- No stress computation for Huami: `FetchStressAutoOperation` stores vendor bytes, bands 0–39/40–59/60–79/80–100 (L60–L80).

## 8. Ranked borrowables for OpenValens
1. `SleepStageEstimator` + `SleepLabels` — port wholesale (pure, deterministic, tested).
2. `estimateSettled` incremental re-estimation (`LABEL_REACH_MINUTES = 150`).
3. Sleep-night identity + overlap dedupe (`SleepSyncer` + `HuamiSleepSessionProvider` + `sanitizeStages`).
4. `WidgetHistory` bucketing primitives (NaN sentinel, DST-correct, `hoursStarted`).
5. `StepAnalysis` session segmentation + kind inference.
6. `AbstractSampleProvider` normalization pipeline (canonical minute timeline, read-time overlays, cumulative→delta, day-boundary rebase).
7. `ComputedHrvSummarySampleProvider` baseline/status engine.
8. Huawei HRV math (3-stage RR rejection + plausibility table; not the coefficients).

Runners-up: `TimeWeightedAverageAccumulator`, 50/50 boundary split, harmonic-mean pace, BIA published equations + gates, multi-device merge policy (sum steps, average sleep/resting kcal).

## 9. Caveats
- Estimator constants fitted to one wearer's device ("three nights of one wearer's Venu SQ", L44–L46) — retune for Helio Strap.
- Noon→noon windows use local `Calendar` — DST-safe for wall-clock windows but "28 days" ≠ 28×24 h elapsed.
- "Active minutes = session span" is a deliberate definition; product fit for OpenValens is a product decision.
- Sample dedupe key inferred from DAO usage, not a read schema constraint.
- Licensing: AGPL-3.0-or-later throughout; port with attribution. BIA equations are from published papers — re-implement from citations rather than copying openScale code.
