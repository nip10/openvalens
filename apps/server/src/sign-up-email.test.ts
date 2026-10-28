import { describe, expect, test } from "bun:test";
import type { SendEmailInput } from "@openvalens/email";
import { shouldAuditBcc } from "@openvalens/email/audit-bcc";

import { createSignUpEmailDelivery } from "./admission-email";

/** Issue #294 — Cloud sign-up email: link for a new address, sign-in pointer otherwise. */

function setup(dryRun = false) {
  const sent: SendEmailInput[] = [];
  const deliver = createSignUpEmailDelivery({
    email: {
      sendEmail: async (input) => {
        sent.push(input);
        return { id: dryRun ? "dry-run" : "msg-1", dryRun };
      },
    },
    webOrigin: "https://app.test/ignored-path",
  });
  return { deliver, sent };
}

const LINK = "https://api.test/api/auth/admission/sign-up/verify?token=abc&x=<1>";

describe("sign-up email", () => {
  test("a new address gets the single-use link, escaped in HTML", async () => {
    const { deliver, sent } = setup();
    await deliver({ kind: "new", email: "new@example.test", url: LINK });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("new@example.test");
    expect(sent[0]?.subject).toBe("Create your OpenValens account");
    expect(sent[0]?.text).toContain(LINK);
    expect(sent[0]?.html).toContain(
      'href="https://api.test/api/auth/admission/sign-up/verify?token=abc&amp;x=&lt;1&gt;"',
    );
    expect(sent[0]?.templateName).toBe("public-sign-up");
  });

  test("an existing account gets a sign-in pointer and no link that creates anything", async () => {
    const { deliver, sent } = setup();
    await deliver({ kind: "existing", email: "known@example.test" });
    expect(sent[0]?.subject).toBe("You already have an OpenValens account");
    expect(sent[0]?.text).toContain("https://app.test/login");
    expect(sent[0]?.text).not.toContain("sign-up/verify");
    expect(sent[0]?.templateName).toBe("public-sign-up-existing");
  });

  test("is written in the language the person signed up in", async () => {
    const { deliver, sent } = setup();
    await deliver({ kind: "new", email: "pt@example.test", url: LINK, locale: "pt-PT" });
    expect(sent[0]?.subject).not.toBe("Create your OpenValens account");
  });

  test("a dry run is a delivery failure, never a claimed delivery", async () => {
    const { deliver } = setup(true);
    await expect(deliver({ kind: "new", email: "new@example.test", url: LINK })).rejects.toThrow();
  });

  test("the link is a credential: neither template is audit-BCC'd", () => {
    expect(shouldAuditBcc("public-sign-up")).toBe(false);
    expect(shouldAuditBcc("public-sign-up-existing")).toBe(false);
  });
});
