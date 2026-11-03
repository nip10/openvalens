import { msg } from "@lingui/core/macro";
import { Link, Section, Text } from "react-email";
import { emailI18n, emailStyles, renderLayout, type EmailRenderOptions } from "./layout";

export async function renderExistingPublicSignUpEmail(
  input: { loginUrl?: string | null },
  options: EmailRenderOptions = {},
) {
  const i18n = emailI18n(options);
  const intro = i18n._(
    msg`Someone asked to create an OpenValens account with this email address, but it already has one.`,
  );
  const signIn = (url: string) => i18n._(msg`To sign in, open ${url}.`);
  const ignore = i18n._(msg`If that wasn’t you, you can ignore this email.`);
  const subject = i18n._(msg`You already have an OpenValens account`);
  const bodyText = `${intro}${input.loginUrl ? ` ${signIn(input.loginUrl)}` : ""}\n\n${ignore}`;
  const layout = await renderLayout(
    {
      title: subject,
      preheader: intro,
      bodyHtml: (
        <Section>
          <Text style={emailStyles.paragraph}>{intro}</Text>
          {input.loginUrl ? (
            <Text style={emailStyles.paragraph}>
              <Link href={input.loginUrl} style={emailStyles.link}>
                {signIn(input.loginUrl)}
              </Link>
            </Text>
          ) : null}
          <Text style={emailStyles.paragraph}>{ignore}</Text>
        </Section>
      ),
      bodyText,
      hideFooter: true,
    },
    options,
  );
  return { subject, ...layout, templateName: "public-sign-up-existing" as const };
}
