import { describe, expect, test } from "bun:test";
import { wellnessProfileQueryKey } from "@openvalens/api/presenters/wellness-profile";
import {
  EMPTY_WELLNESS_PROFILE,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { QueryClient } from "@tanstack/react-query";

import { createProfileWriter } from "./profile-writes";

const USER = "user-a";
const KEY = wellnessProfileQueryKey(USER);
const adult = { state: "recorded", value: "adult" } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

/** The server's optimistic-concurrency check: a write must name the stored revision. */
function fakeServer() {
  let stored: WellnessProfileSnapshot = { ...EMPTY_WELLNESS_PROFILE };
  const writes: WellnessProfileUpdateInput[] = [];
  let gate: Promise<void> | null = null;
  return {
    writes,
    read: () => ({ ...stored }),
    /** Holds the next write's reply (not its commit) until `release`. */
    holdNextReply() {
      const held = deferred();
      gate = held.promise;
      return held.resolve;
    },
    async update(input: WellnessProfileUpdateInput): Promise<WellnessProfileSnapshot> {
      writes.push(input);
      if (input.expectedRevision !== stored.revision) {
        throw Object.assign(new Error("Conflict"), { code: "CONFLICT" });
      }
      const { expectedRevision: _, consents: __, ...patch } = input;
      stored = { ...stored, ...patch, revision: stored.revision + 1 };
      const reply = { ...stored };
      const wait = gate;
      gate = null;
      if (wait) await wait;
      return reply;
    },
  };
}

function setup() {
  const server = fakeServer();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(KEY, server.read());
  const writer = createProfileWriter({
    queryClient,
    userId: USER,
    update: (input) => server.update(input),
  });
  return { server, queryClient, writer };
}

describe("first-run profile writes", () => {
  test("a refetch that read the profile before the mark landed cannot bring its revision back", async () => {
    const { server, queryClient, writer } = setup();
    // Opening screen 1 refetches the profile Today loaded (revision 0) and,
    // at the same time, marks the first run as started (revision 1). The
    // refetch reads first but its reply arrives last.
    const late = deferred();
    const refetch = queryClient
      .fetchQuery({
        queryKey: KEY,
        queryFn: async () => {
          const read = server.read();
          await late.promise;
          return read;
        },
      })
      .catch(() => undefined);
    await Promise.resolve();

    expect((await writer.markStarted())?.revision).toBe(1);
    late.resolve();
    await refetch;
    expect(queryClient.getQueryData<WellnessProfileSnapshot>(KEY)?.revision).toBe(1);

    // "Yes, I'm 18 or older", then Continue.
    const saved = await writer.save({ eligibility: adult });
    expect(saved?.revision).toBe(2);
    expect(server.writes.map((write) => write.expectedRevision)).toEqual([0, 1]);
  });

  test("Continue while the mark is still on its way waits for it", async () => {
    const { server, writer } = setup();
    const release = server.holdNextReply();
    const marked = writer.markStarted();
    const saved = writer.save({ eligibility: adult });
    await Promise.resolve();
    release();

    expect((await marked)?.revision).toBe(1);
    const result = await saved;
    expect(result?.revision).toBe(2);
    expect(result?.eligibility).toEqual(adult);
    expect(result?.setupStatus).toBe("in_progress");
  });

  test("a failed write does not block the next one", async () => {
    const { queryClient, writer } = setup();
    queryClient.setQueryData(KEY, { ...EMPTY_WELLNESS_PROFILE, revision: 5 });
    await expect(writer.save({ eligibility: adult })).rejects.toMatchObject({ code: "CONFLICT" });
    queryClient.setQueryData(KEY, { ...EMPTY_WELLNESS_PROFILE });
    expect((await writer.save({ eligibility: adult }))?.revision).toBe(1);
  });

  test("the mark is written once: a started first run is left as it is", async () => {
    const { server, writer } = setup();
    await writer.save({ eligibility: adult });
    expect(await writer.markStarted()).toBeNull();
    expect(server.writes).toHaveLength(1);
    expect(server.writes[0]?.setupStatus).toBe("in_progress");
  });
});
