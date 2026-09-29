import assert from "node:assert/strict";
import test from "node:test";

import {
  countActiveSchedules,
  deriveChangeHistory,
  isLiveScheduleStatus,
  isScheduleActiveToday,
  reshapeSupplementList,
} from "./derived";
import type { SupplementChange, SupplementSchedule } from "./types";

const today = "2026-03-07";

function change(overrides: Partial<SupplementChange> = {}): SupplementChange {
  return {
    id: 1,
    organizationId: "org-1",
    date: "2026-03-01",
    supplementId: 1,
    changeType: "added",
    reason: null,
    details: null,
    ...overrides,
  };
}

test("isScheduleActiveToday returns true only for active status", () => {
  assert.equal(isScheduleActiveToday({ status: "active" }, today), true);
  assert.equal(isScheduleActiveToday({ status: "paused" }, today), false);
  assert.equal(isScheduleActiveToday({ status: "stopped" }, today), false);
});

test("countActiveSchedules counts only active rows", () => {
  assert.equal(
    countActiveSchedules([
      { status: "active" },
      { status: "paused" },
      { status: "active" },
      { status: "stopped" },
    ]),
    2,
  );
  assert.equal(countActiveSchedules([]), 0);
});

test("deriveChangeHistory sorts by date desc then id desc (stable)", () => {
  const history = deriveChangeHistory([
    change({ id: 1, date: "2026-03-01" }),
    change({ id: 2, date: "2026-03-07" }),
    change({ id: 3, date: "2026-03-07" }),
    change({ id: 4, date: "2026-03-05" }),
  ]);

  assert.deepEqual(
    history.map((row) => row.id),
    [3, 2, 4, 1],
  );
});

test("deriveChangeHistory is stable on repeated runs", () => {
  const input = [
    change({ id: 1, date: "2026-03-01" }),
    change({ id: 2, date: "2026-03-07" }),
    change({ id: 3, date: "2026-03-05" }),
  ];
  const first = deriveChangeHistory(input).map((row) => row.id);
  const second = deriveChangeHistory(input).map((row) => row.id);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [2, 3, 1]);
});

test("reshapeSupplementList picks the latest change per supplement", () => {
  const supplements = [
    { id: 1, name: "Magnesium", dose: "400mg", form: "capsule", category: "mineral" },
    { id: 2, name: "Creatine", dose: "5g", form: "powder", category: "amino acid" },
  ];

  const changesBySupplementId = new Map<number, SupplementChange[]>();
  changesBySupplementId.set(1, [
    change({ id: 1, date: "2026-03-01", reason: "Folate cofactor" }),
    change({ id: 2, date: "2026-03-05", reason: "Bump for sleep" }),
  ]);
  // No changes for supplement 2.

  const schedulesBySupplementId = new Map<number, Array<Pick<SupplementSchedule, "status">>>();
  schedulesBySupplementId.set(1, [{ status: "active" }, { status: "paused" }]);
  schedulesBySupplementId.set(2, [{ status: "active" }]);

  const items = reshapeSupplementList(supplements, changesBySupplementId, schedulesBySupplementId);

  assert.equal(items.length, 2);
  assert.equal(items[0]!.latestChangeReason, "Bump for sleep");
  assert.equal(items[0]!.latestChangeDate, "2026-03-05");
  assert.equal(items[0]!.activeScheduleCount, 1);
  assert.equal(items[1]!.latestChangeReason, null);
  assert.equal(items[1]!.latestChangeDate, null);
  assert.equal(items[1]!.activeScheduleCount, 1);
});

test("reshapeSupplementList handles empty change/schedule maps", () => {
  const items = reshapeSupplementList(
    [{ id: 1, name: "Zinc", dose: "30mg", form: null, category: null }],
    new Map(),
    new Map(),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]!.latestChangeReason, null);
  assert.equal(items[0]!.activeScheduleCount, 0);
});

test("isLiveScheduleStatus returns true only for active", () => {
  assert.equal(isLiveScheduleStatus("active"), true);
  assert.equal(isLiveScheduleStatus("paused"), false);
  assert.equal(isLiveScheduleStatus("stopped"), false);
});
