/*  Copyright (C) 2020-2024 Petr Vaněk

    This file is part of Gadgetbridge.

    Gadgetbridge is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    Gadgetbridge is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>. */

/**
 * TypeScript port of Gadgetbridge's `StepAnalysis.calculateSummary`.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/charts/StepAnalysis.java`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/activities/charts/StepAnalysis.java
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 *
 * Upstream kept `totalDailySteps` as mutable state set by
 * `calculateStepSessions`; this port takes it as an explicit argument so the
 * summary stays pure. Distance is accumulated with Java's `int += float`
 * semantics: truncate after every addition, not only at the end.
 */

import type { StepSession, StepSummary } from "./types";

/** Aggregates sessions into the upstream summary shape. */
export function summarize(sessions: readonly StepSession[], totalDailySteps: number): StepSummary {
  let durationMillis = 0;
  let steps = 0;
  let distanceMeters = 0;
  let intensity = 0;
  let heartRateTotal = 0;

  for (const session of sessions) {
    durationMillis += session.end - session.start;
    steps += session.steps;
    // Java `int distanceSum += float` truncates on every addition.
    distanceMeters = Math.trunc(distanceMeters + session.distanceMeters);
    heartRateTotal += session.heartRateAverage;
    intensity += session.intensity;
  }

  const heartRateAverage = sessions.length > 0 ? Math.trunc(heartRateTotal / sessions.length) : 0;

  return {
    sessionCount: sessions.length,
    durationSeconds: durationMillis / 1000,
    steps,
    distanceMeters,
    heartRateAverage,
    intensity,
    totalDailySteps,
  };
}
