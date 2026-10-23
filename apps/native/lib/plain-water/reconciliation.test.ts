import { describe, expect, test } from "bun:test";
import { englishI18n, inEnglish } from "@openvalens/i18n/testing";

import {
  WATER_COPY,
  buildWaterDayView,
  describeWaterAttention,
  formatWaterSubtotal,
  type WaterDayWire,
} from "@openvalens/api/presenters/plain-water";
import { drain, enqueue, type WaterItem, type WaterStore, type WaterOperation } from "./outbox";

function memoryStore(): WaterStore {
  const rows = new Map<string, WaterItem>();
  return {
    list(scope) {
      return [...rows.values()].filter((item) => item.scope === scope);
    },
    put(item) {
      rows.set(item.id, item);
    },
    remove(_scope, id) {
      rows.delete(id);
    },
    nextSeq() {
      return rows.size + 1;
    },
  };
}

const add: WaterOperation = {
  kind: "add",
  input: {
    clientMutationId: "water-add-1",
    quantity: 250,
    unit: "ml",
    observedAt: "2026-07-01T23:30:00.000Z",
    timeZone: "Europe/Lisbon",
  },
};

function day(date: string, timeZone: string): WaterDayWire {
  return {
    date,
    timeZone,
    label: "Plain water subtotal",
    enabled: true,
    quantityMl: 0,
    personalGoalMl: null,
    entries: [],
  };
}

function project(item: WaterItem, date = "2026-07-01", timeZone = "UTC") {
  return buildWaterDayView(day(date, timeZone), [item], false);
}

describe("outbox to presenter reconciliation", () => {
  test("commit plus lost acknowledgement then later denial remains unknown in attention", async () => {
    const store = memoryStore();
    const queued = enqueue(store, "member", add);
    let committed = false;
    const sender = {
      async add() {
        if (!committed) {
          committed = true;
          throw Object.assign(new Error("lost ack"), { code: "NETWORK" });
        }
        throw Object.assign(new Error("permission changed"), { code: "FORBIDDEN" });
      },
      async change() {
        throw new Error("unexpected");
      },
      async delete() {
        throw new Error("unexpected");
      },
    };
    await drain(store, sender, "member");
    expect(store.list("member")[0]).toMatchObject({ status: "queued", attempts: 1 });
    await drain(store, sender, "member");
    const attention = store.list("member")[0]!;
    expect(attention).toMatchObject({
      status: "needs_attention",
      attempts: 2,
      lastErrorCode: "FORBIDDEN",
    });
    const view = project(attention);
    expect(view.reconciliationUnknown).toBe(true);
    expect(view.subtotalMl).toBeNull();
    expect(view.entryCount).toBe(0);
    expect(formatWaterSubtotal(view, "ml", false, englishI18n)).toBe(
      inEnglish(WATER_COPY.reconciliationUnknown),
    );
    expect(describeWaterAttention(view.attention[0]!, "ml", englishI18n).title).toBe(
      inEnglish(WATER_COPY.reconciliationUnknown),
    );
    expect(attention.id).toBe(queued.id);
  });

  test("crash-recovered syncing row followed by denial remains unknown", async () => {
    const store = memoryStore();
    const item = enqueue(store, "member", add);
    store.put({ ...item, status: "syncing", attempts: 0 });
    await drain(
      store,
      {
        async add() {
          throw Object.assign(new Error("denied after recovery"), { code: "FORBIDDEN" });
        },
        async change() {
          throw new Error("unexpected");
        },
        async delete() {
          throw new Error("unexpected");
        },
      },
      "member",
    );
    const recovered = store.list("member")[0]!;
    expect(recovered).toMatchObject({
      status: "needs_attention",
      attempts: 2,
      lastErrorCode: "FORBIDDEN",
    });
    expect(project(recovered).reconciliationUnknown).toBe(true);
  });

  test("first authoritative rejection proves non-application, while conflict receipt is authoritative", async () => {
    const rejectedStore = memoryStore();
    enqueue(rejectedStore, "member", add);
    await drain(
      rejectedStore,
      {
        async add() {
          throw Object.assign(new Error("denied"), { code: "FORBIDDEN" });
        },
        async change() {
          throw new Error("unexpected");
        },
        async delete() {
          throw new Error("unexpected");
        },
      },
      "member",
    );
    const rejected = rejectedStore.list("member")[0]!;
    expect(rejected.attempts).toBe(1);
    expect(project(rejected).reconciliationUnknown).toBe(false);
    expect(formatWaterSubtotal(project(rejected), "ml", false, englishI18n)).toBe(
      inEnglish(WATER_COPY.empty),
    );
    expect(describeWaterAttention(project(rejected).attention[0]!, "ml", englishI18n).title).toBe(
      inEnglish(WATER_COPY.rejectedTitle),
    );

    const conflictStore = memoryStore();
    enqueue(conflictStore, "member", add);
    await drain(
      conflictStore,
      {
        async add() {
          return {
            outcome: "conflict" as const,
            entry: { id: 77, revision: 2, quantityMl: 250, deleted: false },
          };
        },
        async change() {
          throw new Error("unexpected");
        },
        async delete() {
          throw new Error("unexpected");
        },
      },
      "member",
    );
    const conflict = conflictStore.list("member")[0]!;
    expect(project(conflict).reconciliationUnknown).toBe(false);
    expect(describeWaterAttention(project(conflict).attention[0]!, "ml", englishI18n).title).toBe(
      inEnglish(WATER_COPY.conflictTitle),
    );
  });

  test("missing attempt history fails closed; add grouping uses requested day zone across midnight", () => {
    const store = memoryStore();
    const item = enqueue(store, "member", add);
    const unknown = { ...item, status: "needs_attention" as const, lastErrorCode: "FORBIDDEN" };
    expect(project(unknown).reconciliationUnknown).toBe(true);

    const queued = { ...item, status: "queued" as const, attempts: 0, lastErrorCode: null };
    const utcDay = project(queued, "2026-07-01", "UTC");
    const lisbonDay = project(queued, "2026-07-02", "Europe/Lisbon");
    expect(utcDay.rows).toHaveLength(1);
    expect(lisbonDay.rows).toHaveLength(1);
    expect(utcDay.rows[0]?.timeZone).toBe("Europe/Lisbon");
    expect(lisbonDay.rows[0]?.timeZone).toBe("Europe/Lisbon");

    const uncertain = { ...unknown, attempts: 2 };
    expect(project(uncertain, "2026-07-01", "UTC").reconciliationUnknown).toBe(true);
    expect(project(uncertain, "2026-07-02", "Europe/Lisbon").reconciliationUnknown).toBe(true);
    expect(project(uncertain, "2026-07-02", "UTC").reconciliationUnknown).toBe(false);
  });
});
