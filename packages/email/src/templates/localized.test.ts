import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { Text } from "react-email";

import { renderInsightsDigestEmail } from "./insights-digest";
import { renderInvitationEmail } from "./invitation";
import { renderInvitationRevokedEmail } from "./invitation-revoked";
import { renderLayout } from "./layout";
import { renderMagicLinkEmail } from "./magic-link";

/**
 * Issue #231 — templates render in the recipient's language. English is the
 * default and stays byte-identical whether the locale is omitted or "en".
 */

const MAGIC_URL = "https://app.example/api/auth/magic-link/verify?token=t&callbackURL=%2F";
const INVITATION = {
  inviterName: "Dr. <Ada>",
  organizationName: "Northwind & Co",
  acceptUrl: "https://app.example/accept-invitation/inv_1",
  expiresInDays: 2,
  role: "member",
};

describe("magic-link email", () => {
  test("English by default and for an explicit en", async () => {
    const fallback = await renderMagicLinkEmail({ url: MAGIC_URL, expiresInMinutes: 10 });
    const english = await renderMagicLinkEmail(
      { url: MAGIC_URL, expiresInMinutes: 10 },
      { locale: "en" },
    );
    expect(english).toEqual(fallback);
    expect(fallback.subject).toBe("Sign in to OpenValens");
    expect(fallback.text).toContain("For your security, this link expires in 10 minutes.");
    expect(fallback.html).toContain('lang="en"');
  });

  test("pt-PT subject, body, button and footer; the link and brand are unchanged", async () => {
    const pt = await renderMagicLinkEmail(
      { url: MAGIC_URL, expiresInMinutes: 10 },
      { locale: "pt-PT" },
    );
    expect(pt.subject).toBe("Iniciar sessão em OpenValens");
    expect(pt.text).toContain("Por segurança, esta ligação expira dentro de 10 minutos.");
    expect(pt.text).toContain(`cole esta ligação no seu navegador: ${MAGIC_URL}`);
    expect(pt.html).toContain('lang="pt-PT"');
    expect(pt.html).toContain("Iniciar sessão");
    expect(pt.html).toContain("mensagem de segurança automática");
    expect(pt.html).toContain(MAGIC_URL.replaceAll("&", "&amp;"));
    expect(pt.html).not.toContain("Sign in");
  });

  test("pt-PT plural for one minute", async () => {
    const pt = await renderMagicLinkEmail(
      { url: MAGIC_URL, expiresInMinutes: 1 },
      { locale: "pt-PT" },
    );
    expect(pt.text).toContain("expira dentro de 1 minuto.");
  });
});

describe("workspace invitation email", () => {
  test("English stays as before", async () => {
    const en = await renderInvitationEmail(INVITATION);
    expect(en.subject).toBe("Dr. <Ada> invited you to Northwind & Co on OpenValens");
    expect(en.text).toContain("You have been invited with the member role.");
    expect(en.text).toContain("This invitation expires in 2 days.");
  });

  test("pt-PT, with user values escaped in HTML and kept as written", async () => {
    const pt = await renderInvitationEmail(INVITATION, { locale: "pt-PT" });
    expect(pt.subject).toBe("Dr. <Ada> convidou-o para Northwind & Co em OpenValens");
    expect(pt.text).toContain("Foi convidado com a função member.");
    expect(pt.text).toContain("Este convite expira dentro de 2 dias.");
    expect(pt.html).toContain("Dr. &lt;Ada&gt; convidou-o para aderir a Northwind &amp; Co");
    expect(pt.html).not.toContain("<Ada>");
    expect(pt.html).toContain("Aceitar convite");
    expect(
      (await renderInvitationEmail({ ...INVITATION, expiresInDays: 1 }, { locale: "pt-PT" })).text,
    ).toContain("Este convite expira dentro de 1 dia.");
  });
});

describe("layout", () => {
  const base = { title: "Title", bodyHtml: createElement(Text, null, "body"), bodyText: "body" };

  test("the default footer follows the locale", async () => {
    expect((await renderLayout(base)).text).toContain(
      "This is an automated message from OpenValens.",
    );
    const pt = await renderLayout(base, { locale: "pt-PT", organizationName: "Alpha" });
    expect(pt.text).toContain("Esta é uma mensagem automática de Alpha.");
    expect(pt.html).toContain('lang="pt-PT"');
  });

  test("the insights digest marks its language", async () => {
    const input = {
      subject: "s",
      title: "t",
      intro: "i",
      emptyText: "e",
      items: [],
      appUrl: "https://app.example/dashboard",
      appLabel: "a",
      unsubscribeUrl: "https://app.example/unsubscribe?token=x",
      unsubscribeLabel: "u",
      footer: "f",
    };
    expect((await renderInsightsDigestEmail(input)).html).toContain('lang="en"');
    expect((await renderInsightsDigestEmail(input, { locale: "pt-PT" })).html).toContain(
      'lang="pt-PT"',
    );
  });
});

describe("workspace invitation revoked email (Issue #243)", () => {
  const REVOKED = { inviterName: "Dr. <Ada>", organizationName: "Northwind & Co" };

  test("English by default and for an explicit en", async () => {
    const fallback = await renderInvitationRevokedEmail(REVOKED);
    expect(await renderInvitationRevokedEmail(REVOKED, { locale: "en" })).toEqual(fallback);
    expect(fallback.subject).toBe("Your invitation to Northwind & Co has been revoked");
  });

  test("pt-PT subject and body; names are escaped, not translated", async () => {
    const pt = await renderInvitationRevokedEmail(REVOKED, { locale: "pt-PT" });
    expect(pt.subject).toBe("O seu convite para Northwind & Co foi revogado");
    expect(pt.text).toContain(
      "O convite de Dr. <Ada> para se juntar a Northwind & Co foi revogado e já não pode ser utilizado.",
    );
    expect(pt.html).toContain("Dr. &lt;Ada&gt;");
    expect(pt.html).toContain('lang="pt-PT"');
    expect(pt.html).not.toContain("revoked");
  });
});
