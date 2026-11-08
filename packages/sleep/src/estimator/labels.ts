/*  Copyright (C) 2026 Manuel Marcatili

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
 * TypeScript port of Gadgetbridge's per-minute sleep/wake labels and Webster
 * rescoring rules.
 *
 * Upstream: `app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepLabels.kt`
 * Source: https://codeberg.org/Freeyourgadget/Gadgetbridge/src/commit/8976702fc3d00e6008c91fe994668cb4027f7bc2/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/util/sleep/SleepLabels.kt
 * Revision: 8976702fc3d00e6008c91fe994668cb4027f7bc2
 * Ported: 2026-11-08
 * Licence: AGPL-3.0-or-later (same as upstream).
 */

/** The per-minute sleep/wake labels the estimator works on. */
export const SleepLabels = {
  SLEEP: "S",
  WAKE: "W",
  GAP: "G",
} as const;

export type SleepLabel = (typeof SleepLabels)[keyof typeof SleepLabels];

export type LabelRun = {
  label: SleepLabel;
  start: number;
  length: number;
};

/** Runs of equal labels over `[from, to)`. */
export function runsOf(labels: readonly SleepLabel[], from = 0, to = labels.length): LabelRun[] {
  const runs: LabelRun[] = [];
  let start = from;
  for (let index = from + 1; index <= to; index += 1) {
    if (index === to || labels[index] !== labels[start]) {
      runs.push({ label: labels[start]!, start, length: index - start });
      start = index;
    }
  }
  return runs;
}

/**
 * Webster's rescoring rules (Webster 1982, as used with Cole-Kripke): the
 * first sleep minutes after a wake run are still wake, and a short sleep
 * run between long wake runs is wake. Passes repeat until stable: a wake
 * run that grew carries over again.
 */
export const WEBSTER_DEFAULT_PASSES = 3;

export function applyWebsterRescoring(
  labels: SleepLabel[],
  passes: number = WEBSTER_DEFAULT_PASSES,
): void {
  for (let pass = 0; pass < passes; pass += 1) {
    const carried = carryOver(labels);
    const bridged = bridge(labels);
    if (!carried && !bridged) return;
  }
}

/** Rule 1: the first sleep minutes after a wake run are still wake. Returns whether anything changed. */
export function carryOver(labels: SleepLabel[]): boolean {
  let changed = false;
  const runs = runsOf(labels);
  for (let position = 0; position < runs.length; position += 1) {
    const run = runs[position]!;
    if (run.label !== SleepLabels.WAKE) continue;
    const next = runs[position + 1];
    if (!next || next.label !== SleepLabels.SLEEP) continue;
    const toWake = run.length >= 15 ? 4 : run.length >= 10 ? 3 : run.length >= 4 ? 1 : 0;
    const end = next.start + Math.min(toWake, next.length);
    for (let index = next.start; index < end; index += 1) {
      labels[index] = SleepLabels.WAKE;
      changed = true;
    }
  }
  return changed;
}

/** Rules 2 and 3: a short sleep run between long wake runs is wake. Returns whether anything changed. */
export function bridge(labels: SleepLabel[]): boolean {
  let changed = false;
  const runs = runsOf(labels);
  for (let position = 0; position < runs.length; position += 1) {
    const run = runs[position]!;
    if (run.label !== SleepLabels.SLEEP) continue;
    const before = runs[position - 1];
    const after = runs[position + 1];
    if (!before || !after) continue;
    if (before.label !== SleepLabels.WAKE || after.label !== SleepLabels.WAKE) continue;
    const bounded = Math.min(before.length, after.length);
    if ((run.length <= 6 && bounded >= 10) || (run.length <= 10 && bounded >= 20)) {
      for (let index = run.start; index < run.start + run.length; index += 1) {
        labels[index] = SleepLabels.WAKE;
        changed = true;
      }
    }
  }
  return changed;
}
