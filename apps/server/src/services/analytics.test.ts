import { describe, expect, test } from "bun:test";

import type { Database } from "@openvalens/db";
import { createAnalyticsService } from "./analytics";

type FakeOptions = {
  enabled?: boolean;
  readError?: Error;
  writeError?: Error;
  captureError?: Error;
};

function fakeDatabase(options: FakeOptions = {}) {
  let stored = options.enabled;
  const writes: boolean[] = [];
  const db = {
    select() {
      const builder: any = {
        from() {
          return builder;
        },
        where() {
          return builder;
        },
        for() {
          return builder;
        },
        limit() {
          if (options.readError) return Promise.reject(options.readError);
          if (options.captureError) return Promise.reject(options.captureError);
          return Promise.resolve(stored === undefined ? [] : [{ enabled: stored }]);
        },
      };
      return builder;
    },
    insert() {
      const builder: any = {
        values(value: { enabled: boolean }) {
          this.value = value;
          return builder;
        },
        onConflictDoUpdate() {
          if (options.writeError) return Promise.reject(options.writeError);
          stored = builder.value.enabled;
          writes.push(builder.value.enabled);
          return Promise.resolve();
        },
      };
      return builder;
    },
    async transaction(callback: (tx: unknown) => Promise<unknown>) {
      if (options.captureError) throw options.captureError;
      return callback(db);
    },
  };
  return { db: db as unknown as Database, writes };
}

function stubFetch(
  handler: (...args: Parameters<typeof fetch>) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: () => {} });
}

const config = { enabled: true, projectToken: "test-project-token", ipCaptureDisabled: true };

describe("analytics service consent persistence", () => {
  test("defaults consent to false and reports a failed preference read", async () => {
    const absent = fakeDatabase();
    const service = createAnalyticsService(
      absent.db,
      config,
      stubFetch(async () => {
        throw new Error("must not fetch");
      }),
    );
    expect(await service.getPreference("actor-a")).toEqual({ enabled: false, available: true });

    const failed = fakeDatabase({ readError: new Error("private database detail") });
    await expect(
      createAnalyticsService(failed.db, config).getPreference("actor-a"),
    ).rejects.toThrow();
  });

  test("does not acknowledge failed writes or failed authoritative readback", async () => {
    const writeFailure = fakeDatabase({ writeError: new Error("private write detail") });
    await expect(
      createAnalyticsService(writeFailure.db, config).setPreference("actor-a", false),
    ).rejects.toThrow();
    expect(writeFailure.writes).toEqual([]);

    let reads = 0;
    const readbackFailure = fakeDatabase({ enabled: true });
    const db = Object.assign(Object.create(readbackFailure.db), {
      select() {
        reads += 1;
        if (reads > 0)
          return {
            from() {
              return this;
            },
            where() {
              return this;
            },
            limit() {
              return Promise.reject(new Error("private read detail"));
            },
          };
        return readbackFailure.db.select();
      },
    }) as Database;
    await expect(
      createAnalyticsService(db, config).setPreference("actor-a", false),
    ).rejects.toThrow();
    expect(readbackFailure.writes).toEqual([false]);
  });

  test("unavailable enablement fails without writing while revocation is allowed", async () => {
    const fake = fakeDatabase({ enabled: true });
    const service = createAnalyticsService(fake.db, { enabled: false, ipCaptureDisabled: false });
    await expect(service.setPreference("actor-a", true)).rejects.toThrow(
      "Analytics is unavailable.",
    );
    expect(fake.writes).toEqual([]);
    expect(await service.setPreference("actor-a", false)).toEqual({
      enabled: false,
      available: false,
    });
  });
});

describe("analytics service provider boundary", () => {
  test("off and unconsented states never call provider; failures are best effort", async () => {
    const noConsent = fakeDatabase();
    let calls = 0;
    const fetch = stubFetch(async () => {
      calls += 1;
      return new Response('{"status":"ok"}');
    });
    expect(
      await createAnalyticsService(noConsent.db, config, fetch).capture(
        "actor-a",
        "preferences_opened",
      ),
    ).toBe(false);
    expect(
      await createAnalyticsService(noConsent.db, { ...config, enabled: false }, fetch).capture(
        "actor-a",
        "preferences_opened",
      ),
    ).toBe(false);
    expect(calls).toBe(0);

    const broken = fakeDatabase({ enabled: true, captureError: new Error("private lock detail") });
    expect(
      await createAnalyticsService(broken.db, config, fetch).capture(
        "actor-a",
        "preferences_opened",
      ),
    ).toBe(false);
    expect(calls).toBe(0);
  });

  test("sends only the approved fixed payload, creates a fresh ID, and never retries", async () => {
    const fake = fakeDatabase({ enabled: true });
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetch = stubFetch(async (input, init) => {
      requests.push({ url: String(input), init: init! });
      return new Response('{"status":"ok"}', { status: 200 });
    });
    const service = createAnalyticsService(fake.db, config, fetch);
    expect(await service.capture("sensitive-user-id", "preferences_opened")).toBe(true);
    expect(await service.capture("sensitive-user-id", "appearance_control_used")).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests.map(({ url }) => url)).toEqual(
      Array(2).fill("https://eu.i.posthog.com/i/v0/e/"),
    );
    const payloads = requests.map(({ init }) => JSON.parse(String(init.body)));
    for (const payload of payloads) {
      expect(Object.keys(payload).sort()).toEqual([
        "api_key",
        "distinct_id",
        "event",
        "properties",
      ]);
      expect(payload).toEqual({
        api_key: "test-project-token",
        event: expect.any(String),
        distinct_id: expect.any(String),
        properties: { $process_person_profile: false },
      });
      expect(payload.distinct_id).not.toContain("sensitive-user-id");
      expect(requests[0]!.init.headers).toEqual({ "content-type": "application/json" });
    }
    expect(new Set(payloads.map((payload) => payload.distinct_id)).size).toBe(2);
  });

  test("rejects non-200, oversized and malformed acknowledgements without retry", async () => {
    const fake = fakeDatabase({ enabled: true });
    let calls = 0;
    const responses = [
      new Response("not acknowledged", { status: 500 }),
      new Response("x".repeat(129), { status: 200 }),
      new Response("not-json", { status: 200 }),
    ];
    const service = createAnalyticsService(
      fake.db,
      config,
      stubFetch(async () => {
        calls += 1;
        return responses.shift()!;
      }),
    );
    expect(await service.capture("actor-a", "preferences_opened")).toBe(false);
    expect(await service.capture("actor-a", "preferences_opened")).toBe(false);
    expect(await service.capture("actor-a", "preferences_opened")).toBe(false);
    expect(calls).toBe(3);
  });
});
