import { describe, expect, test } from "bun:test";

import { renderAiAppConnectedEmail } from "./ai-app-connected";

const INPUT = {
  appName: "Claude",
  clientIdHost: "claude.ai",
  workspaceName: "Ada's records",
  connectedAt: "13 November 2026, 10:00 UTC",
  manageUrl: "https://app.example.test/settings/ai-apps",
};

describe("renderAiAppConnectedEmail", () => {
  test("names the app, its host and the workspace and links to revoke it", async () => {
    const email = await renderAiAppConnectedEmail(INPUT);
    expect(email.subject).toBe("A new AI app was connected to OpenValens");
    expect(email.text).toContain('"Claude"');
    expect(email.text).toContain("claude.ai");
    expect(email.text).toContain("Ada's records");
    expect(email.text).toContain("not verified");
    expect(email.text).toContain("Not you?");
    expect(email.html).toContain("https://app.example.test/settings/ai-apps");
  });

  test("omits the host for a dynamically registered app", async () => {
    const email = await renderAiAppConnectedEmail({ ...INPUT, clientIdHost: null });
    expect(email.text).not.toContain("(from");
  });

  test("renders in European Portuguese", async () => {
    const email = await renderAiAppConnectedEmail(INPUT, { locale: "pt-PT" });
    expect(email.subject).not.toBe("A new AI app was connected to OpenValens");
    expect(email.text).toContain("Claude");
  });
});
