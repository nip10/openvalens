import { renderLayout, renderParagraphs, type EmailRenderOptions } from "./layout";

const APP_NAME = "Health";

export type AccessRequestSubmittedEmailInput = {
  requesterName: string;
  organizationName: string;
  reviewUrl: string;
};

export type RenderedAccessRequestSubmittedEmail = {
  subject: string;
  html: string;
  text: string;
};

export function renderAccessRequestSubmittedEmail(
  input: AccessRequestSubmittedEmailInput,
  options: EmailRenderOptions = {},
): RenderedAccessRequestSubmittedEmail {
  const subject = `${input.requesterName} requested access to ${input.organizationName}`;
  const bodyLines = [
    `${input.requesterName} submitted a new access request for ${input.organizationName}.`,
    "Review this request to approve or deny access.",
    "Please process pending requests promptly to keep access up to date.",
  ];

  const layout = renderLayout(
    {
      title: "Access request received",
      preheader: `${input.requesterName} requested access to ${input.organizationName}.`,
      bodyHtml: renderParagraphs(bodyLines),
      bodyText: bodyLines.join("\n\n"),
      ctaLabel: "Review request",
      ctaUrl: input.reviewUrl,
      footerText: `You are receiving this because you can review access requests in ${APP_NAME}.`,
    },
    options,
  );

  return { subject, html: layout.html, text: layout.text };
}
