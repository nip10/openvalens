import { msg } from "@lingui/core/macro";
import { Section, Text } from "react-email";
import {
  emailI18n,
  emailStyles,
  emailTokens,
  renderLayout,
  type EmailRenderOptions,
} from "./layout";

export type DailyReminderInput = {
  date: string;
  reminders: readonly { label: string; sourceType: "supplement" | "medication" | "activity" }[];
};

const categoryStyle = {
  color: emailTokens.signal,
  fontFamily: "Fraunces, Georgia, serif",
  fontSize: "18px",
  margin: "0 0 8px",
};
const itemStyle = { ...emailStyles.paragraph, marginBottom: "8px" };

export async function renderDailyReminderEmail(
  input: DailyReminderInput,
  options: EmailRenderOptions = {},
): Promise<{ subject: string; html: string; text: string }> {
  const i18n = emailI18n(options);
  const subject = i18n._(msg`Your daily reminders`);
  const labels = {
    supplement: i18n._(msg`Supplements`),
    medication: i18n._(msg`Medications`),
    activity: i18n._(msg`Activities`),
  } as const;
  const order = ["supplement", "medication", "activity"] as const;
  const groups = order
    .map((type) => ({ type, items: input.reminders.filter((item) => item.sourceType === type) }))
    .filter((group) => group.items.length);
  const body = (
    <Section>
      <Text style={itemStyle}>{i18n._(msg`Your reminders for ${input.date}.`)}</Text>
      {groups.length ? (
        groups.map(({ type, items }) => (
          <Section
            key={type}
            style={{ borderTop: `1px solid ${emailTokens.rule}`, padding: "12px 0 4px" }}
          >
            <Text style={categoryStyle}>{labels[type]}</Text>
            {items.map((item, index) => (
              <Text key={`${type}-${index}`} style={itemStyle}>
                {item.label}
              </Text>
            ))}
          </Section>
        ))
      ) : (
        <Text style={itemStyle}>{i18n._(msg`You have no reminders for today.`)}</Text>
      )}
    </Section>
  );
  const bodyText = groups.length
    ? groups
        .map(({ type, items }) => `${labels[type]}\n${items.map((item) => item.label).join("\n")}`)
        .join("\n\n")
    : i18n._(msg`You have no reminders for today.`);
  const layout = await renderLayout(
    {
      title: subject,
      preheader: i18n._(msg`Your reminders for ${input.date}.`),
      bodyHtml: body,
      bodyText: `${i18n._(msg`Your reminders for ${input.date}.`)}\n\n${bodyText}`,
    },
    options,
  );
  return { subject, html: layout.html, text: layout.text };
}
