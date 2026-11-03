import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { SOURCE_LOCALE, type Locale } from "@openvalens/i18n";
import { serverI18n } from "@openvalens/i18n/server";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
  render,
} from "react-email";
import type { ReactNode } from "react";

const FALLBACK_ORGANIZATION_NAME = "OpenValens";
export const emailTokens = {
  paper: "#fbf1ea",
  sheet: "#fffbf8",
  ink: "#2e211c",
  ink2: "#57463e",
  ink3: "#7a665b",
  rule: "#f0e0d6",
  rule2: "#e2c9ba",
  signal: "#c2512e",
  signal2: "#a8441f",
  signalInk: "#fff8f4",
} as const;
export const emailStyles = {
  paragraph: { color: emailTokens.ink, fontSize: "15px", lineHeight: "1.65", margin: "0 0 12px" },
  secondaryText: {
    color: emailTokens.ink2,
    fontSize: "14px",
    lineHeight: "1.5",
    margin: "0 0 6px",
  },
  link: { color: emailTokens.signal2 },
};
export type EmailRenderOptions = { organizationName?: string; locale?: Locale; logoUrl?: string };
export function emailLocale(options: EmailRenderOptions = {}): Locale {
  return options.locale ?? SOURCE_LOCALE;
}
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
export function renderParagraphs(lines: readonly string[]): ReactNode[] {
  return lines.map((line, i) => (
    <Text key={i} style={emailStyles.paragraph}>
      {line}
    </Text>
  ));
}
export type RenderLayoutInput = {
  title: string;
  bodyHtml: ReactNode;
  bodyText: string;
  preheader?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerText?: string;
  hideFooter?: boolean;
};
export type RenderedLayout = { html: string; text: string };
export async function renderLayout(
  input: RenderLayoutInput,
  options: EmailRenderOptions = {},
): Promise<RenderedLayout> {
  const organizationName = options.organizationName ?? FALLBACK_ORGANIZATION_NAME;
  const logoUrl =
    options.logoUrl ??
    "https://raw.githubusercontent.com/nip10/openvalens/main/apps/native/assets/images/icon.png";
  const logoAlt = options.logoUrl ? `${organizationName} logo` : "OpenValens logo";
  const year = new Date().getFullYear();
  const footerText = input.hideFooter
    ? undefined
    : (input.footerText ??
      emailI18n(options)._(msg`This is an automated message from ${organizationName}.`));
  const tree = (
    <Html lang={emailLocale(options)}>
      <Head />
      <Body
        lang={emailLocale(options)}
        style={{
          backgroundColor: emailTokens.paper,
          color: emailTokens.ink,
          fontFamily: "Figtree, 'Trebuchet MS', Arial, sans-serif",
          margin: 0,
          padding: "28px 12px",
        }}
      >
        <Preview>{input.preheader ?? input.title}</Preview>
        <Container
          style={{
            backgroundColor: emailTokens.sheet,
            border: `1px solid ${emailTokens.rule}`,
            borderRadius: "18px",
            margin: "0 auto",
            maxWidth: "560px",
            padding: "28px",
          }}
        >
          <Section>
            <Text
              style={{
                color: emailTokens.signal,
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: ".08em",
                margin: "0 0 10px",
                textTransform: "uppercase",
              }}
            >
              <Img
                src={logoUrl}
                width="28"
                height="28"
                alt={logoAlt}
                style={{ display: "inline-block", marginRight: "8px", verticalAlign: "middle" }}
              />
              <span style={{ verticalAlign: "middle" }}>{organizationName}</span>
            </Text>
            <Heading
              as="h1"
              style={{
                color: emailTokens.ink,
                fontFamily: "Fraunces, Georgia, serif",
                fontSize: "26px",
                lineHeight: "1.25",
                margin: "0 0 18px",
              }}
            >
              {input.title}
            </Heading>
            {input.bodyHtml}
            {input.ctaLabel && input.ctaUrl ? (
              <Button
                href={input.ctaUrl}
                style={{
                  backgroundColor: emailTokens.signal2,
                  borderRadius: "10px",
                  color: emailTokens.signalInk,
                  fontSize: "14px",
                  fontWeight: 700,
                  padding: "13px 20px",
                  textDecoration: "none",
                }}
              >
                {input.ctaLabel}
              </Button>
            ) : null}
            {footerText ? (
              <>
                <Hr
                  style={{
                    border: 0,
                    borderTop: `1px solid ${emailTokens.rule}`,
                    margin: "22px 0 12px",
                  }}
                />
                <Text
                  style={{
                    color: emailTokens.ink3,
                    fontSize: "12px",
                    lineHeight: "1.5",
                    margin: "0 0 6px",
                  }}
                >
                  {footerText}
                </Text>
                <Text
                  style={{
                    color: emailTokens.ink3,
                    fontSize: "12px",
                    lineHeight: "1.5",
                    margin: 0,
                  }}
                >
                  {FALLBACK_ORGANIZATION_NAME} · © {year}
                </Text>
              </>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
  const text = await render(tree, { plainText: true });
  const explicitText = [
    input.bodyText,
    input.ctaLabel && input.ctaUrl ? `${input.ctaLabel}: ${input.ctaUrl}` : "",
    footerText,
    footerText ? `${FALLBACK_ORGANIZATION_NAME} © ${year}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { html: await render(tree), text: explicitText || text };
}
