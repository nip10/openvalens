// TODO(#15): migrate to React Email if/when the react-email dep family is
// adopted. Plain functions keep the `{ subject, html, text }` contract stable.
import { renderLayout, renderParagraphs } from "./layout";

const APP_NAME = "Health";

export type MagicLinkEmailInput = {
  url: string;
  correlationId?: string;
  expiresInMinutes?: number;
};

export type RenderedMagicLinkEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderMagicLinkEmail(input: MagicLinkEmailInput): RenderedMagicLinkEmail {
  const expiresLine = input.expiresInMinutes
    ? `For your security, this link expires in ${input.expiresInMinutes} minutes.`
    : "For your security, this link expires soon.";

  const subject = `Sign in to ${APP_NAME}`;
  const bodyLines = [
    `You requested a secure sign-in link for ${APP_NAME}.`,
    "Use the button below to continue.",
    expiresLine,
    "If you did not request this email, you can safely ignore it.",
  ];

  // The URL is server-built, so only HTML-escaping is applied — the query
  // string (which carries the token) is never re-encoded.
  const layout = renderLayout({
    title: "Secure sign-in link",
    preheader: `Use this link to securely sign in to ${APP_NAME}.`,
    bodyHtml: renderParagraphs(bodyLines),
    bodyText: [
      ...bodyLines,
      `If the button does not work, paste this link into your browser: ${input.url}`,
    ].join("\n\n"),
    ctaLabel: "Sign in",
    ctaUrl: input.url,
    footerText: `This is an automated security message from ${APP_NAME}.`,
  });

  return { subject, html: layout.html, text: layout.text };
}
