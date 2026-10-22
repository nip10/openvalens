import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as dataRights from "@openvalens/data-rights";

import type { Context } from "../context";

const actual = { ...dataRights };
const resolveSubject = mock(async (_db: unknown, userId: string) => ({
  subject: { userId, organizationIds: [`org-of-${userId}`] },
  organizations: [{ id: `org-of-${userId}`, name: "Record" }],
  blockers: [],
}));
const previewSubjectData = mock(async () => ({ metric_sample: 3, session: 1 }));
const deleteSelfSubjectData = mock(
  async (_db: unknown, _actor: { userId: string; sessionId: string }, _storage: unknown) => ({
    report: {
      erasedAt: "2026-10-04T12:00:00.000Z",
      userId: "user-1",
      organizationIds: ["org-of-user-1"],
      rowCounts: { metric_sample: 3, user: 1 },
    },
    objects: { deleted: 0, failed: 0 },
  }),
);
mock.module("@openvalens/data-rights", () => ({
  ...actual,
  resolveSubject,
  previewSubjectData,
  deleteSelfSubjectData,
}));

const { dataRightsRouter } = await import("./data-rights");

const MINUTE = 60_000;
const deleteKeys = mock(async (keys: readonly string[]) => ({ deleted: keys.length, failed: 0 }));
function context(
  options: {
    signedIn?: boolean;
    sessionAgeMs?: number;
    storage?: boolean;
    impersonatedBy?: string | null;
    sessionId?: string | null;
  } = {},
): Context {
  const {
    signedIn = true,
    sessionAgeMs = MINUTE,
    storage = true,
    impersonatedBy = null,
    sessionId = "session-1",
  } = options;
  return {
    db: {},
    storage: storage ? { deleteKeys } : null,
    correlationId: "test",
    session: signedIn
      ? {
          user: { id: "user-1" },
          session: {
            id: sessionId,
            createdAt: new Date(Date.now() - sessionAgeMs),
            impersonatedBy,
          },
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
  deleteKeys.mockClear();
  resolveSubject.mockClear();
  previewSubjectData.mockClear();
  deleteSelfSubjectData.mockClear();
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

  test("rejects missing trusted identifiers and impersonation before subject queries", async () => {
    expect(
      await code(
        dataRightsRouter.deletionPreview.callable({
          context: context({ sessionId: null }),
        })({}),
      ),
    ).toBe("REAUTH_REQUIRED");
    expect(
      await code(
        dataRightsRouter.deletionPreview.callable({
          context: context({ impersonatedBy: "admin" }),
        })({}),
      ),
    ).toBe("PERMISSION_DENIED");
    expect(resolveSubject).not.toHaveBeenCalled();
  });
});

describe("dataRights.deleteEverything", () => {
  const call = (ctx: Context, input: unknown) =>
    dataRightsRouter.deleteEverything.callable({ context: ctx })(input as { confirmation: string });

  test("wrong phrase is rejected before anything else", async () => {
    expect(await code(call(context(), { confirmation: "delete" }))).toBe("INVALID_INPUT");
    expect(deleteSelfSubjectData).not.toHaveBeenCalled();
  });

  test("a user or organization id in the input is rejected", async () => {
    expect(await code(call(context(), { confirmation: "DELETE", userId: "someone-else" }))).toBe(
      "INVALID_INPUT",
    );
    expect(deleteSelfSubjectData).not.toHaveBeenCalled();
  });

  test("rejects impersonation before invoking the erasure service", async () => {
    expect(
      await code(call(context({ impersonatedBy: "operator" }), { confirmation: "DELETE" })),
    ).toBe("PERMISSION_DENIED");
    expect(deleteSelfSubjectData).not.toHaveBeenCalled();
  });

  test("requires persisted session and user identifiers", async () => {
    expect(await code(call(context({ sessionId: null }), { confirmation: "DELETE" }))).toBe(
      "REAUTH_REQUIRED",
    );
    expect(deleteSelfSubjectData).not.toHaveBeenCalled();
  });

  test("deletes the signed-in user's own records", async () => {
    const result = await call(context(), { confirmation: "DELETE" });
    expect(result).toEqual({ erasedAt: "2026-10-04T12:00:00.000Z", totalRows: 4 });
    expect(deleteSelfSubjectData).toHaveBeenCalledTimes(1);
    expect(deleteSelfSubjectData.mock.calls[0]![1]).toEqual({
      userId: "user-1",
      sessionId: "session-1",
    });
  });

  test("stored objects are erased from storage after the database transaction", async () => {
    const ctx = context();
    await call(ctx, { confirmation: "DELETE" });
    expect(deleteSelfSubjectData.mock.calls[0]![2]).toBe(ctx.storage);
    expect(deleteSelfSubjectData).toHaveBeenCalledTimes(1);
  });
});
