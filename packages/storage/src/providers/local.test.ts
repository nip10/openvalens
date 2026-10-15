import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildObjectKey, newObjectId } from "../keys";
import { StorageError } from "../object-storage";
import { LocalObjectStorage } from "./local";

const roots: string[] = [];
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ov-storage-"));
  roots.push(root);
  return root;
}
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

const bytes = new TextEncoder().encode("synthetic object bytes");
const opts = { contentType: "image/png", sha256: "c".repeat(64) };

describe("LocalObjectStorage", () => {
  test("put/head/get/delete round trip", async () => {
    const storage = new LocalObjectStorage(await freshRoot());
    const key = buildObjectKey("org-a", newObjectId());
    expect(await storage.head(key)).toBeNull();
    expect(await storage.get(key)).toBeNull();

    await storage.put(key, bytes, opts);
    expect(await storage.head(key)).toEqual({ contentType: "image/png", size: bytes.byteLength });
    const blob = await storage.get(key);
    expect(new Uint8Array(await new Response(blob!.body).arrayBuffer())).toEqual(bytes);

    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
    await storage.delete(key); // idempotent
  });

  test("files are private (0600) and writes leave no temp files", async () => {
    const root = await freshRoot();
    const storage = new LocalObjectStorage(root);
    const key = buildObjectKey("org-a", newObjectId());
    await storage.put(key, bytes, opts);
    expect((await stat(join(root, ...key.split("/")))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "org"))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  test("overwrites atomically replace the object", async () => {
    const storage = new LocalObjectStorage(await freshRoot());
    const key = buildObjectKey("org-a", newObjectId());
    await storage.put(key, bytes, opts);
    await storage.put(key, new Uint8Array([9]), { ...opts, contentType: "image/jpeg" });
    expect(await storage.head(key)).toEqual({ contentType: "image/jpeg", size: 1 });
  });

  test("objects persist across adapter instances (container restarts)", async () => {
    const root = await freshRoot();
    const key = buildObjectKey("org-a", newObjectId());
    await new LocalObjectStorage(root).put(key, bytes, opts);
    expect((await new LocalObjectStorage(root).head(key))?.size).toBe(bytes.byteLength);
  });

  test("keys cannot escape the root", async () => {
    const storage = new LocalObjectStorage(await freshRoot());
    for (const bad of ["../escape", "org/../../etc/passwd", "/etc/passwd", "a/b.meta.json"]) {
      const error = await storage.put(bad, bytes, opts).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).category).toBe("invalid_key");
    }
  });

  test("an unwritable root is a typed, value-free error", async () => {
    const root = await freshRoot();
    const file = join(root, "not-a-dir");
    await Bun.write(file, "x");
    const storage = new LocalObjectStorage(file);
    const error = (await storage
      .put(buildObjectKey("org-a", newObjectId()), bytes, opts)
      .catch((e: unknown) => e)) as StorageError;
    expect(error).toBeInstanceOf(StorageError);
    expect(error.category).toBe("provider_unavailable");
    expect(error.message).not.toContain(root);
  });
});
