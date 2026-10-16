import { describe, expect, test } from "bun:test";

import { renderInsightsDigestEmail } from "./insights-digest";

const INPUT = {
  subject: "Your weekly insights summary",
  title: "Your weekly insights",
  intro: "These describe changes in your own records.",
  emptyText: "Nothing stood out this week.",
  items: [
    { title: "Sleep lower than your usual", lines: ["Your 7-day average <sleep> was 6h 10m."] },
  ],
  appUrl: "https://app.example.test/dashboard",
  appLabel: "Open OpenValens",
  unsubscribeUrl: "https://app.example.test/unsubscribe?token=abc",
  unsubscribeLabel: "Turn off this email",
  footer: "You get this email because you turned on the weekly insights summary.",
};

describe("renderInsightsDigestEmail", () => {
  test("lists each insight, escapes text and links a one-step unsubscribe", () => {
    const { subject, html, text } = renderInsightsDigestEmail(INPUT);
    expect(subject).toBe("Your weekly insights summary");
    expect(html).toContain("Sleep lower than your usual");
    expect(html).toContain("&lt;sleep&gt;");
    expect(html).toContain('href="https://app.example.test/unsubscribe?token=abc"');
    expect(text).toContain("Turn off this email: https://app.example.test/unsubscribe?token=abc");
    expect(text).toContain("Open OpenValens: https://app.example.test/dashboard");
  });

  test("an empty week says so instead of listing nothing", () => {
    const { text } = renderInsightsDigestEmail({ ...INPUT, items: [] });
    expect(text).toContain("Nothing stood out this week.");
  });
});
