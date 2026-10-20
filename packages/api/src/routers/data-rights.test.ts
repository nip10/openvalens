import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as dataRights from "@openvalens/data-rights";
import * as storagePackage from "@openvalens/storage";

import type { Context } from "../context";

const actual = { ...dataRights };
let blockers: { organizationId: string; organizationName: string; reason: "OTHER_OWNER" }[] = [];
let photoBlockers = 0;
const resolveSubject = mock(async (_db: unknown, userId: string) => ({
  subject: { userId, organizationIds: [`org-of-${userId}`] },
  organizations: [{ id: `org-of-${userId}`, name: "Record" }],
  blockers,
}));
const previewSubjectData = mock(async () => ({ metric_sample: 3, session: 1 }));
const countPhotoErasureBlockers = mock(async () => photoBlockers);
const deleteSubjectData = mock(
  async (_db: unknown, subject: { userId: string; organizationIds: string[] }) => ({
    erasedAt: "2026-10-04T12:00:00.000Z",
    userId: subject.userId,
    organizationIds: subject.organizationIds,
    rowCounts: { metric_sample: 3, user: 1 },
  }),
);
mock.module("@openvalens/data-rights", () => ({
  ...actual,
  resolveSubject,
  previewSubjectData,
  countPhotoErasureBlockers,
  deleteSubjectData,
}));

const actualStorage = { ...storagePackage };
let storedKeys: string[] = [];
const collectStoredObjectKeys = mock(async (_db: unknown, _orgIds: readonly string[]) => [
  ...storedKeys,
]);
mock.module("@openvalens/storage", () => ({ ...actualStorage, collectStoredObjectKeys }));

const { dataRightsRouter } = await import("./data-rights");
afterAll(() => {
  mock.module("@openvalens/storage", () => actualStorage);
});

const MINUTE = 60_000;
const deleteKeys = mock(async (keys: readonly string[]) => ({ deleted: keys.length, failed: 0 }));
function context(
  options: { signedIn?: boolean; sessionAgeMs?: number; storage?: boolean } = {},
): Context {
  const { signedIn = true, sessionAgeMs = MINUTE, storage = true } = options;
  return {
    db: {},
    storage: storage ? { deleteKeys } : null,
    correlationId: "test",
    session: signedIn
      ? {
          user: { id: "user-1" },
          session: { createdAt: new Date(Date.now() - sessionAgeMs) },
        }
      : null,
  } as unknown as Context;
}

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

beforeEach(() => {
  blockers = [];
  photoBlockers = 0;
  storedKeys = [];
  collectStoredObjectKeys.mockClear();
  deleteKeys.mockClear();
  resolveSubject.mockClear();
  previewSubjectData.mockClear();
  countPhotoErasureBlockers.mockClear();
  deleteSubjectData.mockClear();
});

describe("dataRights.deletionPreview", () => {
  test("summarises counts and flags a stale sign-in", async () => {
    const fresh = await dataRightsRouter.deletionPreview.callable({ context: context() })({});
    expect(fresh).toMatchObject({
      totalRows: 4,
      reauthRequired: false,
      confirmationPhrase: "DELETE",
    });
    const stale = await dataRightsRouter.deletionPreview.callable({
      context: context({ sessionAgeMs: 11 * MINUTE }),
    })({});
    expect(stale.reauthRequired).toBe(true);
  });

  test("requires sign-in", async () => {
    expect(
      await code(
        dataRightsRouter.deletionPreview.callable({ context: context({ signedIn: false }) })({}),
      ),
    ).toBe("UNAUTHENTICATED");
  });
});

describe("dataRights.deleteEverything", () => {
  const call = (ctx: Context, input: unknown) =>
    dataRightsRouter.deleteEverything.callable({ context: ctx })(input as { confirmation: string });

  test("wrong phrase is rejected before anything else", async () => {
    expect(await code(call(context(), { confirmation: "delete" }))).toBe("INVALID_INPUT");
    expect(deleteSubjectData).not.toHaveBeenCalled();
  });

  test("a user or organization id in the input is rejected", async () => {
    expect(await code(call(context(), { confirmation: "DELETE", userId: "someone-else" }))).toBe(
      "INVALID_INPUT",
    );
    expect(deleteSubjectData).not.toHaveBeenCalled();
  });

  test("stale sign-in requires re-authentication", async () => {
    expect(
      await code(call(context({ sessionAgeMs: 11 * MINUTE }), { confirmation: "DELETE" })),
    ).toBe("REAUTH_REQUIRED");
    expect(deleteSubjectData).not.toHaveBeenCalled();
  });

  test("a co-owned record blocks deletion", async () => {
    blockers = [{ organizationId: "org-x", organizationName: "Shared", reason: "OTHER_OWNER" }];
    expect(await code(call(context(), { confirmation: "DELETE" }))).toBe("CONFLICT");
    expect(deleteSubjectData).not.toHaveBeenCalled();
  });

  test("deletes the signed-in user's own records", async () => {
    const result = await call(context(), { confirmation: "DELETE" });
    expect(result).toEqual({ erasedAt: "2026-10-04T12:00:00.000Z", totalRows: 4 });
    expect(deleteSubjectData).toHaveBeenCalledTimes(1);
    expect(deleteSubjectData.mock.calls[0]![1]).toEqual({
      userId: "user-1",
      organizationIds: ["org-of-user-1"],
    });
  });

  test("stored objects are erased from storage after the database transaction", async () => {
    storedKeys = ["org/org-of-user-1/0b6f3a52-9b5e-4c1e-8d7a-1f2e3d4c5b6a"];
    await call(context(), { confirmation: "DELETE" });
    expect(collectStoredObjectKeys.mock.calls[0]![1]).toEqual(["org-of-user-1"]);
    expect(deleteKeys).toHaveBeenCalledWith(storedKeys);
    expect(deleteSubjectData.mock.invocationCallOrder[0]!).toBeLessThan(
      deleteKeys.mock.invocationCallOrder[0]!,
    );
  });

  test("objects with storage off refuse deletion instead of orphaning bytes", async () => {
    storedKeys = ["org/org-of-user-1/0b6f3a52-9b5e-4c1e-8d7a-1f2e3d4c5b6a"];
    expect(await code(call(context({ storage: false }), { confirmation: "DELETE" }))).toBe(
      "INTERNAL",
    );
    expect(deleteSubjectData).not.toHaveBeenCalled();
  });

  test("photo cleanup blocker prevents account destruction even with storage off and no owned orgs", async () => {
    photoBlockers = 1;
    resolveSubject.mockImplementationOnce(async (_db, userId) => ({
      subject: { userId: String(userId), organizationIds: [] },
      organizations: [],
      blockers: [],
    }));
    expect(await code(call(context({ storage: false }), { confirmation: "DELETE" }))).toBe(
      "CONFLICT",
    );
    expect(deleteSubjectData).not.toHaveBeenCalled();
    expect(deleteKeys).not.toHaveBeenCalled();
  });

  test("no objects and storage off still deletes", async () => {
    await call(context({ storage: false }), { confirmation: "DELETE" });
    expect(deleteSubjectData).toHaveBeenCalledTimes(1);
    expect(deleteKeys).not.toHaveBeenCalled();
  });
});
