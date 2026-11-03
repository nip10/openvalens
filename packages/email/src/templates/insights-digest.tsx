import { emailStyles, emailTokens, renderLayout, type EmailRenderOptions } from "./layout";
import { Link, Section, Text } from "react-email";

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

const pStyle = emailStyles.paragraph;
const smallStyle = emailStyles.secondaryText;

export async function renderInsightsDigestEmail(
  input: InsightsDigestEmailInput,
  options: EmailRenderOptions = {},
): Promise<RenderedInsightsDigestEmail> {
  const itemsText =
    input.items.length === 0
      ? input.emptyText
      : input.items.map((item) => [item.title, ...item.lines].join("\n")).join("\n\n");

  const content = (
    <Section>
      <Text style={pStyle}>{input.intro}</Text>
      {input.items.length === 0 ? (
        <Text style={pStyle}>{input.emptyText}</Text>
      ) : (
        input.items.map((item) => (
          <Section
            key={item.title}
            style={{ borderTop: `1px solid ${emailTokens.rule}`, padding: "12px 0" }}
          >
            <Text style={{ ...pStyle, fontWeight: 700, marginBottom: 6 }}>{item.title}</Text>
            {item.lines.map((line, i) => (
              <Text key={i} style={smallStyle}>
                {line}
              </Text>
            ))}
          </Section>
        ))
      )}
      <Text style={smallStyle}>
        <Link href={input.unsubscribeUrl} style={emailStyles.link}>
          {input.unsubscribeLabel}
        </Link>
      </Text>
    </Section>
  );
  const layout = await renderLayout(
    {
      title: input.title,
      preheader: input.intro,
      bodyHtml: content,
      bodyText: `${input.intro}\n\n${itemsText}\n\n${input.unsubscribeLabel}: ${input.unsubscribeUrl}`,
      ctaLabel: input.appLabel,
      ctaUrl: input.appUrl,
      footerText: input.footer,
    },
    options,
  );

  return { subject: input.subject, html: layout.html, text: layout.text };
}
