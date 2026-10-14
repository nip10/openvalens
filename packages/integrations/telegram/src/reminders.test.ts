import { describe, expect, test } from "bun:test";
import type { Database } from "@openvalens/db";
import type { EmailService, SendEmailInput, SendEmailOptions } from "@openvalens/email";
import { createStructuredLogger } from "@openvalens/observability";

import { materializeDailyReminders } from "./reminders";

function createFakeEmailService() {
  let sendCount = 0;
  return {
    sendCount,
    service: {
      sendEmail: async (_input: SendEmailInput, _options?: SendEmailOptions) => {
        sendCount += 1;
        return { id: "email-1", dryRun: false };
      },
      organizationName: "Health",
    } as unknown as EmailService,
  };
}

/**
 * The reminders materializer short-circuits before touching the database when
 * no Telegram client is configured. This is the only unit-testable branch in
 * isolation; everything else is exercised by the disposable-DB integration
 * suite (see `reminders.integration.test.ts`).
 */
describe("materializeDailyReminders — short-circuit", () => {
  test("returns zeros without a Telegram client and without DB calls", async () => {
    const result = await materializeDailyReminders({
      db: {} as Database,
      client: null,
      logger: createStructuredLogger({ level: "info" }),
      correlationId: "corr-no-client",
      organizationId: "org-1",
      email: createFakeEmailService().service,
    });

    expect(result).toEqual({
      organizationId: "org-1",
      date: result.date,
      sent: 0,
      skipped: 0,
      failed: 0,
    });
  });
});
