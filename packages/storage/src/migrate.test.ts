import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildObjectKey, newObjectId } from "./keys";
import { migrateObjects, type MigrationItem } from "./migrate";
import type { ObjectStorage } from "./object-storage";
import { LocalObjectStorage } from "./providers/local";

const roots: string[] = [];
async function storage(): Promise<LocalObjectStorage> {
  const root = await mkdtemp(join(tmpdir(), "ov-migrate-"));
  roots.push(root);
  return new LocalObjectStorage(root);
}
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function seed(source: LocalObjectStorage, n: number): Promise<MigrationItem[]> {
  const items: MigrationItem[] = [];
  for (let i = 0; i < n; i++) {
    const id = newObjectId();
    const bytes = new TextEncoder().encode(`synthetic object ${i}`);
    const item = {
      id,
      storageKey: buildObjectKey("org-a", id),
      sha256: sha(bytes),
      contentType: "image/png",
    };
    await source.put(item.storageKey, bytes, item);
    items.push(item);
  }
  return items;
}

describe("migrateObjects", () => {
  test("dry run reports counts and writes nothing", async () => {
    const [source, target] = [await storage(), await storage()];
    const items = await seed(source, 3);
    const report = await migrateObjects({ source, target, items, dryRun: true });
    expect(report).toEqual({ dryRun: true, total: 3, skipped: 0, copied: 3, failed: [] });
    for (const item of items) expect(await target.head(item.storageKey)).toBeNull();
  });

  test("copies with checksum verification, is idempotent, and keeps the source", async () => {
    const [source, target] = [await storage(), await storage()];
    const items = await seed(source, 3);
    expect(await migrateObjects({ source, target, items, dryRun: false })).toEqual({
      dryRun: false,
      total: 3,
      skipped: 0,
      copied: 3,
      failed: [],
    });
    expect(await migrateObjects({ source, target, items, dryRun: false })).toEqual({
      dryRun: false,
      total: 3,
      skipped: 3,
      copied: 0,
      failed: [],
    });
    for (const item of items) {
      expect(await source.head(item.storageKey)).not.toBeNull();
      expect((await target.head(item.storageKey))?.contentType).toBe("image/png");
    }
  });

  test("missing or corrupt sources are reported, never copied", async () => {
    const [source, target] = [await storage(), await storage()];
    const [good, corrupt] = await seed(source, 2);
    const missing = {
      ...good!,
      id: newObjectId(),
      storageKey: buildObjectKey("org-a", newObjectId()),
    };
    const report = await migrateObjects({
      source,
      target,
      items: [good!, { ...corrupt!, sha256: "0".repeat(64) }, missing],
      dryRun: false,
    });
    expect(report.copied).toBe(1);
    expect(report.failed).toEqual([
      { id: corrupt!.id, reason: "source_checksum" },
      { id: missing.id, reason: "source_missing" },
    ]);
    expect(await target.head(corrupt!.storageKey)).toBeNull();
  });

  test("managed photos are refused before source or target I/O", async () => {
    const source = await storage();
    const target = await storage();
    let sourceCalls = 0;
    let targetCalls = 0;
    const count = (adapter: LocalObjectStorage, hit: () => void): ObjectStorage => ({
      provider: adapter.provider,
      storeIdentity: adapter.storeIdentity,
      put: async (...args) => {
        hit();
        return adapter.put(...args);
      },
      get: async (...args) => {
        hit();
        return adapter.get(...args);
      },
      head: async (...args) => {
        hit();
        return adapter.head(...args);
      },
      delete: async (...args) => {
        hit();
        return adapter.delete(...args);
      },
      signedGetUrl: async () => adapter.signedGetUrl(),
    });
    const report = await migrateObjects({
      source: count(source, () => {
        sourceCalls += 1;
      }),
      target: count(target, () => {
        targetCalls += 1;
      }),
      items: [
        {
          id: "photo-id",
          storageKey: "org/org-a/photo-id",
          sha256: "0".repeat(64),
          contentType: "image/jpeg",
          photoState: "ready",
        },
      ],
      dryRun: false,
    });
    expect(report.failed).toEqual([{ id: "photo-id", reason: "managed_photo" }]);
    expect(sourceCalls).toBe(0);
    expect(targetCalls).toBe(0);
  });
});
