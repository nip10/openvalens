import { describe, expect, test } from "bun:test";

import { renderInvitationReminderEmail } from "./invitation-reminder";

const INPUT = {
  inviterName: "Dr. Ada",
  organizationName: "Northwind Clinic",
  acceptUrl: "https://app.example/accept-invitation?invitation=inv_1",
  expiresInDays: 2,
  role: "collaborator",
};

describe("renderInvitationReminderEmail", () => {
  test("uses the exact subject", () => {
    expect(renderInvitationReminderEmail(INPUT).subject).toBe(
      "Reminder: join Northwind Clinic on Health",
    );
  });

  test("html contains the placeholder values", () => {
    const { html } = renderInvitationReminderEmail(INPUT);

    expect(html).toContain("Dr. Ada");
    expect(html).toContain("Northwind Clinic");
    expect(html).toContain("collaborator");
    expect(html).toContain("Accept invitation");
  });

  test("text contains the placeholder values and accept url", () => {
    const { text } = renderInvitationReminderEmail(INPUT);

    expect(text).toContain("Northwind Clinic");
    expect(text).toContain(INPUT.acceptUrl);
  });
});
