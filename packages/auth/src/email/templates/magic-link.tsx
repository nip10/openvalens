// TODO(#15): move into Resend provider; #15 owns the real email rendering pipeline.

const APP_NAME = "Health";
const DEFAULT_FOOTER = "This is an automated security message from Health.";
const MAX_SUBJECT_LENGTH = 200;

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHeaderText(value: string): string {
  const normalized = value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= MAX_SUBJECT_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, MAX_SUBJECT_LENGTH).trim();
}

function buildHtml(input: {
  title: string;
  preheader: string;
  bodyLines: string[];
  ctaLabel: string;
  ctaUrl: string;
  footerText: string;
}): string {
  const paragraphs = input.bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#111827;">${escapeHtml(line)}</p>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="background-color:#f5f7fb;color:#111827;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px 12px;">
    <span style="display:none;visibility:hidden;opacity:0;height:0;width:0;">${escapeHtml(input.preheader)}</span>
    <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin:0 auto;max-width:560px;padding:24px;">
      <p style="color:#0f766e;font-size:13px;font-weight:700;letter-spacing:0.4px;margin:0 0 8px 0;text-transform:uppercase;">${APP_NAME}</p>
      <h1 style="color:#111827;font-size:24px;font-weight:700;line-height:1.3;margin:0 0 16px 0;">${escapeHtml(input.title)}</h1>
      ${paragraphs}
      <p style="margin:20px 0;">
        <a href="${escapeHtml(input.ctaUrl)}" style="background-color:#0f766e;border-radius:6px;color:#ffffff;display:inline-block;font-size:14px;font-weight:600;padding:12px 18px;text-decoration:none;">${escapeHtml(input.ctaLabel)}</a>
      </p>
      <hr style="border-color:#e5e7eb;margin:20px 0 12px 0;" />
      <p style="color:#6b7280;font-size:12px;line-height:1.5;margin:0;">${escapeHtml(input.footerText)}</p>
    </div>
  </body>
</html>`;
}

export function renderMagicLinkEmail(input: MagicLinkEmailInput): RenderedMagicLinkEmail {
  const expiresLine = input.expiresInMinutes
    ? `For your security, this link expires in ${input.expiresInMinutes} minutes.`
    : "For your security, this link expires soon.";

  const subject = sanitizeHeaderText(`Sign in to ${APP_NAME}`);
  const title = "Secure sign-in link";
  const preheader = `Use this link to securely sign in to ${APP_NAME}.`;
  const bodyLines = [
    `You requested a secure sign-in link for ${APP_NAME}.`,
    "Use the button below to continue.",
    expiresLine,
    "If you did not request this email, you can safely ignore it.",
  ];
  const ctaLabel = "Sign in securely";
  const footerText = DEFAULT_FOOTER;

  const html = buildHtml({
    title,
    preheader,
    bodyLines,
    ctaLabel,
    ctaUrl: input.url,
    footerText,
  });

  const text = [subject, ...bodyLines, `${ctaLabel}: ${input.url}`, footerText].join("\n\n");

  return {
    subject,
    html,
    text,
  };
}
