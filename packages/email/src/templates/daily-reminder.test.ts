import { describe, expect, test } from "bun:test";
import { renderDailyReminderEmail } from "./daily-reminder";

describe("daily reminder email", () => {
  test("groups reminders by category and escapes labels", async () => {
    const email = await renderDailyReminderEmail({
      date: "2026-11-02",
      reminders: [
        { label: "Vitamin <D> & zinc", sourceType: "supplement" },
        { label: "Morning walk", sourceType: "activity" },
        { label: "Medication A", sourceType: "medication" },
        { label: "Evening supplement", sourceType: "supplement" },
      ],
    });
    expect(email.subject).toBe("Your daily reminders");
    expect(email.html.indexOf("Supplements")).toBeLessThan(email.html.indexOf("Medications"));
    expect(email.html.indexOf("Medications")).toBeLessThan(email.html.indexOf("Activities"));
    expect(email.html).toContain("Vitamin &lt;D&gt; &amp; zinc");
    expect(email.text).toContain("Medication A");
  });
  test("renders a no-reminders message", async () => {
    const email = await renderDailyReminderEmail({ date: "today", reminders: [] });
    expect(email.text).toContain("You have no reminders for today.");
  });
});
