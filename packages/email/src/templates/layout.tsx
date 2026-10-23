import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { SOURCE_LOCALE, type Locale } from "@openvalens/i18n";
import { serverI18n } from "@openvalens/i18n/server";

const FALLBACK_ORGANIZATION_NAME = "Health";

/**
 * Branding options threaded from a bound `EmailService` (which structurally
 * satisfies this) or supplied directly. `organizationName` is presentation
 * only — never delivery config — and defaults to the `Health` brand.
 * `locale` is the recipient's language (#231); English when omitted.
 */
export type EmailRenderOptions = {
  organizationName?: string;
  locale?: Locale;
};

/** The recipient's language for a template, English by default (#231). */
export function emailLocale(options: EmailRenderOptions = {}): Locale {
  return options.locale ?? SOURCE_LOCALE;
}

/** The shared Lingui instance a template renders its text with. */
export function emailI18n(options: EmailRenderOptions = {}): I18n {
  return serverI18n(emailLocale(options));
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderParagraphs(lines: readonly string[]): string {
  return lines
    .map(
      (line) =>
        `<p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#111;">${escapeHtml(line)}</p>`,
    )
    .join("");
}

export type RenderLayoutInput = {
  title: string;
  bodyHtml: string;
  bodyText: string;
  preheader?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerText?: string;
};

export type RenderedLayout = {
  html: string;
  text: string;
};

/**
 * Shared plain-HTML email scaffold. Inline CSS only, 560px max width, `#111`
 * body text, footer with the organization name and the current year.
 *
 * NOTE: plain functions rather than React Email components (deviation from
 * anchovy, Issue #15) — the returned shape stays compatible with a future
 * React Email swap.
 */
export function renderLayout(
  input: RenderLayoutInput,
  options: EmailRenderOptions = {},
): RenderedLayout {
  const organizationName = options.organizationName ?? FALLBACK_ORGANIZATION_NAME;
  const year = new Date().getFullYear();
  const footerText =
    input.footerText ??
    emailI18n(options)._(msg`This is an automated message from ${organizationName}.`);

  const preheader = input.preheader
    ? `<span style="display:none;visibility:hidden;opacity:0;height:0;width:0;">${escapeHtml(
        input.preheader,
      )}</span>`
    : "";

  const cta =
    input.ctaLabel && input.ctaUrl
      ? `<p style="margin:20px 0;"><a href="${escapeHtml(
          input.ctaUrl,
        )}" style="background-color:#0f766e;border-radius:6px;color:#ffffff;display:inline-block;font-size:14px;font-weight:600;padding:12px 18px;text-decoration:none;">${escapeHtml(
          input.ctaLabel,
        )}</a></p>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="${emailLocale(options)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="background-color:#f5f7fb;color:#111;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px 12px;">
    ${preheader}
    <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;margin:0 auto;max-width:560px;padding:24px;">
      <p style="color:#0f766e;font-size:13px;font-weight:700;letter-spacing:0.4px;margin:0 0 8px 0;text-transform:uppercase;">${escapeHtml(
        organizationName,
      )}</p>
      <h1 style="color:#111;font-size:24px;font-weight:700;line-height:1.3;margin:0 0 16px 0;">${escapeHtml(
        input.title,
      )}</h1>
      ${input.bodyHtml}
      ${cta}
      <hr style="border-color:#e5e7eb;margin:20px 0 12px 0;" />
      <p style="color:#6b7280;font-size:12px;line-height:1.5;margin:0 0 6px 0;">${escapeHtml(
        footerText,
      )}</p>
      <p style="color:#6b7280;font-size:12px;line-height:1.5;margin:0;">${FALLBACK_ORGANIZATION_NAME} &middot; &copy; ${year}</p>
    </div>
  </body>
</html>`;

  const textParts = [input.bodyText];

  if (input.ctaLabel && input.ctaUrl) {
    textParts.push(`${input.ctaLabel}: ${input.ctaUrl}`);
  }

  textParts.push(footerText, `${FALLBACK_ORGANIZATION_NAME} © ${year}`);

  return {
    html,
    text: textParts.filter((part) => part.length > 0).join("\n\n"),
  };
}
