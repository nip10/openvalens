import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "@openvalens/observability";

import { EmailConfigError, type EmailConfig } from "./config";
import { EmailTransientError, type EmailProvider, type ResendSendInput } from "./provider";
import { createEmailService, sendEmail } from "./send";

const ALPHA_CONFIG: EmailConfig = {
  RESEND_API_KEY: "re_alpha_key_1234567890",
  EMAIL_FROM: "Alpha <noreply@alpha.example>",
  EMAIL_REPLY_TO: "alpha-support@alpha.example",
  EMAIL_AUDIT_BCC: "alpha-audit@alpha.example",
  EMAIL_DRY_RUN: false,
};

const BETA_CONFIG: EmailConfig = {
  RESEND_API_KEY: "re_beta_key_1234567890",
  EMAIL_FROM: "Beta <noreply@beta.example>",
  EMAIL_REPLY_TO: "beta-support@beta.example",
  EMAIL_AUDIT_BCC: "beta-audit@beta.example",
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

const INPUT = {
  to: "patient@example.com",
  subject: "Sign in to OpenValens",
  html: "<p>hello</p>",
  text: "hello",
  templateName: "magic-link",
  tags: ["magic-link"],
};

describe("createEmailService", () => {
  test("exposes only sendEmail and organizationName and is frozen", () => {
    const service = createEmailService(ALPHA_CONFIG);

    expect(Object.keys(service).sort()).toEqual(["organizationName", "sendEmail"]);
    expect(Object.isFrozen(service)).toBe(true);
    // The raw config / API key are never reachable from the public object.
    expect("config" in service).toBe(false);
    expect("RESEND_API_KEY" in service).toBe(false);
    expect(JSON.stringify(service)).not.toContain(ALPHA_CONFIG.RESEND_API_KEY);
  });

  test("derives organizationName from the sender display name, falling back to OpenValens", () => {
    expect(createEmailService(ALPHA_CONFIG).organizationName).toBe("Alpha");
    expect(
      createEmailService({ ...ALPHA_CONFIG, EMAIL_FROM: "noreply@alpha.example" }).organizationName,
    ).toBe("OpenValens");
  });

  test("two services in one process keep distinct sender/reply/bcc and name", async () => {
    const alphaProvider = new FakeProvider({ id: "alpha-id" });
    const betaProvider = new FakeProvider({ id: "beta-id" });
    const alpha = createEmailService(ALPHA_CONFIG, { provider: alphaProvider });
    const beta = createEmailService(BETA_CONFIG, { provider: betaProvider });

    await alpha.sendEmail({ ...INPUT, templateName: "invitation", tags: ["invitation"] });
    await beta.sendEmail({ ...INPUT, templateName: "invitation", tags: ["invitation"] });

    expect(alphaProvider.calls[0]?.from).toBe("Alpha <noreply@alpha.example>");
    expect(alphaProvider.calls[0]?.replyTo).toBe("alpha-support@alpha.example");
    expect(alphaProvider.calls[0]?.bcc).toBe("alpha-audit@alpha.example");
    expect(betaProvider.calls[0]?.from).toBe("Beta <noreply@beta.example>");
    expect(betaProvider.calls[0]?.replyTo).toBe("beta-support@beta.example");
    expect(betaProvider.calls[0]?.bcc).toBe("beta-audit@beta.example");
    expect(alpha.organizationName).toBe("Alpha");
    expect(beta.organizationName).toBe("Beta");
  });

  test("snapshots config so mutating the original after binding has no effect", async () => {
    const config: EmailConfig = { ...ALPHA_CONFIG };
    const provider = new FakeProvider();
    const service = createEmailService(config, { provider });

    config.EMAIL_FROM = "Mutated <noreply@evil.example>";
    config.EMAIL_REPLY_TO = "evil@evil.example";
    config.RESEND_API_KEY = "re_evil_key_0000000000";

    await service.sendEmail(INPUT);

    expect(provider.calls[0]?.from).toBe("Alpha <noreply@alpha.example>");
    expect(provider.calls[0]?.replyTo).toBe("alpha-support@alpha.example");
    expect(service.organizationName).toBe("Alpha");
  });

  test("preserves per-call config/provider/dryRun/logger/correlationId overrides", async () => {
    const defaultProvider = new FakeProvider({ id: "default" });
    const overrideProvider = new FakeProvider({ id: "override" });
    const { logger, lines } = createCapturingLogger();
    const service = createEmailService(ALPHA_CONFIG, { provider: defaultProvider });

    // Per-call config override must win over the bound snapshot.
    await service.sendEmail(INPUT, {
      config: BETA_CONFIG,
      provider: overrideProvider,
      dryRun: false,
      logger,
      correlationId: "corr-override",
    });

    expect(defaultProvider.calls).toHaveLength(0);
    expect(overrideProvider.calls[0]?.from).toBe("Beta <noreply@beta.example>");

    const record = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;
    expect(record.correlationId).toBe("corr-override");
    expect(record.event).toBe("email.send.queued");
  });

  test("per-call dryRun forces dry-run and never touches the provider", async () => {
    const provider = new FakeProvider();
    const service = createEmailService(ALPHA_CONFIG, { provider });

    const result = await service.sendEmail(INPUT, { dryRun: true });

    expect(result).toEqual({ id: "dry-run", dryRun: true });
    expect(provider.calls).toHaveLength(0);
  });

  test("an absent API key forces dry-run even when dryRun:false is passed", async () => {
    const provider = new FakeProvider();
    const service = createEmailService(
      { ...ALPHA_CONFIG, RESEND_API_KEY: null, EMAIL_DRY_RUN: false },
      { provider },
    );

    const result = await service.sendEmail(INPUT, { dryRun: false });

    expect(result.dryRun).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  test("applies the audit BCC to allow-listed templates only", async () => {
    const provider = new FakeProvider();
    const service = createEmailService(ALPHA_CONFIG, { provider });

    await service.sendEmail({ ...INPUT, templateName: "invitation", tags: ["invitation"] });
    await service.sendEmail({ ...INPUT, templateName: "magic-link", tags: ["magic-link"] });

    expect(provider.calls[0]?.bcc).toBe("alpha-audit@alpha.example");
    expect(provider.calls[1]?.bcc).toBeUndefined();
  });

  test("logger output never contains the API key, recipient, or body", async () => {
    const { logger, lines } = createCapturingLogger();
    const provider = new FakeProvider({ id: "x" }, new EmailTransientError(503, "unavailable"));
    const service = createEmailService(ALPHA_CONFIG, { provider, logger });

    await expect(service.sendEmail(INPUT, { correlationId: "corr-1" })).rejects.toBeInstanceOf(
      EmailTransientError,
    );

    const output = lines.join("\n");
    expect(output).not.toContain(ALPHA_CONFIG.RESEND_API_KEY);
    expect(output).not.toContain("patient@example.com");
    expect(output).not.toContain("hello");
  });
});

describe("sendEmail (unbound)", () => {
  test("throws a value-free EmailConfigError before touching the provider when config is missing", async () => {
    const provider = new FakeProvider();

    let caught: unknown;
    try {
      await sendEmail(INPUT, { provider } as never);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EmailConfigError);
    expect((caught as EmailConfigError).code).toBe("EMAIL_CONFIG_INVALID");
    expect(provider.calls).toHaveLength(0);

    const message = (caught as Error).message;
    expect(message).not.toContain("patient@example.com");
    expect(message).not.toContain("re_alpha_key");
    expect(message).not.toContain("hello");
  });

  test("sends with an explicit config", async () => {
    const provider = new FakeProvider({ id: "explicit-id" });

    const result = await sendEmail(INPUT, { config: ALPHA_CONFIG, provider });

    expect(result).toEqual({ id: "explicit-id", dryRun: false });
    expect(provider.calls[0]?.from).toBe("Alpha <noreply@alpha.example>");
  });
});
