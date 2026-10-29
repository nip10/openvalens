import { randomUUID } from "node:crypto";

import { sql } from "@openvalens/db";
import { z } from "zod";

import { requireAdmissionOrigin } from "../admission";
import type { Context } from "../context";
import { raiseApiError } from "../errors";
import { o, sessionProcedure } from "../index";

const statusOutput = z.object({
  required: z.boolean(),
  currentVersion: z.string().nullable(),
  accepted: z.boolean(),
  acceptedVersion: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  privacyUrl: z.string().nullable(),
});

const input = z.object({ acceptedHealthDataConsent: z.literal(true), version: z.string().min(1).max(64) });

function current(context: Context) {
  return context.deployment?.mode === "cloud" ? context.deployment.legal?.healthDataConsent ?? null : null;
}

function trustedUserId(context: Context) {
  const userId = context.session?.user?.id;
  if (!userId) throw raiseApiError("UNAUTHENTICATED", "Authentication required.");
  if (context.session?.session?.impersonatedBy) {
    throw raiseApiError("PERMISSION_DENIED", "You do not have permission to perform this action.");
  }
  return userId;
}

async function statusFor(context: Context) {
  const userId = trustedUserId(context);
  const policy = current(context);
  if (!policy) {
    return {
      required: false,
      currentVersion: null,
      accepted: true,
      acceptedVersion: null,
      acceptedAt: null,
      privacyUrl: null,
    };
  }
  try {
    const result = await context.db.execute(sql`
      select "version", "accepted_at" from "legal_acceptance"
      where "user_id" = ${userId} and "document" = 'health_data_consent'
      order by "accepted_at" desc, "created_at" desc limit 1
    `);
    const latest = result.rows[0] as { version: string; accepted_at: Date | string } | undefined;
    const acceptedVersion = latest?.version ?? null;
    const acceptedAt = latest
      ? (latest.accepted_at instanceof Date
          ? latest.accepted_at
          : new Date(String(latest.accepted_at))).toISOString()
      : null;
    return {
      required: true,
      currentVersion: policy.version,
      accepted: acceptedVersion === policy.version,
      acceptedVersion,
      acceptedAt,
      privacyUrl: policy.url,
    };
  } catch {
    throw raiseApiError("INTERNAL", "Something went wrong.");
  }
}

export const healthConsentRouter = {
  status: sessionProcedure
    .input(z.object({}))
    .output(statusOutput)
    .handler(({ context }) => statusFor(context)),

  accept: sessionProcedure
    .use(o.middleware(async ({ context, next }) => {
      requireAdmissionOrigin(context);
      trustedUserId(context);
      return next({});
    }))
    .input(input)
    .output(statusOutput)
    .handler(async ({ context, input: value }) => {
      const policy = current(context);
      if (!policy) return statusFor(context);
      if (value.version !== policy.version) {
        throw raiseApiError("INVALID_INPUT", "Consent version is no longer current.");
      }
      const userId = trustedUserId(context);
      try {
        await context.db.execute(sql`
          insert into "legal_acceptance" ("id", "user_id", "document", "version", "accepted_at", "source")
          values (${randomUUID()}, ${userId}, 'health_data_consent', ${policy.version}, clock_timestamp(), 're_consent')
          on conflict ("user_id", "document", "version") do nothing
        `);
      } catch {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }
      return statusFor(context);
    }),
};
