import { msg } from "@lingui/core/macro";

import {
  emailI18n,
  emailLocale,
  renderLayout,
  renderParagraphs,
  type EmailRenderOptions,
} from "./layout";

/**
 * OpenValens Cloud billing emails (Issue #297), in the recipient's language
 * (en, pt-PT). They carry no price, no health data and no personal detail:
 * only the date a trial ends and a link to Settings › Plan & billing on the
 * web, where the person subscribes or manages their plan. Every one says that
 * their records stay and can be exported.
 */

export type BillingEmailKind =
  | "trial_ending"
  | "trial_ended"
  | "payment_failed"
  | "subscription_canceled";

export type BillingEmailInput = {
  kind: BillingEmailKind;
  /** The web Plan & billing page (`<web origin>/settings/billing`), if known. */
  billingUrl: string | null;
  /** When the trial ends (`trial_ending` only). */
  trialEndsAt?: Date;
};

export type RenderedBillingEmail = {
  subject: string;
  html: string;
  text: string;
  templateName: `billing-${BillingEmailKind}`;
};

function formatDay(date: Date, options: EmailRenderOptions): string {
  return new Intl.DateTimeFormat(emailLocale(options), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export function renderBillingEmail(
  input: BillingEmailInput,
  options: EmailRenderOptions = {},
): RenderedBillingEmail {
  const i18n = emailI18n(options);
  const keep = i18n._(msg`Your records stay in your account, and you can export them at any time.`);

  let subject: string;
  let title: string;
  let lines: string[];
  let ctaLabel: string;

  switch (input.kind) {
    case "trial_ending": {
      const day = formatDay(input.trialEndsAt ?? new Date(), options);
      subject = i18n._(msg`Your OpenValens Cloud trial ends in 3 days`);
      title = i18n._(msg`Your trial ends soon`);
      lines = [
        i18n._(msg`Your free OpenValens Cloud trial ends on ${day}.`),
        i18n._(
          msg`To keep adding and syncing records after that, choose a plan in Plan & billing on the web.`,
        ),
        keep,
      ];
      ctaLabel = i18n._(msg`Open Plan & billing`);
      break;
    }
    case "trial_ended":
      subject = i18n._(msg`Your OpenValens Cloud trial has ended`);
      title = i18n._(msg`Your trial has ended`);
      lines = [
        i18n._(msg`Your free OpenValens Cloud trial has ended.`),
        i18n._(msg`You can subscribe at any time in Plan & billing on the web.`),
        keep,
      ];
      ctaLabel = i18n._(msg`Open Plan & billing`);
      break;
    case "payment_failed":
      subject = i18n._(msg`We couldn’t take your OpenValens Cloud payment`);
      title = i18n._(msg`Payment failed`);
      lines = [
        i18n._(msg`Your latest OpenValens Cloud payment didn’t go through.`),
        i18n._(
          msg`Please check your payment method in Plan & billing on the web. We will try again automatically.`,
        ),
        keep,
      ];
      ctaLabel = i18n._(msg`Update payment method`);
      break;
    case "subscription_canceled":
      subject = i18n._(msg`Your OpenValens Cloud subscription has ended`);
      title = i18n._(msg`Subscription ended`);
      lines = [
        i18n._(msg`Your OpenValens Cloud subscription has been cancelled and is no longer active.`),
        i18n._(msg`You can subscribe again at any time in Plan & billing on the web.`),
        keep,
      ];
      ctaLabel = i18n._(msg`Open Plan & billing`);
      break;
  }

  const layout = renderLayout(
    {
      title,
      preheader: lines[0],
      bodyHtml: renderParagraphs(lines),
      bodyText: lines.join("\n\n"),
      ...(input.billingUrl ? { ctaLabel, ctaUrl: input.billingUrl } : {}),
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text, templateName: `billing-${input.kind}` };
}
