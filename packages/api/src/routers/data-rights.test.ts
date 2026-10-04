import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as dataRights from "@openvalens/data-rights";

import type { Context } from "../context";

const actual = { ...dataRights };
let blockers: { organizationId: string; organizationName: string; reason: "OTHER_OWNER" }[] = [];
const resolveSubject = mock(async (_db: unknown, userId: string) => ({
  subject: { userId, organizationIds: [`org-of-${userId}`] },
  organizations: [{ id: `org-of-${userId}`, name: "Record" }],
  blockers,
}));
const previewSubjectData = mock(async () => ({ metric_sample: 3, session: 1 }));
const deleteSubjectData = mock(async (_db: unknown, subject: { userId: string; organizationIds: string[] }) => ({
  erasedAt: "2026-10-04T12:00:00.000Z",
  userId: subject.userId,
  organizationIds: subject.organizationIds,
  rowCounts: { metric_sample: 3, user: 1 },
}));
mock.module("@openvalens/data-rights", () => ({
  ...actual,
  resolveSubject,
  previewSubjectData,
  deleteSubjectData,
}));

const { dataRightsRouter } = await import("./data-rights");

const MINUTE = 60_000;
function context(options: { signedIn?: boolean; sessionAgeMs?: number } = {}): Context {
  const { signedIn = true, sessionAgeMs = MINUTE } = options;
  return {
    db: {},
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
  resolveSubject.mockClear();
  previewSubjectData.mockClear();
  deleteSubjectData.mockClear();
});

describe("dataRights.deletionPreview", () => {
  test("summarises counts and flags a stale sign-in", async () => {
    const fresh = await dataRightsRouter.deletionPreview.callable({ context: context() })({});
    expect(fresh).toMatchObject({ totalRows: 4, reauthRequired: false, confirmationPhrase: "DELETE" });
    const stale = await dataRightsRouter.deletionPreview.callable({
      context: context({ sessionAgeMs: 11 * MINUTE }),
    })({});
    expect(stale.reauthRequired).toBe(true);
  });

  test("requires sign-in", async () => {
    expect(
      await code(dataRightsRouter.deletionPreview.callable({ context: context({ signedIn: false }) })({})),
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
    expect(await code(call(context({ sessionAgeMs: 11 * MINUTE }), { confirmation: "DELETE" }))).toBe(
      "REAUTH_REQUIRED",
    );
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
});
