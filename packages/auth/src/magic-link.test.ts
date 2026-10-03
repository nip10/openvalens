import { describe, expect, test } from "bun:test";
import {
  EmailPermanentError,
  EmailTransientError,
  type SendEmailFn,
  type SendEmailInput,
  type SendEmailOptions,
} from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import { sendAuthMagicLink } from "./magic-link";

const PAYLOAD = {
  url: "https://app.example/api/auth/magic-link/verify?token=raw-token-value&callbackURL=%2F",
  email: "user@example.com",
  token: "raw-token-value",
  correlationId: "corr-1",
};

function createCapturingLogger() {
  const lines: string[] = [];
  const logger = createStructuredLogger({
    level: "debug",
    sink: (_level, line) => lines.push(line),
  });

  return { logger, lines };
}

function parseLine(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

type CapturedCall = { input: SendEmailInput; options?: SendEmailOptions };

describe("sendAuthMagicLink", () => {
  test("delegates the full recipient to sendEmail and keeps logs PHI-safe", async () => {
    const calls: CapturedCall[] = [];
    const emailSender: SendEmailFn = async (input, options) => {
      calls.push({ input, options });
      return { id: "dry-run", dryRun: true };
    };

    const { logger, lines } = createCapturingLogger();

    await sendAuthMagicLink(PAYLOAD, { sendEmail: emailSender, logger });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input.to).toBe("user@example.com");
    expect(calls[0]?.input.subject).toBe("Sign in to Health");
    expect(calls[0]?.input.templateName).toBe("magic-link");
    expect(calls[0]?.input.tags).toEqual(["magic-link"]);
    expect(calls[0]?.options?.correlationId).toBe("corr-1");

    const joined = lines.join("\n");
    expect(joined).not.toContain("raw-token-value");
    expect(joined).not.toContain("user@example.com");
    expect(joined).not.toContain("token=");

    const success = lines.map(parseLine).find((line) => line.event === "auth.magic-link.sent");
    expect(success).toBeDefined();
    expect(success?.recipient).toBe("us***@example.com");
    expect(success?.tokenFingerprint).toBeString();
    expect(success?.linkHost).toBe("app.example");
  });

  test("logs EMAIL_TRANSIENT and rethrows on a transient provider failure", async () => {
    const emailSender: SendEmailFn = async () => {
      throw new EmailTransientError(503, "provider_unavailable");
    };

    const { logger, lines } = createCapturingLogger();

    await expect(
      sendAuthMagicLink(PAYLOAD, { sendEmail: emailSender, logger }),
    ).rejects.toBeInstanceOf(EmailTransientError);

    const failure = lines
      .map(parseLine)
      .find((line) => line.event === "auth.magic-link.send.failed");
    expect(failure).toBeDefined();
    expect(failure?.code).toBe("EMAIL_TRANSIENT");
    expect(lines.join("\n")).not.toContain("user@example.com");
  });

  test("logs EMAIL_PERMANENT and swallows the error on a permanent failure", async () => {
    const emailSender: SendEmailFn = async () => {
      throw new EmailPermanentError(422, "validation_error");
    };

    const { logger, lines } = createCapturingLogger();

    await expect(
      sendAuthMagicLink(PAYLOAD, { sendEmail: emailSender, logger }),
    ).resolves.toBeUndefined();

    const failure = lines
      .map(parseLine)
      .find((line) => line.event === "auth.magic-link.send.failed");
    expect(failure).toBeDefined();
    expect(failure?.code).toBe("EMAIL_PERMANENT");
  });
});
