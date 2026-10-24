import { describe, expect, test } from "bun:test";

import { inEnglish } from "@openvalens/i18n/testing";

import {
  acceptWorkspaceInvitation,
  classifyInvitationError,
  declineWorkspaceInvitation,
  invitationState,
  listMyInvitations,
  WorkspaceInvitationError,
  type InvitationFetchResult,
  type WorkspaceInvitation,
  type WorkspaceInvitationClient,
} from "./workspace-invitation";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");

function invitation(overrides: Partial<WorkspaceInvitation> = {}): WorkspaceInvitation {
  return {
    id: "inv-1",
    email: "recipient@example.test",
    role: "member",
    organizationId: "org-1",
    organizationName: "Northwind Clinic",
    status: "pending",
    expiresAt: "2026-10-17T12:00:00.000Z",
    createdAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

function ok<T>(data: T): InvitationFetchResult<T> {
  return { data, error: null };
}

type FakeOptions = {
  email?: string | null;
  activeOrganizationId?: string | null;
  listResult?: InvitationFetchResult<WorkspaceInvitation[]>;
  acceptResult?: InvitationFetchResult<unknown>;
  rejectResult?: InvitationFetchResult<unknown>;
  refreshActiveOrganizationId?: string | null;
};

function fakeClient(options: FakeOptions = {}) {
  const calls = {
    list: [] as Array<{ query?: { email?: string } }>,
    accept: [] as Array<{ invitationId: string }>,
    reject: [] as Array<{ invitationId: string }>,
    getSession: 0,
  };
  const client: WorkspaceInvitationClient = {
    getSession: async () => {
      calls.getSession += 1;
      return {
        data: {
          session: {
            activeOrganizationId:
              options.refreshActiveOrganizationId ?? options.activeOrganizationId ?? null,
          },
          user: { email: options.email === undefined ? "recipient@example.test" : options.email },
        },
      };
    },
    organization: {
      listUserInvitations: async (input) => {
        calls.list.push(input);
        return options.listResult ?? ok([invitation()]);
      },
      acceptInvitation: async (input) => {
        calls.accept.push(input);
        return options.acceptResult ?? ok({ invitation: { id: input.invitationId } });
      },
      rejectInvitation: async (input) => {
        calls.reject.push(input);
        return options.rejectResult ?? ok({ invitation: { id: input.invitationId } });
      },
    },
  };
  return { client, calls };
}

describe("invitationState", () => {
  test("a pending, unexpired invitation for the session email is actionable", () => {
    expect(
      invitationState(invitation(), { sessionEmail: "Recipient@Example.test", now: NOW }),
    ).toBe("pending");
  });

  test("an expired invitation is refused", () => {
    expect(
      invitationState(invitation({ expiresAt: "2026-10-14T12:00:00.000Z" }), {
        sessionEmail: "recipient@example.test",
        now: NOW,
      }),
    ).toBe("expired");
  });

  test("an invitation for another email is a wrong-account state", () => {
    expect(invitationState(invitation(), { sessionEmail: "someone@example.test", now: NOW })).toBe(
      "wrong_account",
    );
  });

  test("a non-pending invitation is unavailable", () => {
    expect(
      invitationState(invitation({ status: "accepted" }), {
        sessionEmail: "recipient@example.test",
        now: NOW,
      }),
    ).toBe("unavailable");
  });
});

describe("classifyInvitationError", () => {
  test("maps the recipient mismatch code to wrong_account", () => {
    expect(
      classifyInvitationError({ code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" }).reason,
    ).toBe("wrong_account");
    expect(
      inEnglish(
        classifyInvitationError({ code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" }).message,
      ),
    ).toBe(
      "This invitation was sent to a different email address. Sign in with the invited account to use it.",
    );
  });

  test("maps a missing/expired invitation to expired", () => {
    expect(classifyInvitationError({ code: "INVITATION_NOT_FOUND" }).reason).toBe("expired");
  });

  test("maps verification and membership-limit reasons to denied", () => {
    expect(
      classifyInvitationError({
        code: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
      }).reason,
    ).toBe("denied");
    expect(classifyInvitationError({ code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED" }).reason).toBe(
      "denied",
    );
  });

  test("an unauthenticated response asks the user to sign in again", () => {
    expect(inEnglish(classifyInvitationError({ status: 401 }).message)).toBe(
      "Sign in again to continue.",
    );
  });

  test("an unknown failure stays unavailable", () => {
    const unknown = classifyInvitationError({ status: 500 });
    expect(unknown.reason).toBe("unavailable");
    expect(inEnglish(unknown.message)).toBe("Could not complete that action. Please try again.");
  });
});

describe("listMyInvitations", () => {
  test("lists the signed-in recipient's invitations", async () => {
    const { client, calls } = fakeClient({ listResult: ok([invitation()]) });

    const invitations = await listMyInvitations(client);

    expect(invitations.map((entry) => entry.id)).toEqual(["inv-1"]);
    expect(calls.list).toHaveLength(1);
  });

  test("refuses without a session email and never calls the SDK", async () => {
    const { client, calls } = fakeClient({ email: null });

    await expect(listMyInvitations(client)).rejects.toBeInstanceOf(WorkspaceInvitationError);
    expect(calls.list).toHaveLength(0);
  });

  test("surfaces a denied list error", async () => {
    const { client } = fakeClient({
      listResult: {
        data: null,
        error: { code: "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION" },
      },
    });

    const error = await listMyInvitations(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorkspaceInvitationError);
    expect((error as WorkspaceInvitationError).reason).toBe("denied");
    expect(inEnglish((error as WorkspaceInvitationError).userMessage)).toBe(
      "You cannot use this invitation. Ask the workspace owner for a new one.",
    );
  });
});

describe("acceptWorkspaceInvitation", () => {
  test("accepts and refreshes the active organization", async () => {
    const { client, calls } = fakeClient({ refreshActiveOrganizationId: "org-1" });

    const result = await acceptWorkspaceInvitation(client, "inv-1");

    expect(calls.accept).toEqual([{ invitationId: "inv-1" }]);
    // Accepting activates the joined workspace, so the session is re-read.
    expect(calls.getSession).toBe(1);
    expect(result.activeOrganizationId).toBe("org-1");
  });

  test("classifies a wrong-account rejection", async () => {
    const { client } = fakeClient({
      acceptResult: { data: null, error: { code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" } },
    });

    const error = await acceptWorkspaceInvitation(client, "inv-1").catch(
      (caught: unknown) => caught,
    );
    expect((error as WorkspaceInvitationError).reason).toBe("wrong_account");
  });

  test("classifies an expired invitation and does not refresh the session", async () => {
    const { client, calls } = fakeClient({
      acceptResult: { data: null, error: { code: "INVITATION_NOT_FOUND" } },
    });

    const error = await acceptWorkspaceInvitation(client, "inv-1").catch(
      (caught: unknown) => caught,
    );
    expect((error as WorkspaceInvitationError).reason).toBe("expired");
    expect(inEnglish((error as WorkspaceInvitationError).userMessage)).toBe(
      "This invitation is no longer available. It may have expired or already been used.",
    );
    expect(calls.getSession).toBe(0);
  });

  test("classifies a membership-limit denial", async () => {
    const { client } = fakeClient({
      acceptResult: { data: null, error: { code: "ORGANIZATION_MEMBERSHIP_LIMIT_REACHED" } },
    });

    const error = await acceptWorkspaceInvitation(client, "inv-1").catch(
      (caught: unknown) => caught,
    );
    expect((error as WorkspaceInvitationError).reason).toBe("denied");
  });
});

describe("declineWorkspaceInvitation", () => {
  test("declines the invitation", async () => {
    const { client, calls } = fakeClient();

    await declineWorkspaceInvitation(client, "inv-2");

    expect(calls.reject).toEqual([{ invitationId: "inv-2" }]);
  });

  test("surfaces a declined error", async () => {
    const { client } = fakeClient({
      rejectResult: { data: null, error: { code: "INVITATION_NOT_FOUND" } },
    });

    const error = await declineWorkspaceInvitation(client, "inv-2").catch(
      (caught: unknown) => caught,
    );
    expect((error as WorkspaceInvitationError).reason).toBe("expired");
  });
});
