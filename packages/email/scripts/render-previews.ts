import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderAdmissionInvitationEmail } from "../src/templates/admission-invitation";
import { renderAdmissionVerificationEmail } from "../src/templates/admission-verification";
import { renderAccessRequestApprovedEmail } from "../src/templates/access-request-approved";
import { renderAccessRequestDeniedEmail } from "../src/templates/access-request-denied";
import { renderAccessRequestSubmittedEmail } from "../src/templates/access-request-submitted";
import { renderBillingEmail } from "../src/templates/billing";
import { renderDailyReminderEmail } from "../src/templates/daily-reminder";
import { renderExistingPublicSignUpEmail } from "../src/templates/public-sign-up-existing";
import { renderPublicSignUpEmail } from "../src/templates/public-sign-up";
import { renderInsightsDigestEmail } from "../src/templates/insights-digest";
import { renderInvitationEmail } from "../src/templates/invitation";
import { renderInvitationReminderEmail } from "../src/templates/invitation-reminder";
import { renderInvitationRevokedEmail } from "../src/templates/invitation-revoked";
import { renderMagicLinkEmail } from "../src/templates/magic-link";

const output = resolve(import.meta.dir, "../previews/generated");
await mkdir(output, { recursive: true });
const previews = {
  "magic-link": await renderMagicLinkEmail({
    url: "https://app.example/sign-in?token=preview",
    expiresInMinutes: 10,
  }),
  invitation: await renderInvitationEmail({
    inviterName: "Morgan Lee",
    organizationName: "Bloom Clinic",
    acceptUrl: "https://app.example/invite/preview",
    expiresInDays: 7,
    role: "member",
  }),
  "invitation-reminder": await renderInvitationReminderEmail({
    inviterName: "Morgan Lee",
    organizationName: "Bloom Clinic",
    acceptUrl: "https://app.example/invite/preview",
    expiresInDays: 3,
    role: "member",
  }),
  "invitation-revoked": await renderInvitationRevokedEmail({
    inviterName: "Morgan Lee",
    organizationName: "Bloom Clinic",
  }),
  "access-request-approved": await renderAccessRequestApprovedEmail({
    requesterName: "Taylor Reed",
    organizationName: "Bloom Clinic",
    loginUrl: "https://app.example/login",
  }),
  "access-request-denied": await renderAccessRequestDeniedEmail({
    requesterName: "Taylor Reed",
    organizationName: "Bloom Clinic",
  }),
  "access-request-submitted": await renderAccessRequestSubmittedEmail({
    requesterName: "Taylor Reed",
    organizationName: "Bloom Clinic",
    reviewUrl: "https://app.example/review",
  }),
  billing: await renderBillingEmail({
    kind: "trial_ending",
    billingUrl: "https://app.example/settings/billing",
    trialEndsAt: new Date("2026-11-05T00:00:00Z"),
  }),
  "insights-digest": await renderInsightsDigestEmail({
    subject: "Your weekly insights summary",
    title: "Your weekly insights",
    intro: "A short summary of changes in your records.",
    emptyText: "Nothing stood out this week.",
    items: [
      {
        title: "Sleep was shorter than usual",
        lines: ["Your average was 6 hours and 10 minutes."],
      },
      { title: "Your activity increased", lines: ["You recorded four walks this week."] },
    ],
    appUrl: "https://app.example/dashboard",
    appLabel: "Open OpenValens",
    unsubscribeUrl: "https://app.example/email-preferences",
    unsubscribeLabel: "Manage email preferences",
    footer: "You receive this because you enabled weekly insights.",
  }),
  "insights-digest-pt-PT": await renderInsightsDigestEmail(
    {
      subject: "Resumo semanal",
      title: "Os seus dados desta semana",
      intro: "Um breve resumo dos seus registos.",
      emptyText: "Não há novidades esta semana.",
      items: [
        { title: "O sono foi mais curto", lines: ["A sua média foi de 6 horas e 10 minutos."] },
        { title: "A atividade aumentou", lines: ["Registou quatro caminhadas esta semana."] },
      ],
      appUrl: "https://app.example/dashboard",
      appLabel: "Abrir OpenValens",
      unsubscribeUrl: "https://app.example/email-preferences",
      unsubscribeLabel: "Gerir preferências de email",
      footer: "Recebe esta mensagem porque ativou o resumo semanal.",
    },
    { locale: "pt-PT" },
  ),
  "daily-reminder": await renderDailyReminderEmail({
    date: "Monday, November 2",
    reminders: [
      { label: "Vitamin D and breakfast", sourceType: "supplement" },
      { label: "Take prescribed medication", sourceType: "medication" },
      { label: "A short walk after lunch", sourceType: "activity" },
    ],
  }),
  "admission-verification": await renderAdmissionVerificationEmail("482 193"),
  "admission-invitation": await renderAdmissionInvitationEmail({
    token: "invite-9f4c",
    joinUrl: "https://app.example/join",
  }),
  "public-sign-up": await renderPublicSignUpEmail({
    url: "https://api.example/verify?token=preview",
  }),
  "public-sign-up-existing": await renderExistingPublicSignUpEmail({
    loginUrl: "https://app.example/login",
  }),
};
for (const [name, email] of Object.entries(previews)) {
  await writeFile(resolve(output, `${name}.html`), email.html, "utf8");
  await writeFile(resolve(output, `${name}.txt`), email.text, "utf8");
}
console.log(`Rendered ${Object.keys(previews).length} email previews to ${output}`);
