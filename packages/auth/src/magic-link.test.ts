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
      return { id: "msg-1", dryRun: false };
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

  test("fails closed without any provider call when no sender is injected", async () => {
    await expect(sendAuthMagicLink(PAYLOAD, {} as never)).rejects.toThrow(
      "Magic-link email delivery is not configured.",
    );
  });

  test("threads the injected branding name into the rendered email", async () => {
    const calls: CapturedCall[] = [];
    const emailSender: SendEmailFn = async (input, options) => {
      calls.push({ input, options });
      return { id: "msg-1", dryRun: false };
    };

    await sendAuthMagicLink(PAYLOAD, {
      sendEmail: emailSender,
      organizationName: "Alpha Health",
    });

    expect(calls[0]?.input.html).toContain("Alpha Health");
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
    expect(failure?.errorCategory).toBe("provider_unavailable");
    expect(failure?.retryable).toBe(true);
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
    expect(failure?.errorCategory).toBe("rejected");
    expect(failure?.retryable).toBe(false);
  });

  test("dev link sink receives the URL only when the email was a dry run", async () => {
    const seen: string[] = [];
    const { logger, lines } = createCapturingLogger();

    await sendAuthMagicLink(PAYLOAD, {
      sendEmail: async () => ({ id: "dry-run", dryRun: true }),
      logger,
      devLinkSink: (url) => seen.push(url),
    });
    expect(seen).toEqual([PAYLOAD.url]);
    // The structured log still never carries the token.
    expect(lines.join("\n")).not.toContain("raw-token-value");

    await sendAuthMagicLink(PAYLOAD, {
      sendEmail: async () => ({ id: "msg-1", dryRun: false }),
      logger,
      devLinkSink: (url) => seen.push(url),
    });
    expect(seen).toHaveLength(1);
  });

  test("dry-run without an enabled sink rejects without logging a sent event", async () => {
    const { logger, lines } = createCapturingLogger();

    await expect(
      sendAuthMagicLink(PAYLOAD, {
        sendEmail: async () => ({ id: "dry-run", dryRun: true }),
        logger,
      }),
    ).rejects.toThrow("Magic-link email delivery is not configured.");

    expect(lines.map(parseLine).some((line) => line.event === "auth.magic-link.sent")).toBe(false);
    expect(lines.join("\n")).not.toContain("raw-token-value");
    expect(lines.join("\n")).not.toContain("https://app.example");
  });

  test("a throwing dry-run sink rejects with a sanitized error and no sent event", async () => {
    const { logger, lines } = createCapturingLogger();

    await expect(
      sendAuthMagicLink(PAYLOAD, {
        sendEmail: async () => ({ id: "dry-run", dryRun: true }),
        logger,
        devLinkSink: () => {
          throw new Error(`sink failed for ${PAYLOAD.url}`);
        },
      }),
    ).rejects.toThrow("Magic-link email delivery is not configured.");

    expect(lines.map(parseLine).some((line) => line.event === "auth.magic-link.sent")).toBe(false);
    expect(lines.join("\n")).not.toContain("raw-token-value");
    expect(lines.join("\n")).not.toContain("https://app.example");
  });

  test("real provider delivery does not require a development sink", async () => {
    const { logger, lines } = createCapturingLogger();

    await expect(
      sendAuthMagicLink(PAYLOAD, {
        sendEmail: async () => ({ id: "msg-1", dryRun: false }),
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(lines.map(parseLine).some((line) => line.event === "auth.magic-link.sent")).toBe(true);
  });
});
