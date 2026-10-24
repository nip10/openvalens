import { describe, expect, test } from "bun:test";
import { EmailTransientError, type SendEmailInput } from "@openvalens/email";
import type { MessageLocales } from "@openvalens/i18n/server";
import type { StructuredLogger } from "@openvalens/observability";

import { createWorkspaceInvitationEmails } from "./invitation-email";

/**
 * Issue #243 — the workspace-invitation email composer shared by Better Auth
 * and the sharing router: delivery outcome, language, link, and value-free
 * logging.
 */

type LogLine = { level: string; event: string; fields: Record<string, unknown> };

function setup(
  options: {
    dryRun?: boolean;
    error?: Error;
    byEmail?: Record<string, "en" | "pt-PT">;
    byUser?: Record<string, "en" | "pt-PT">;
  } = {},
) {
  const sent: SendEmailInput[] = [];
  const logs: LogLine[] = [];
  const locales: MessageLocales = {
    forEmail: async (email) => options.byEmail?.[email] ?? null,
    forUser: async (userId) => options.byUser?.[userId] ?? "en",
  };
  const record =
    (level: string) =>
    (event: string, fields: Record<string, unknown> = {}) =>
      logs.push({ level, event, fields });
  const logger = {
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    debug: record("debug"),
  } as unknown as StructuredLogger;
  const emails = createWorkspaceInvitationEmails({
    email: {
      organizationName: "Alpha",
      sendEmail: async (input) => {
        sent.push(input);
        if (options.error) throw options.error;
        return { id: "msg-1", dryRun: options.dryRun ?? false };
      },
    },
    locales,
    webOrigin: "https://health.example/",
    logger,
  });
  return { emails, sent, logs };
}

const INVITE = {
  recipient: "invitee@example.test",
  invitationId: "org-1-abc",
  role: "member",
  organizationName: "Acme Health",
  inviter: { id: "owner-1", name: "Dr. Who", email: "owner@example.test" },
};

const REVOKE = {
  recipient: "invitee@example.test",
  invitationId: "org-1-abc",
  organizationName: "Acme Health",
  revokedBy: { id: "owner-1", name: null, email: "owner@example.test" },
};

describe("sendInvitation", () => {
  test("sends the invitation email with the web accept link", async () => {
    const { emails, sent, logs } = setup();
    expect(await emails.sendInvitation(INVITE)).toBe("sent");

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("invitee@example.test");
    expect(sent[0]?.templateName).toBe("invitation");
    expect(sent[0]?.subject).toBe("Dr. Who invited you to Acme Health on Health");
    expect(sent[0]?.text).toContain("https://health.example/accept-invitation/org-1-abc");
    expect(sent[0]?.text).toContain("This invitation expires in 2 days.");
    expect(logs.map((line) => line.event)).toEqual(["auth.invitation.queued"]);
    expect(JSON.stringify(logs)).not.toContain("invitee@example.test");
  });

  test("renders in the invitee's language, else the inviter's", async () => {
    const own = setup({ byEmail: { "invitee@example.test": "pt-PT" } });
    await own.emails.sendInvitation(INVITE);
    expect(own.sent[0]?.subject).toBe("Dr. Who convidou-o para Acme Health em Health");

    const inviters = setup({ byUser: { "owner-1": "pt-PT" } });
    await inviters.emails.sendInvitation(INVITE);
    expect(inviters.sent[0]?.subject).toBe("Dr. Who convidou-o para Acme Health em Health");
  });

  test("falls back to the inviter's email when they have no name", async () => {
    const { emails, sent } = setup();
    await emails.sendInvitation({ ...INVITE, inviter: { ...INVITE.inviter, name: "" } });
    expect(sent[0]?.subject).toBe("owner@example.test invited you to Acme Health on Health");
  });

  test("a dry run is reported as unavailable, never as sent", async () => {
    const { emails, logs } = setup({ dryRun: true });
    expect(await emails.sendInvitation(INVITE)).toBe("unavailable");
    expect(logs.map((line) => line.event)).toEqual(["auth.invitation.dry-run"]);
  });

  test("a provider failure is reported as failed and never throws", async () => {
    const { emails, logs } = setup({ error: new EmailTransientError(503, "down") });
    expect(await emails.sendInvitation(INVITE)).toBe("failed");
    expect(logs[0]).toMatchObject({ level: "error", event: "auth.invitation.send.failed" });
    expect(JSON.stringify(logs)).not.toContain("invitee@example.test");
  });
});

describe("sendRevoked", () => {
  test("sends the revoked email, naming who revoked it", async () => {
    const { emails, sent } = setup();
    expect(await emails.sendRevoked(REVOKE)).toBe("sent");
    expect(sent[0]?.templateName).toBe("invitation-revoked");
    expect(sent[0]?.subject).toBe("Your invitation to Acme Health has been revoked");
    expect(sent[0]?.text).toContain("Your invitation from owner@example.test to join Acme Health");
  });

  test("renders in the invitee's language", async () => {
    const { emails, sent } = setup({ byEmail: { "invitee@example.test": "pt-PT" } });
    await emails.sendRevoked(REVOKE);
    expect(sent[0]?.subject).toBe("O seu convite para Acme Health foi revogado");
  });

  test("a dry run is unavailable", async () => {
    const { emails } = setup({ dryRun: true });
    expect(await emails.sendRevoked(REVOKE)).toBe("unavailable");
  });
});
