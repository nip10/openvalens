/**
 * Local-disk object storage adapter (Issue #62).
 *
 * Objects live under one root directory (`STORAGE_LOCAL_DIR`; the production
 * compose stack mounts the `storage` volume there). Writes are atomic: bytes go
 * to a private temp file inside the root, are fsynced, then renamed into place,
 * so a crash never leaves a half-written object. Directories are created `0700`
 * and files `0600`. Nothing here is ever served directly: downloads go through
 * the server's HMAC-signed route (`signed-url.ts`).
 *
 * Encryption at rest relies on the host or volume (documented in
 * `docs/storage.md`).
 */

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

import {
  assertStorageKey,
  StorageError,
  type ObjectStorage,
  type PutBlobOptions,
  type StoredBlob,
  type StoredBlobHead,
  type StorageStoreIdentity,
} from "../object-storage";

type Sidecar = { contentType: string; sha256: string };

const TEMP_DIR = ".tmp";
const SIDECAR_SUFFIX = ".meta.json";

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown })?.code === "ENOENT";
}

export class LocalObjectStorage implements ObjectStorage {
  readonly provider = "local";
  readonly storeIdentity: StorageStoreIdentity;
  readonly #root: string;

  constructor(rootDir: string) {
    this.#root = resolve(rootDir);
    this.storeIdentity = {
      provider: "local",
      storeId: `v1:${createHash("sha256")
        .update(JSON.stringify({ version: 1, root: this.#root }))
        .digest("hex")}`,
    };
  }

  #path(key: string): string {
    assertStorageKey(key);
    const full = resolve(this.#root, ...key.split("/"));
    // Defense in depth: the key grammar already forbids `..` and separators.
    if (!full.startsWith(this.#root + sep)) throw new StorageError("invalid_key", 0);
    return full;
  }

  async put(key: string, body: Uint8Array, options: PutBlobOptions): Promise<void> {
    const target = this.#path(key);
    const tempDir = join(this.#root, TEMP_DIR);
    const temp = join(tempDir, randomUUID());
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      // The sidecar is written first: an object file never exists without it.
      const sidecar: Sidecar = {
        contentType: options.contentType,
        sha256: options.sha256,
      };
      await writeFile(`${temp}${SIDECAR_SUFFIX}`, JSON.stringify(sidecar), {
        mode: 0o600,
      });
      await rename(`${temp}${SIDECAR_SUFFIX}`, `${target}${SIDECAR_SUFFIX}`);
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      await rm(`${temp}${SIDECAR_SUFFIX}`, { force: true }).catch(() => undefined);
      if (error instanceof StorageError) throw error;
      throw new StorageError("provider_unavailable", 0);
    }
  }

  async #sidecar(path: string): Promise<Sidecar> {
    try {
      return JSON.parse(await readFile(`${path}${SIDECAR_SUFFIX}`, "utf8")) as Sidecar;
    } catch {
      return { contentType: "application/octet-stream", sha256: "" };
    }
  }

  async head(key: string): Promise<StoredBlobHead | null> {
    const path = this.#path(key);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const { contentType } = await this.#sidecar(path);
      return { contentType, size: info.size };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new StorageError("provider_unavailable", 0);
    }
  }

  async get(key: string): Promise<StoredBlob | null> {
    const path = this.#path(key);
    const head = await this.head(key);
    if (head === null) return null;
    const stream = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
    return { body: stream, ...head };
  }

  async delete(key: string): Promise<void> {
    const path = this.#path(key);
    try {
      await rm(path, { force: true });
      await rm(`${path}${SIDECAR_SUFFIX}`, { force: true });
    } catch {
      throw new StorageError("provider_unavailable", 0);
    }
  }

  /** Local disk has no native signing; the server mints an HMAC route instead. */
  async signedGetUrl(): Promise<null> {
    return null;
  }
}
