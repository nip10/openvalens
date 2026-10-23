import { describe, expect, test } from "bun:test";
import type { SendEmailInput } from "@openvalens/email";
import type { MessageLocales } from "@openvalens/i18n/server";

import { createAdmissionEmailDelivery } from "./admission-email";

/**
 * Issue #231 — admission email in the recipient's language, English by
 * default, with the code and token escaped exactly as before.
 */

function setup(
  byEmail: Record<string, "en" | "pt-PT"> = {},
  byUser: Record<string, "en" | "pt-PT"> = {},
  dryRun = false,
) {
  const sent: SendEmailInput[] = [];
  const lookups: string[] = [];
  const locales: MessageLocales = {
    forEmail: async (email) => {
      lookups.push(`email:${email}`);
      return byEmail[email] ?? null;
    },
    forUser: async (userId) => {
      lookups.push(`user:${userId}`);
      return byUser[userId] ?? "en";
    },
  };
  const delivery = createAdmissionEmailDelivery({
    email: {
      sendEmail: async (input) => {
        sent.push(input);
        return { id: dryRun ? "dry-run" : "msg-1", dryRun };
      },
    },
    locales,
  });
  return { ...delivery, sent, lookups };
}

describe("admission verification email", () => {
  test("no locale and no account: the existing English email", async () => {
    const { deliverVerification, sent } = setup();
    await deliverVerification({
      email: "new@example.test",
      kind: "setup",
      verificationCode: "AB<1>",
    });

    expect(sent).toEqual([
      {
        to: "new@example.test",
        subject: "Verify your email for OpenValens",
        text: "Your verification code is AB<1>. It expires in 10 minutes.",
        html: "<p>Your verification code is <strong>AB&lt;1&gt;</strong>.</p><p>It expires in 10 minutes.</p>",
        templateName: "admission-verification",
        tags: ["admission-verification"],
      },
    ]);
  });

  test("the page's language wins and needs no lookup", async () => {
    const { deliverVerification, sent, lookups } = setup({ "new@example.test": "en" });
    await deliverVerification({
      email: "new@example.test",
      kind: "invitation",
      verificationCode: "123456",
      locale: "pt-PT",
    });

    expect(lookups).toEqual([]);
    expect(sent[0]?.subject).toBe("Confirme o seu email para o OpenValens");
    expect(sent[0]?.text).toBe(
      "O seu código de verificação é 123456. Expira dentro de 10 minutos.",
    );
    expect(sent[0]?.html).toBe(
      "<p>O seu código de verificação é <strong>123456</strong>.</p><p>Expira dentro de 10 minutos.</p>",
    );
  });

  test("without a page language, an existing account's language is used", async () => {
    const { deliverVerification, sent } = setup({ "owner@example.test": "pt-PT" });
    await deliverVerification({
      email: "owner@example.test",
      kind: "setup",
      verificationCode: "1",
    });
    expect(sent[0]?.subject).toBe("Confirme o seu email para o OpenValens");
  });

  test("an explicit English page language is honoured", async () => {
    const { deliverVerification, sent } = setup({ "owner@example.test": "pt-PT" });
    await deliverVerification({
      email: "owner@example.test",
      kind: "setup",
      verificationCode: "1",
      locale: "en",
    });
    expect(sent[0]?.subject).toBe("Verify your email for OpenValens");
  });

  test("a dry run is a delivery failure", async () => {
    const { deliverVerification } = setup({}, {}, true);
    await expect(
      deliverVerification({ email: "a@example.test", kind: "setup", verificationCode: "1" }),
    ).rejects.toThrow("not delivered");
  });
});

describe("admission invitation email", () => {
  test("a recipient with no account gets the inviter's language", async () => {
    const { deliverInvitation, sent } = setup({}, { "admin-1": "pt-PT" });
    await deliverInvitation({
      email: "new@example.test",
      invitationToken: "tok<&>",
      inviterUserId: "admin-1",
    });

    expect(sent[0]?.subject).toBe("Foi convidado para o OpenValens");
    expect(sent[0]?.text).toBe("Foi convidado para o OpenValens. O seu token de convite é tok<&>.");
    expect(sent[0]?.html).toBe(
      "<p>Foi convidado para o OpenValens.</p><p>O seu token de convite é <strong>tok&lt;&amp;&gt;</strong>.</p>",
    );
  });

  test("a recipient with an account gets their own language", async () => {
    const { deliverInvitation, sent, lookups } = setup(
      { "member@example.test": "en" },
      { "admin-1": "pt-PT" },
    );
    await deliverInvitation({
      email: "member@example.test",
      invitationToken: "tok",
      inviterUserId: "admin-1",
    });

    expect(lookups).toEqual(["email:member@example.test"]);
    expect(sent[0]).toEqual({
      to: "member@example.test",
      subject: "You’re invited to OpenValens",
      text: "You have been invited to OpenValens. Your invitation token is tok.",
      html: "<p>You have been invited to OpenValens.</p><p>Your invitation token is <strong>tok</strong>.</p>",
      templateName: "admission-invitation",
      tags: ["admission-invitation"],
    });
  });

  test("a failed lookup falls back to English", async () => {
    const sent: SendEmailInput[] = [];
    const { deliverInvitation } = createAdmissionEmailDelivery({
      email: {
        sendEmail: async (input) => {
          sent.push(input);
          return { id: "msg-1", dryRun: false };
        },
      },
      locales: {
        forEmail: async () => {
          throw new Error("db down");
        },
        forUser: async () => "pt-PT",
      },
    });
    await deliverInvitation({ email: "x@example.test", invitationToken: "t", inviterUserId: "a" });
    expect(sent[0]?.subject).toBe("You’re invited to OpenValens");
  });
});
