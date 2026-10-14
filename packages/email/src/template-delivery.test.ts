import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openvalens/observability";

import type { EmailConfig } from "./config";
import type { EmailProvider, ResendSendInput } from "./provider";
import { createEmailService } from "./send";
import { renderInvitationEmail } from "./templates/invitation";
import { renderMagicLinkEmail } from "./templates/magic-link";

/**
 * Issue #61 — the invitation and magic-link emails as they reach the (fake)
 * Resend provider: subject, tags, audit-BCC policy and HTML escaping. No live
 * provider call is ever made.
 */

const CONFIG: EmailConfig = {
  RESEND_API_KEY: "re_synthetic_key_0123456789",
  EMAIL_FROM: "Northwind Health <noreply@health.example>",
  EMAIL_REPLY_TO: "support@health.example",
  EMAIL_AUDIT_BCC: "audit@health.example",
  EMAIL_DRY_RUN: false,
};

const MAGIC_URL =
  "https://app.example/api/auth/magic-link/verify?token=synthetic-token-abc&callbackURL=%2F";

function createHarness() {
  const calls: ResendSendInput[] = [];
  const provider: EmailProvider = {
    send: async (input) => {
      calls.push(input);
      return { id: "fake-1" };
    },
  };
  const lines: string[] = [];
  const logger = createStructuredLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });
  const service = createEmailService(CONFIG, { provider, logger });
  return { service, calls, lines };
}

describe("invitation delivery", () => {
  test("reaches the provider with the invitation tag and the audit BCC", async () => {
    const { service, calls } = createHarness();
    const rendered = renderInvitationEmail(
      {
        inviterName: "Dr. Ada",
        organizationName: "Northwind Clinic",
        acceptUrl: "https://app.example/accept-invitation/inv_1",
        expiresInDays: 2,
        role: "member",
      },
      service,
    );

    await service.sendEmail({
      to: "invitee@example.com",
      ...rendered,
      templateName: "invitation",
      tags: ["invitation"],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      from: "Northwind Health <noreply@health.example>",
      to: "invitee@example.com",
      replyTo: "support@health.example",
      bcc: "audit@health.example",
      subject: "Dr. Ada invited you to Northwind Clinic on Health",
      tags: [{ name: "tag", value: "invitation" }],
    });
    expect(calls[0]?.html).toContain('href="https://app.example/accept-invitation/inv_1"');
    expect(calls[0]?.text).toContain("https://app.example/accept-invitation/inv_1");
  });

  test("escapes inviter and organization names in the HTML", () => {
    const rendered = renderInvitationEmail({
      inviterName: '<script>alert("x")</script>',
      organizationName: "A & B <Clinic>",
      acceptUrl: "https://app.example/accept-invitation/inv_2",
      expiresInDays: 2,
      role: "member",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("A &amp; B &lt;Clinic&gt;");
  });
});

describe("magic-link delivery", () => {
  test("reaches the provider with the magic-link tag and never the audit BCC", async () => {
    const { service, calls, lines } = createHarness();
    const rendered = renderMagicLinkEmail({ url: MAGIC_URL, expiresInMinutes: 5 }, service);

    await service.sendEmail(
      { to: "patient@example.com", ...rendered, templateName: "magic-link", tags: ["magic-link"] },
      { correlationId: "corr-ml" },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      subject: "Sign in to Health",
      tags: [{ name: "tag", value: "magic-link" }],
    });
    // A sign-in credential must never be copied to the compliance mailbox.
    expect(calls[0]?.bcc).toBeUndefined();
    expect(calls[0]?.html).toContain("token=synthetic-token-abc&amp;callbackURL=%2F");
    expect(calls[0]?.text).toContain(MAGIC_URL);

    const output = lines.join("\n");
    expect(output).toContain('"templateName":"magic-link"');
    expect(output).not.toContain("synthetic-token-abc");
    expect(output).not.toContain("patient@example.com");
  });
});
