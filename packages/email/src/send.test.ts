import { afterEach, describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openvalens/observability";

import type { EmailConfig } from "./config";
import {
  describeEmailDeliveryError,
  EmailPermanentError,
  EmailTransientError,
  ResendProvider,
  sanitizeProviderErrorName,
  type EmailProvider,
  type ResendSendInput,
} from "./provider";
import { sendEmail, toResendTags } from "./send";

const BASE_CONFIG: EmailConfig = {
  RESEND_API_KEY: "re_test_1234567890",
  EMAIL_FROM: "Health <noreply@health.example>",
  EMAIL_REPLY_TO: "support@health.example",
  EMAIL_AUDIT_BCC: "audit@health.example",
  EMAIL_DRY_RUN: false,
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

class FakeProvider implements EmailProvider {
  readonly calls: ResendSendInput[] = [];

  constructor(
    private readonly result: { id: string } = { id: "provider-123" },
    private readonly error: Error | null = null,
  ) {}

  async send(input: ResendSendInput): Promise<{ id: string }> {
    this.calls.push(input);

    if (this.error) {
      throw this.error;
    }

    return this.result;
  }
}

const BASE_INPUT = {
  to: "patient@example.com",
  subject: "Sign in to Health",
  html: "<p>hello</p>",
  text: "hello",
  templateName: "magic-link",
  tags: ["magic-link"],
};

describe("sendEmail", () => {
  test("dry-run returns the sentinel id and logs email.send.dry-run", async () => {
    const { logger, lines } = createCapturingLogger();
    const provider = new FakeProvider();

    const result = await sendEmail(BASE_INPUT, {
      config: BASE_CONFIG,
      dryRun: true,
      correlationId: "corr-1",
      logger,
      provider,
    });

    expect(result).toEqual({ id: "dry-run", dryRun: true });
    expect(provider.calls).toHaveLength(0);

    const record = parseLine(lines.at(-1) ?? "");
    expect(record.event).toBe("email.send.dry-run");
    expect(record.correlationId).toBe("corr-1");
    expect(record.templateName).toBe("magic-link");
    expect(record.recipients).toEqual(["p***@example.com"]);
    expect(record.subject).toBe("Sign in to Health");
    // PHI safety — the raw recipient must never appear in the log line.
    expect(lines.join("\n")).not.toContain("patient@example.com");
  });

  test("forces dry-run when no API key is configured", async () => {
    const { logger } = createCapturingLogger();
    const provider = new FakeProvider();

    const result = await sendEmail(BASE_INPUT, {
      config: { ...BASE_CONFIG, RESEND_API_KEY: null },
      dryRun: false,
      logger,
      provider,
    });

    expect(result.dryRun).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  test("sends through the provider and logs email.send.queued", async () => {
    const { logger, lines } = createCapturingLogger();
    const provider = new FakeProvider({ id: "provider-abc" });

    const result = await sendEmail(BASE_INPUT, {
      config: BASE_CONFIG,
      dryRun: false,
      correlationId: "corr-2",
      logger,
      provider,
    });

    expect(result).toEqual({ id: "provider-abc", dryRun: false });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.from).toBe("Health <noreply@health.example>");
    expect(provider.calls[0]?.replyTo).toBe("support@health.example");
    expect(provider.calls[0]?.to).toBe("patient@example.com");
    expect(provider.calls[0]?.tags).toEqual([{ name: "tag", value: "magic-link" }]);

    const record = parseLine(lines.at(-1) ?? "");
    expect(record.event).toBe("email.send.queued");
    expect(record.providerId).toBe("provider-abc");
    expect(record.recipients).toEqual(["p***@example.com"]);
    expect(lines.join("\n")).not.toContain("patient@example.com");
    expect(lines.join("\n")).not.toContain("hello");
  });

  test("auto-applies the audit BCC to sensitive templates", async () => {
    const { logger } = createCapturingLogger();
    const provider = new FakeProvider();

    await sendEmail(
      { ...BASE_INPUT, templateName: "invitation", tags: ["invitation"] },
      { config: BASE_CONFIG, logger, provider },
    );

    expect(provider.calls[0]?.bcc).toBe("audit@health.example");
  });

  test("does not apply the audit BCC to non-sensitive templates", async () => {
    const { logger } = createCapturingLogger();
    const provider = new FakeProvider();

    await sendEmail(BASE_INPUT, { config: BASE_CONFIG, logger, provider });

    expect(provider.calls[0]?.bcc).toBeUndefined();
  });

  test("logs email.send.failed with the typed code and rethrows", async () => {
    const { logger, lines } = createCapturingLogger();
    const provider = new FakeProvider({ id: "x" }, new EmailTransientError(503, "unavailable"));

    await expect(
      sendEmail(BASE_INPUT, { config: BASE_CONFIG, logger, provider }),
    ).rejects.toBeInstanceOf(EmailTransientError);

    const record = parseLine(lines.at(-1) ?? "");
    expect(record.event).toBe("email.send.failed");
    expect(record.errorCode).toBe("EMAIL_TRANSIENT");
    expect(record.recipients).toEqual(["p***@example.com"]);
  });

  test("the failure log is categorized and never carries secrets or content", async () => {
    const { logger, lines } = createCapturingLogger();
    const provider = new FakeProvider({ id: "x" }, new EmailPermanentError(401, "missing_api_key"));

    await expect(
      sendEmail(BASE_INPUT, { config: BASE_CONFIG, logger, provider, correlationId: "corr-f" }),
    ).rejects.toBeInstanceOf(EmailPermanentError);

    const record = parseLine(lines.at(-1) ?? "");
    expect(record).toMatchObject({
      level: "error",
      event: "email.send.failed",
      correlationId: "corr-f",
      templateName: "magic-link",
      errorCode: "EMAIL_PERMANENT",
      errorCategory: "auth",
      retryable: false,
      status: 401,
      providerError: "missing_api_key",
    });

    const output = lines.join("\n");
    expect(output).not.toContain(BASE_CONFIG.RESEND_API_KEY ?? "unset");
    expect(output).not.toContain("patient@example.com");
    expect(output).not.toContain("<p>hello</p>");
    expect(output).not.toContain("audit@health.example");
  });

  test("an untyped failure is logged as EMAIL_UNKNOWN without its message", async () => {
    const { logger, lines } = createCapturingLogger();
    const provider = new FakeProvider({ id: "x" }, new Error("boom patient@example.com"));

    await expect(
      sendEmail(BASE_INPUT, { config: BASE_CONFIG, logger, provider }),
    ).rejects.toThrow();

    const record = parseLine(lines.at(-1) ?? "");
    expect(record).toMatchObject({
      errorCode: "EMAIL_UNKNOWN",
      errorCategory: "unknown",
      retryable: false,
    });
    expect(lines.join("\n")).not.toContain("patient@example.com");
  });

  test("sends tags as Resend name/value pairs, dropping invalid and duplicate values", async () => {
    const provider = new FakeProvider();
    const { logger } = createCapturingLogger();

    await sendEmail(
      { ...BASE_INPUT, tags: ["magic-link", "magic-link", "has space", "a@b.example"] },
      { config: BASE_CONFIG, logger, provider },
    );

    expect(provider.calls[0]?.tags).toEqual([{ name: "tag", value: "magic-link" }]);
  });
});

describe("toResendTags", () => {
  test("keeps Resend-safe values in order and collapses duplicates", () => {
    expect(toResendTags(["invitation", "access_request-2", "invitation"])).toEqual([
      { name: "tag", value: "invitation" },
      { name: "tag", value: "access_request-2" },
    ]);
  });

  test("returns undefined when nothing survives", () => {
    expect(toResendTags(undefined)).toBeUndefined();
    expect(toResendTags([])).toBeUndefined();
    expect(toResendTags(["", "x".repeat(257), "naïve"])).toBeUndefined();
  });
});

describe("delivery error categorization", () => {
  test.each([
    [0, "TypeError", EmailTransientError, "network", true],
    [0, "TimeoutError", EmailTransientError, "timeout", true],
    [429, "rate_limit_exceeded", EmailTransientError, "rate_limited", true],
    [500, "internal_server_error", EmailTransientError, "provider_unavailable", true],
    [503, null, EmailTransientError, "provider_unavailable", true],
    [401, "missing_api_key", EmailPermanentError, "auth", false],
    [403, "invalid_api_key", EmailPermanentError, "auth", false],
    [422, "validation_error", EmailPermanentError, "rejected", false],
  ] as const)(
    "status %p (%p) → %p / %p",
    (status, providerError, ErrorClass, category, retryable) => {
      const error = new ErrorClass(status, providerError);
      expect(error.category).toBe(category);
      expect(error.retryable).toBe(retryable);
      expect(describeEmailDeliveryError(error)).toEqual({
        errorCode: error.code,
        errorCategory: category,
        retryable,
        status,
        ...(providerError ? { providerError } : {}),
      });
    },
  );

  test("non-provider errors are unknown and not retryable", () => {
    expect(describeEmailDeliveryError(new Error("x"))).toEqual({
      errorCode: "EMAIL_UNKNOWN",
      errorCategory: "unknown",
      retryable: false,
    });
    expect(describeEmailDeliveryError("string")).toMatchObject({ errorCategory: "unknown" });
  });

  test("provider error names that are not identifier-shaped are dropped", () => {
    expect(sanitizeProviderErrorName("validation_error")).toBe("validation_error");
    expect(sanitizeProviderErrorName(" TimeoutError ")).toBe("TimeoutError");
    expect(sanitizeProviderErrorName("patient@example.com")).toBeNull();
    expect(sanitizeProviderErrorName("Invalid `to` field: patient")).toBeNull();
    expect(sanitizeProviderErrorName("x".repeat(65))).toBeNull();
    expect(sanitizeProviderErrorName(42)).toBeNull();

    const error = new EmailPermanentError(422, "echo patient@example.com");
    expect(error.providerError).toBeNull();
    expect(error.message).not.toContain("patient@example.com");
  });
});

describe("ResendProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const sendInput: ResendSendInput = {
    from: "Health <noreply@health.example>",
    to: "patient@example.com",
    subject: "Sign in to Health",
    html: "<p>secret body</p>",
    text: "secret text",
  };

  test("returns the provider message id on success", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "msg-1" }), { status: 200 })) as unknown as typeof fetch;

    const provider = new ResendProvider("re_test_1234567890");
    const result = await provider.send(sendInput);

    expect(result).toEqual({ id: "msg-1" });
  });

  test("5xx responses throw EmailTransientError", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "internal_server_error" }), {
        status: 500,
      })) as unknown as typeof fetch;

    const provider = new ResendProvider("re_test_1234567890");

    await expect(provider.send(sendInput)).rejects.toBeInstanceOf(EmailTransientError);
  });

  test("4xx responses throw EmailPermanentError", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "validation_error" }), {
        status: 422,
      })) as unknown as typeof fetch;

    const provider = new ResendProvider("re_test_1234567890");

    await expect(provider.send(sendInput)).rejects.toBeInstanceOf(EmailPermanentError);
  });

  test("429 responses are retryable and categorized as rate_limited", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "rate_limit_exceeded" }), {
        status: 429,
      })) as unknown as typeof fetch;

    const error = await new ResendProvider("re_test_1234567890").send(sendInput).catch((e) => e);

    expect(error).toBeInstanceOf(EmailTransientError);
    expect(error).toMatchObject({ category: "rate_limited", providerError: "rate_limit_exceeded" });
  });

  test("401 responses are permanent auth failures", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "missing_api_key" }), {
        status: 401,
      })) as unknown as typeof fetch;

    const error = await new ResendProvider("re_test_1234567890").send(sendInput).catch((e) => e);

    expect(error).toBeInstanceOf(EmailPermanentError);
    expect(error).toMatchObject({ category: "auth", status: 401 });
  });

  test("a network failure is a transient network error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED re_secret");
    }) as unknown as typeof fetch;

    const error = await new ResendProvider("re_test_1234567890").send(sendInput).catch((e) => e);

    expect(error).toBeInstanceOf(EmailTransientError);
    expect(error).toMatchObject({ category: "network", status: 0, providerError: "TypeError" });
    expect(error.message).not.toContain("ECONNREFUSED");
  });

  test("a hung request is aborted and categorized as timeout", async () => {
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;

    const error = await new ResendProvider("re_test_1234567890", { timeoutMs: 5 })
      .send(sendInput)
      .catch((e) => e);

    expect(error).toBeInstanceOf(EmailTransientError);
    expect(error).toMatchObject({ category: "timeout", providerError: "TimeoutError" });
  });

  test("an unsafe provider error name is not echoed", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "bad patient@example.com" }), {
        status: 422,
      })) as unknown as typeof fetch;

    const error = await new ResendProvider("re_test_1234567890").send(sendInput).catch((e) => e);

    expect(error).toMatchObject({ category: "rejected", providerError: null });
    expect(error.message).not.toContain("patient@example.com");
  });

  test("exceptions never leak the api key, recipient, or body", async () => {
    const apiKey = "re_secret_key_abcdef";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "validation_error", message: "echo" }), {
        status: 422,
      })) as unknown as typeof fetch;

    const provider = new ResendProvider(apiKey);

    try {
      await provider.send(sendInput);
      throw new Error("expected provider.send to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(apiKey);
      expect(message).not.toContain("patient@example.com");
      expect(message).not.toContain("secret body");
      expect(message).not.toContain("secret text");
      expect(message).toContain("422");
    }
  });
});
