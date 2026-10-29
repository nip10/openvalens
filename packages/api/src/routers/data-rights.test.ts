import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as dataRights from "@openvalens/data-rights";

import type { Context } from "../context";
import { requireActiveAccess } from "../index";

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
    db?: Context["db"];
    deployment?: Context["deployment"];
    billing?: Context["billing"];
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
    db: options.db ?? ({} as Context["db"]),
    deployment: options.deployment,
    billing: options.billing,
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

describe("dataRights export jobs", () => {
  test("request is self-service and allowed without billing on ended Cloud access", async () => {
    let calls = 0;
    const txObj = {
      execute: async () => {
        calls++;
        if (calls === 2) return { rows: [] };
        if (calls === 3) return { rows: [{ n: 0 }] };
        return {
          rows: [
            {
              id: "d5f3f4ea-0e0d-4c28-aee6-7c9ea7a0de73",
              state: "queued",
              created_at: new Date(),
              expires_at: null,
              bytes: null,
              failure: null,
            },
          ],
        };
      },
    };
    const db = {
      transaction: async (callback: (tx: typeof txObj) => Promise<unknown>) => callback(txObj),
    } as unknown as Context["db"];
    await requireActiveAccess({
      context: {
        deployment: { mode: "cloud" } as Context["deployment"],
        billing: null,
        session: context().session,
      },
      path: ["dataRights", "exportRequest"],
    });
    const status = await dataRightsRouter.exportRequest.callable({
      context: context({
        db,
        billing: null,
      }),
    })({});
    expect(status).toMatchObject({
      id: "d5f3f4ea-0e0d-4c28-aee6-7c9ea7a0de73",
      state: "queued",
      bytes: null,
    });
    expect(resolveSubject).toHaveBeenCalledWith(db, "user-1");
  });

  test("status is limited to the signed-in subject and impersonation is refused", async () => {
    const db = {
      execute: async () => ({
        rows: [
          {
            id: "e5f3f4ea-0e0d-4c28-aee6-7c9ea7a0de73",
            state: "ready",
            created_at: new Date(),
            expires_at: new Date(Date.now() + 1000),
            bytes: 12,
            failure: null,
          },
        ],
      }),
    } as unknown as Context["db"];
    const status = await dataRightsRouter.exportStatus.callable({ context: context({ db }) })({});
    expect(status).toMatchObject({ state: "ready", bytes: 12 });
    expect(
      await code(
        dataRightsRouter.exportStatus.callable({ context: context({ impersonatedBy: "admin" }) })(
          {},
        ),
      ),
    ).toBe("PERMISSION_DENIED");
  });
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

  test("Apple tokens are read before the erasure and revoked only after it commits (#296)", async () => {
    const order: string[] = [];
    const pending = { apple: [{ token: "synthetic-refresh", hint: "refresh_token" as const }] };
    const socialTokenRevocation = {
      collect: mock(async (userId: string) => {
        order.push(`collect:${userId}`);
        return pending;
      }),
      revoke: mock(async (_pending: unknown) => {
        order.push("revoke");
        return { revoked: 1, failed: 0 };
      }),
    };
    deleteSelfSubjectData.mockImplementationOnce(async () => {
      order.push("erase");
      return {
        report: {
          erasedAt: "2026-10-04T12:00:00.000Z",
          userId: "user-1",
          organizationIds: [] as string[],
          rowCounts: { metric_sample: 0, user: 1 },
        },
        objects: { deleted: 0, failed: 0 },
      };
    });
    const ctx = { ...context(), socialTokenRevocation } as unknown as Context;
    await call(ctx, { confirmation: "DELETE" });
    expect(order).toEqual(["collect:user-1", "erase", "revoke"]);
    expect(socialTokenRevocation.revoke.mock.calls[0]).toEqual([pending]);
  });

  test("a failed erasure never revokes; a failed revocation never fails the deletion (#296)", async () => {
    const socialTokenRevocation = {
      collect: mock(async () => ({ apple: [{ token: "t", hint: "refresh_token" as const }] })),
      revoke: mock(async () => {
        throw new Error("apple unreachable");
      }),
    };
    deleteSelfSubjectData.mockImplementationOnce(async () => {
      throw new dataRights.SelfErasureError("CONFLICT");
    });
    const failing = { ...context(), socialTokenRevocation } as unknown as Context;
    expect(await code(call(failing, { confirmation: "DELETE" }))).toBe("CONFLICT");
    expect(socialTokenRevocation.revoke).not.toHaveBeenCalled();

    const ok = { ...context(), socialTokenRevocation } as unknown as Context;
    expect(await call(ok, { confirmation: "DELETE" })).toEqual({
      erasedAt: "2026-10-04T12:00:00.000Z",
      totalRows: 4,
    });
    expect(socialTokenRevocation.revoke).toHaveBeenCalledTimes(1);
  });
});
