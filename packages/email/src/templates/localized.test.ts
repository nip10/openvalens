import { describe, expect, test } from "bun:test";

import { renderInsightsDigestEmail } from "./insights-digest";
import { renderInvitationEmail } from "./invitation";
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
  test("English by default and for an explicit en", () => {
    const fallback = renderMagicLinkEmail({ url: MAGIC_URL, expiresInMinutes: 10 });
    const english = renderMagicLinkEmail(
      { url: MAGIC_URL, expiresInMinutes: 10 },
      { locale: "en" },
    );
    expect(english).toEqual(fallback);
    expect(fallback.subject).toBe("Sign in to Health");
    expect(fallback.text).toContain("For your security, this link expires in 10 minutes.");
    expect(fallback.html).toContain('<html lang="en">');
  });

  test("pt-PT subject, body, button and footer; the link and brand are unchanged", () => {
    const pt = renderMagicLinkEmail({ url: MAGIC_URL, expiresInMinutes: 10 }, { locale: "pt-PT" });
    expect(pt.subject).toBe("Iniciar sessão em Health");
    expect(pt.text).toContain("Por segurança, esta ligação expira dentro de 10 minutos.");
    expect(pt.text).toContain(`cole esta ligação no seu navegador: ${MAGIC_URL}`);
    expect(pt.html).toContain('<html lang="pt-PT">');
    expect(pt.html).toContain(">Iniciar sessão</a>");
    expect(pt.html).toContain("mensagem de segurança automática");
    expect(pt.html).toContain(MAGIC_URL.replaceAll("&", "&amp;"));
    expect(pt.html).not.toContain("Sign in");
  });

  test("pt-PT plural for one minute", () => {
    const pt = renderMagicLinkEmail({ url: MAGIC_URL, expiresInMinutes: 1 }, { locale: "pt-PT" });
    expect(pt.text).toContain("expira dentro de 1 minuto.");
  });
});

describe("workspace invitation email", () => {
  test("English stays as before", () => {
    const en = renderInvitationEmail(INVITATION);
    expect(en.subject).toBe("Dr. <Ada> invited you to Northwind & Co on Health");
    expect(en.text).toContain("You have been invited with the member role.");
    expect(en.text).toContain("This invitation expires in 2 days.");
  });

  test("pt-PT, with user values escaped in HTML and kept as written", () => {
    const pt = renderInvitationEmail(INVITATION, { locale: "pt-PT" });
    expect(pt.subject).toBe("Dr. <Ada> convidou-o para Northwind & Co em Health");
    expect(pt.text).toContain("Foi convidado com a função member.");
    expect(pt.text).toContain("Este convite expira dentro de 2 dias.");
    expect(pt.html).toContain("Dr. &lt;Ada&gt; convidou-o para aderir a Northwind &amp; Co");
    expect(pt.html).not.toContain("<Ada>");
    expect(pt.html).toContain(">Aceitar convite</a>");
    expect(
      renderInvitationEmail({ ...INVITATION, expiresInDays: 1 }, { locale: "pt-PT" }).text,
    ).toContain("Este convite expira dentro de 1 dia.");
  });
});

describe("layout", () => {
  const base = { title: "Title", bodyHtml: "<p>body</p>", bodyText: "body" };

  test("the default footer follows the locale", () => {
    expect(renderLayout(base).text).toContain("This is an automated message from Health.");
    const pt = renderLayout(base, { locale: "pt-PT", organizationName: "Alpha" });
    expect(pt.text).toContain("Esta é uma mensagem automática de Alpha.");
    expect(pt.html).toContain('<html lang="pt-PT">');
  });

  test("the insights digest marks its language", () => {
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
    expect(renderInsightsDigestEmail(input).html).toContain('<html lang="en">');
    expect(renderInsightsDigestEmail(input, { locale: "pt-PT" }).html).toContain(
      '<html lang="pt-PT">',
    );
  });
});
