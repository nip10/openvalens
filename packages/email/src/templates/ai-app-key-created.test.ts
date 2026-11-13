import { describe, expect, test } from "bun:test";

import { renderAiAppKeyCreatedEmail } from "./ai-app-key-created";

const INPUT = {
  keyName: "Claude Code laptop",
  keyPrefix: "ov_AbCdEf",
  workspaceName: "Ada's records",
  createdAt: "12 November 2026, 10:00",
  expiresAt: "10 February 2027",
  manageUrl: "https://app.example.test/settings/ai-apps",
};

describe("renderAiAppKeyCreatedEmail", () => {
  test("names the key and workspace and links to revoke it", async () => {
    const email = await renderAiAppKeyCreatedEmail(INPUT);
    expect(email.subject).toBe("A new personal API key was created for OpenValens");
    expect(email.text).toContain("Claude Code laptop");
    expect(email.text).toContain("ov_AbCdEf");
    expect(email.text).toContain("Ada's records");
    expect(email.text).toContain("10 February 2027");
    expect(email.text).toContain("Not you?");
    expect(email.html).toContain("https://app.example.test/settings/ai-apps");
  });

  test("says when a key never expires", async () => {
    const email = await renderAiAppKeyCreatedEmail({ ...INPUT, expiresAt: null });
    expect(email.text).toContain("does not expire");
  });

  test("renders in European Portuguese", async () => {
    const email = await renderAiAppKeyCreatedEmail(INPUT, { locale: "pt-PT" });
    expect(email.subject).not.toBe("A new personal API key was created for OpenValens");
    expect(email.text).toContain("Claude Code laptop");
  });
});
