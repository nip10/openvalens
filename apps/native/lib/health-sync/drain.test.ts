import { describe, expect, test } from "bun:test";
import type {
  IngestBatchInput,
  MobileHealthRecordInput,
} from "@openhealth/api/contracts/mobile-ingest";

import { splitIntoBatches } from "./batching";
import { drainHealthChanges, type ChangesPage, type CursorState, type DrainDeps } from "./drain";
import type { MobileRecordType } from "./map-health-connect";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const DAY = 86_400_000;

function weight(id: string, at = "2026-09-30T07:00:00.000Z"): MobileHealthRecordInput {
  return { type: "weight", externalRecordId: id, sourceApp: "scale", startTime: at, valueKg: 70 };
}

type FakeOptions = {
  granted?: MobileRecordType[];
  windows?: Record<string, MobileHealthRecordInput[]>; // key: from ISO
  changes?: Record<string, ChangesPage>; // key: token
  failSend?: (batch: IngestBatchInput, call: number) => Error | null;
  cursors?: Partial<Record<MobileRecordType, CursorState>>;
};

function fake(options: FakeOptions = {}) {
  const cursors = new Map(Object.entries(options.cursors ?? {})) as Map<
    MobileRecordType,
    CursorState
  >;
  const sent: IngestBatchInput[] = [];
  const reads: string[] = [];
  let tokenCounter = 0;
  let calls = 0;
  const deps: DrainDeps = {
    deviceId: "6f1c2a3e-9b2d-4c1e-8f3a-2d7e5b9c0a11",
    provider: "health_connect",
    clientTimezone: "Europe/Lisbon",
    now: () => NOW,
    source: {
      grantedTypes: async () => options.granted ?? ["weight"],
      captureToken: async () => `token-${++tokenCounter}`,
      readWindow: async (type, from, to) => {
        reads.push(`${type}:${from.toISOString()}..${to.toISOString()}`);
        return options.windows?.[from.toISOString()] ?? [];
      },
      getChanges: async (_type, token) => {
        const page = options.changes?.[token];
        if (!page) throw new Error(`unexpected token ${token}`);
        return page;
      },
    },
    cursors: {
      get: async (type) => cursors.get(type) ?? null,
      set: async (type, state) => void cursors.set(type, state),
    },
    send: async (batch) => {
      const error = options.failSend?.(batch, ++calls);
      if (error) throw error;
      sent.push(batch);
    },
  };
  return { deps, cursors, sent, reads };
}

describe("splitIntoBatches", () => {
  test("caps records per batch and keeps order", () => {
    const records = Array.from({ length: 2500 }, (_, i) => weight(`w-${i}`));
    const batches = splitIntoBatches(records, [], { maxRecords: 1000, maxBytes: 10_000_000 });
    expect(batches.map((b) => b.upserts.length)).toEqual([1000, 1000, 500]);
    expect(batches[1]!.upserts[0]!.externalRecordId).toBe("w-1000");
  });

  test("caps serialized size per batch", () => {
    const records = Array.from({ length: 10 }, (_, i) => weight(`w-${i}`));
    const size = JSON.stringify(records[0]).length;
    const batches = splitIntoBatches(records, [], { maxRecords: 1000, maxBytes: size * 3 + 10 });
    expect(batches.every((b) => b.upserts.length <= 3)).toBe(true);
    expect(batches.flatMap((b) => b.upserts)).toHaveLength(10);
  });

  test("splits heart-rate records over the 5000-sample cap, keeping the record id", () => {
    const samples = Array.from({ length: 12_000 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
      bpm: 60,
    }));
    const hr: MobileHealthRecordInput = {
      type: "heart_rate",
      externalRecordId: "hr-1",
      sourceApp: null,
      startTime: samples[0]!.time,
      endTime: samples.at(-1)!.time,
      samples,
    };
    const parts = splitIntoBatches([hr], [], { maxRecords: 1000, maxBytes: 100_000_000 }).flatMap(
      (b) => b.upserts,
    );
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.type === "heart_rate" && p.externalRecordId === "hr-1")).toBe(true);
    expect(parts.map((p) => (p.type === "heart_rate" ? p.samples.length : 0))).toEqual([
      5000, 5000, 2000,
    ]);
  });

  test("deletions are batched too, after upserts", () => {
    const deletions = Array.from({ length: 1200 }, (_, i) => ({ externalRecordId: `d-${i}` }));
    const batches = splitIntoBatches([weight("w")], deletions, {
      maxRecords: 1000,
      maxBytes: 10_000_000,
    });
    expect(batches.map((b) => [b.upserts.length, b.deletions.length])).toEqual([
      [1, 999],
      [0, 201],
    ]);
  });
});

describe("drainHealthChanges", () => {
  test("first run captures a token before backfilling 30 days, then switches to changes", async () => {
    const day29 = new Date(NOW.getTime() - DAY).toISOString();
    const { deps, cursors, sent, reads } = fake({ windows: { [day29]: [weight("w-1")] } });
    const summary = await drainHealthChanges(deps, { maxBatches: 100 });
    expect(reads).toHaveLength(30);
    expect(reads[0]).toBe(
      `weight:${new Date(NOW.getTime() - 30 * DAY).toISOString()}..${new Date(NOW.getTime() - 29 * DAY).toISOString()}`,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      schemaVersion: 1,
      recordType: "weight",
      mode: "backfill",
      window: { from: day29, to: NOW.toISOString() },
      upserts: [{ externalRecordId: "w-1" }],
    });
    // The token captured before reading, so nothing changed during backfill is missed.
    expect(cursors.get("weight")).toEqual({
      phase: "changes",
      changesToken: "token-1",
      lastAckedAt: NOW.toISOString(),
    });
    expect(summary.types.weight).toMatchObject({ status: "ok", batchesSent: 1 });
  });

  test("a failed send keeps the backfill position, and the retry resends the identical batch", async () => {
    const day29 = new Date(NOW.getTime() - DAY).toISOString();
    let fail = true;
    const { deps, cursors, sent } = fake({
      windows: { [day29]: [weight("w-1")] },
      failSend: () => (fail ? new Error("network") : null),
    });
    const first = await drainHealthChanges(deps, { maxBatches: 100 });
    expect(first.types.weight).toMatchObject({ status: "error", errorCode: "SEND_FAILED" });
    expect(cursors.get("weight")).toMatchObject({ phase: "backfill", next: day29 });
    fail = false;
    await drainHealthChanges(deps, { maxBatches: 100 });
    expect(sent).toHaveLength(1);
    expect(cursors.get("weight")).toMatchObject({ phase: "changes" });
  });

  test("changes are sent, then the token advances; a failure leaves the token", async () => {
    const page: ChangesPage = {
      upserts: [weight("w-2")],
      deletions: [{ externalRecordId: "w-0" }],
      nextToken: "t-2",
      hasMore: false,
      expired: false,
    };
    const cursor: CursorState = {
      phase: "changes",
      changesToken: "t-1",
      lastAckedAt: "2026-09-30T00:00:00.000Z",
    };
    const failing = fake({
      cursors: { weight: cursor },
      changes: { "t-1": page },
      failSend: () => new Error("500"),
    });
    await drainHealthChanges(failing.deps, { maxBatches: 10 });
    expect(failing.cursors.get("weight")).toEqual(cursor);

    const ok = fake({ cursors: { weight: cursor }, changes: { "t-1": page } });
    await drainHealthChanges(ok.deps, { maxBatches: 10 });
    expect(ok.sent[0]).toMatchObject({ mode: "changes", deletions: [{ externalRecordId: "w-0" }] });
    expect(ok.cursors.get("weight")).toEqual({
      phase: "changes",
      changesToken: "t-2",
      lastAckedAt: NOW.toISOString(),
    });
  });

  test("follows hasMore pages within one run", async () => {
    const cursor: CursorState = {
      phase: "changes",
      changesToken: "t-1",
      lastAckedAt: NOW.toISOString(),
    };
    const { deps, cursors, sent } = fake({
      cursors: { weight: cursor },
      changes: {
        "t-1": {
          upserts: [weight("a")],
          deletions: [],
          nextToken: "t-2",
          hasMore: true,
          expired: false,
        },
        "t-2": {
          upserts: [weight("b")],
          deletions: [],
          nextToken: "t-3",
          hasMore: false,
          expired: false,
        },
      },
    });
    await drainHealthChanges(deps, { maxBatches: 10 });
    expect(sent).toHaveLength(2);
    expect(cursors.get("weight")).toMatchObject({ changesToken: "t-3" });
  });

  test("an empty changes page advances the token without sending", async () => {
    const cursor: CursorState = {
      phase: "changes",
      changesToken: "t-1",
      lastAckedAt: "2026-09-30T00:00:00.000Z",
    };
    const { deps, cursors, sent } = fake({
      cursors: { weight: cursor },
      changes: {
        "t-1": { upserts: [], deletions: [], nextToken: "t-2", hasMore: false, expired: false },
      },
    });
    await drainHealthChanges(deps, { maxBatches: 10 });
    expect(sent).toHaveLength(0);
    expect(cursors.get("weight")).toMatchObject({ changesToken: "t-2" });
  });

  test("an expired token re-reads from a day before the last ack", async () => {
    const lastAckedAt = new Date(NOW.getTime() - 3 * DAY).toISOString();
    const { deps, reads, cursors } = fake({
      cursors: { weight: { phase: "changes", changesToken: "old", lastAckedAt } },
      changes: {
        old: { upserts: [], deletions: [], nextToken: "", hasMore: false, expired: true },
      },
    });
    await drainHealthChanges(deps, { maxBatches: 100 });
    expect(reads[0]?.startsWith(`weight:${new Date(NOW.getTime() - 4 * DAY).toISOString()}`)).toBe(
      true,
    );
    expect(reads).toHaveLength(4);
    expect(cursors.get("weight")).toMatchObject({ phase: "changes", changesToken: "token-1" });
  });

  test("only types with read permission are processed", async () => {
    const { deps, reads } = fake({ granted: ["steps"] });
    await drainHealthChanges(deps, { maxBatches: 100 });
    expect(reads.every((r) => r.startsWith("steps:"))).toBe(true);
  });

  test("stops at the batch budget and resumes on the next run", async () => {
    const windows: Record<string, MobileHealthRecordInput[]> = {};
    for (let d = 30; d >= 1; d--) {
      const from = new Date(NOW.getTime() - d * DAY).toISOString();
      windows[from] = [weight(`w-${d}`, from)];
    }
    const { deps, sent, cursors } = fake({ windows });
    const first = await drainHealthChanges(deps, { maxBatches: 5 });
    expect(sent).toHaveLength(5);
    expect(first.types.weight).toMatchObject({ status: "budget_exhausted" });
    expect(cursors.get("weight")).toMatchObject({ phase: "backfill" });
    await drainHealthChanges(deps, { maxBatches: 100 });
    expect(sent).toHaveLength(30);
    expect(new Set(sent.map((b) => b.upserts[0]!.externalRecordId)).size).toBe(30);
  });

  test("an auth or revocation error stops every type", async () => {
    const error = Object.assign(new Error("revoked"), { code: "PERMISSION_DENIED" });
    const day29 = new Date(NOW.getTime() - DAY).toISOString();
    const { deps, reads } = fake({
      granted: ["weight", "steps"],
      windows: { [day29]: [weight("w-1")] },
      failSend: () => error,
    });
    const summary = await drainHealthChanges(deps, { maxBatches: 100 });
    expect(summary.fatalErrorCode).toBe("PERMISSION_DENIED");
    expect(reads.some((r) => r.startsWith("steps:"))).toBe(false);
  });
});
