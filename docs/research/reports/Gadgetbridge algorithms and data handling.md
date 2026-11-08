# Gadgetbridge algorithms and data handling

Research: 2026-11-08. Source notes: [gadgetbridge-algorithms.md](../notes/Gadgetbridge%20algorithms%20and%20data%20handling/gadgetbridge-algorithms.md). Pinned upstream revision `8976702fc3d00e6008c91fe994668cb4027f7bc2`; all claims verified against that source.

## Purpose

Identify algorithms and data-handling techniques from Gadgetbridge worth borrowing for OpenValens' direct-device program, independently of which device families are integrated ([Issues #419–#430](https://github.com/nip10/openvalens/issues)).

## Findings

Gadgetbridge's most valuable assets are not device protocols but a set of pure, deterministic, tested health-data algorithms:

1. **Sleep stage estimation from movement + heart rate** (`SleepStageEstimator`): Cole-Kripke sleep/wake → Webster rescoring → HR-relative light/deep/REM staging → adaptive sanity loop → smoothing. Pure Kotlin, no Android dependencies, with behavioural tests. Directly applicable when a strap reports only raw minute samples.
2. **Incremental re-estimation** (`estimateSettled`): a label can depend on ~148 minutes of surrounding context, so only the "settled" zone of a night is re-estimated on each sync — the key to incremental ingestion without recomputing whole nights.
3. **Sleep-night identity and overlap dedupe**: freeze a record ID on first detection, grow it on overlapping re-detections, skip unchanged. Prevents duplicate or orphaned nights when an estimator shifts onset.
4. **Time-series primitives**: NaN-for-empty bucketing, DST-correct local-day boundaries, interval→hour splitting, hypnogram lane merging, latest-per-day, and "hours elapsed today" for partial-day comparisons.
5. **Step-session segmentation and activity-kind inference**: hysteresis on idle runs, buffered short breaks, recorded workouts excluded from segmentation but included in daily totals.
6. **Canonical minute timeline**: exactly one sample per minute with explicit `-1` sentinels, cumulative counters converted to deltas with day-boundary rebasing, sleep overlays applied at read time.
7. **HRV baseline/status engine**: 7-day rolling average, 28-night mean±SD baseline, four status levels, and a minimum-samples guard before any baseline is shown.
8. **Real HRV mathematics** (Huawei path only): 3-stage RR outlier rejection, SDNN/RMSSD/pNN50, frequency-domain analysis, explicit plausibility gates. Coefficients are Huawei-fitted and must not be reused as universal constants.

Equally important are the **negative findings**: Gadgetbridge does not compute RMSSD on the Huami path (vendor byte stored as-is), does not compute sleep scores (vendor value banded only), and has no workout auto-detection algorithm. Any OpenValens feature assuming upstream computation in these areas would be built on a false premise.

## Recommendation

Port items 1–4 first (sleep estimator + settled-zone API, night identity, bucketing primitives): they are pure, tested, and independent of which device family ships next. Treat estimator constants as tunable — upstream fitted them on one wearer's device. All ported code keeps AGPL-3.0-or-later with attribution, per [DATA-LICENSES.md](../../DATA-LICENSES.md) conventions.
