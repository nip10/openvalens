import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";

import { exportSubjectPhotoFiles, type SubjectPhotoReader } from "./photo-export";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const subject = { userId: "subject", organizationIds: [] };

function database(bytes: Uint8Array): Database {
  let calls = 0;
  return {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        execute: async () => {
          calls++;
          if (calls <= 1) return { rows: [] };
          if (calls === 2)
            return {
              rows: [
                {
                  id: ID,
                  content_type: "image/jpeg",
                  size_bytes: bytes.byteLength,
                  sha256: createHash("sha256").update(bytes).digest("hex"),
                },
              ],
            };
          return { rows: [] };
        },
      }),
  } as unknown as Database;
}

function reader(body: ReadableStream<Uint8Array>, bytes: Uint8Array): SubjectPhotoReader {
  return {
    maxObjectBytes: 1024,
    async getSubjectPhoto() {
      return {
        object: {
          id: ID,
          contentType: "image/jpeg",
          sizeBytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
        body,
      };
    },
  };
}

describe("photo export abort handling", () => {
  test("aborting a stalled body cancels its reader and rejects with AbortError", async () => {
    const bytes = new Uint8Array();
    const controller = new AbortController();
    let started!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let canceled = false;
    const body = {
      getReader() {
        return {
          read() {
            started();
            return new Promise<never>(() => {});
          },
          async cancel() {
            canceled = true;
          },
        };
      },
    } as unknown as ReadableStream<Uint8Array>;
    const generator = exportSubjectPhotoFiles(
      database(bytes),
      reader(body, bytes),
      subject,
      new Date(),
      {
        signal: controller.signal,
      },
    );
    const next = generator.next();
    await readStarted;
    controller.abort();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
    expect(canceled).toBe(true);
  });

  test("abort after the last file cannot yield a complete manifest", async () => {
    const bytes = new TextEncoder().encode("photo");
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(bytes);
        stream.close();
      },
    });
    const generator = exportSubjectPhotoFiles(
      database(bytes),
      reader(body, bytes),
      subject,
      new Date(),
      {
        signal: controller.signal,
      },
    );
    const file = await generator.next();
    expect(file.value?.kind).toBe("file");
    controller.abort();
    await expect(generator.next()).rejects.toMatchObject({ name: "AbortError" });
  });
});
