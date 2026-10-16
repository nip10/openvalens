import { escapeHtml, renderLayout, type EmailRenderOptions } from "./layout";

/**
 * Issue #92 — weekly insights summary. A service message only: the
 * person's own insights (already rendered from the reviewed insight
 * templates), a link to the app and a one-step unsubscribe link. No
 * promotion, no AI text. The subject and preheader carry no values, because
 * the subject is logged and shown in inbox previews.
 */

export type InsightsDigestItem = {
  title: string;
  lines: readonly string[];
};

export type InsightsDigestEmailInput = {
  subject: string;
  title: string;
  intro: string;
  /** Shown instead of the list when there is nothing to describe. */
  emptyText: string;
  items: readonly InsightsDigestItem[];
  appUrl: string;
  appLabel: string;
  unsubscribeUrl: string;
  unsubscribeLabel: string;
  footer: string;
};

export type RenderedInsightsDigestEmail = {
  subject: string;
  html: string;
  text: string;
};

const P = 'style="margin:0 0 12px 0;font-size:15px;line-height:1.6;color:#111;"';
const SMALL = 'style="margin:0 0 6px 0;font-size:14px;line-height:1.5;color:#374151;"';

export function renderInsightsDigestEmail(
  input: InsightsDigestEmailInput,
  options: EmailRenderOptions = {},
): RenderedInsightsDigestEmail {
  const itemsHtml =
    input.items.length === 0
      ? `<p ${P}>${escapeHtml(input.emptyText)}</p>`
      : input.items
          .map(
            (item) =>
              `<div style="border-top:1px solid #e5e7eb;padding:12px 0;"><p style="margin:0 0 6px 0;font-size:15px;font-weight:600;color:#111;">${escapeHtml(item.title)}</p>${item.lines
                .map((line) => `<p ${SMALL}>${escapeHtml(line)}</p>`)
                .join("")}</div>`,
          )
          .join("");
  const unsubscribeHtml = `<p ${SMALL}><a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#0f766e;">${escapeHtml(input.unsubscribeLabel)}</a></p>`;

  const itemsText =
    input.items.length === 0
      ? input.emptyText
      : input.items.map((item) => [item.title, ...item.lines].join("\n")).join("\n\n");

  const layout = renderLayout(
    {
      title: input.title,
      preheader: input.intro,
      bodyHtml: `<p ${P}>${escapeHtml(input.intro)}</p>${itemsHtml}${unsubscribeHtml}`,
      bodyText: `${input.intro}\n\n${itemsText}\n\n${input.unsubscribeLabel}: ${input.unsubscribeUrl}`,
      ctaLabel: input.appLabel,
      ctaUrl: input.appUrl,
      footerText: input.footer,
    },
    options,
  );

  return { subject: input.subject, html: layout.html, text: layout.text };
}
