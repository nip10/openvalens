import { createHash } from "node:crypto";

import { InMemoryRateLimiter } from "@openvalens/ai/rate-limit";
import { canonicalizeEmail } from "@openvalens/auth/admission";
import type { DeploymentConfig } from "@openvalens/auth/deployment";
import { LOCALES } from "@openvalens/i18n";
import { z } from "zod";

import type { Context } from "./context";
import { raiseApiError } from "./errors";

/**
 * Public sign-up HTTP boundary (Issue #294, Cloud only).
 *
 * Abuse controls live here, in front of the admission core:
 * - a per-IP and a per-email limit on sign-up requests (process-local, like
 *   the other admission limiters);
 * - the email key is a SHA-256 digest of the canonical address, so the
 *   limiter never holds a plaintext email;
 * - the per-email limit applies whether or not the address has an account,
 *   so hitting it reveals nothing about the address.
 */

/** Sign-up requests one client IP may make per window. */
export const SIGN_UP_REQUESTS_PER_IP = 10;
/** Sign-up requests for one email address per window (mirrors admission's 3 sends). */
export const SIGN_UP_REQUESTS_PER_EMAIL = 3;
export const SIGN_UP_RATE_WINDOW_MS = 10 * 60 * 1000;
const SWEEP_EVERY = 500;

export type SignUpRateLimitDecision = { allowed: true } | { allowed: false; scope: "ip" | "email" };

/** Per-IP and per-email sliding-window limiter for sign-up requests. */
export class SignUpRateLimiter {
  private readonly byIp: InMemoryRateLimiter;
  private readonly byEmail: InMemoryRateLimiter;
  private checks = 0;

  constructor(
    options: {
      perIp?: number;
      perEmail?: number;
      windowMs?: number;
      now?: () => number;
    } = {},
  ) {
    const windowMs = options.windowMs ?? SIGN_UP_RATE_WINDOW_MS;
    this.byIp = new InMemoryRateLimiter({
      limitPerMinute: options.perIp ?? SIGN_UP_REQUESTS_PER_IP,
      windowMs,
      now: options.now,
    });
    this.byEmail = new InMemoryRateLimiter({
      limitPerMinute: options.perEmail ?? SIGN_UP_REQUESTS_PER_EMAIL,
      windowMs,
      now: options.now,
    });
  }

  /** Counts one request from `ip`. Checked before the body is parsed. */
  checkIp(ip: string): SignUpRateLimitDecision {
    this.maybeSweep();
    return this.byIp.check(`ip:${ip}`).allowed
      ? { allowed: true }
      : { allowed: false, scope: "ip" };
  }

  /** Counts one request for `email` (any spelling of the same canonical address). */
  checkEmail(email: string): SignUpRateLimitDecision {
    const canonical = canonicalizeEmail(email) ?? email.toLowerCase();
    const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
    return this.byEmail.check(`email:${digest}`).allowed
      ? { allowed: true }
      : { allowed: false, scope: "email" };
  }

  /** Keys currently tracked across both limiters. */
  get size(): number {
    return this.byIp.size + this.byEmail.size;
  }

  private maybeSweep(): void {
    this.checks += 1;
    if (this.checks % SWEEP_EVERY !== 0) return;
    this.byIp.sweep();
    this.byEmail.sweep();
  }
}

/**
 * The client IP for rate limiting: the right-most `X-Forwarded-For` entry,
 * which is the one the nearest proxy (Caddy in `deploy/`) appended and the
 * client cannot forge. Without the header every request shares one bucket,
 * which fails safe (stricter), never open.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  if (last) return last.slice(0, 64);
  const real = headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 64) : "unknown";
}

/** Public, value-free sign-up options for the web and mobile sign-in screens. */
export type SignUpOptions = {
  mode: DeploymentConfig["mode"];
  signUp: boolean;
  terms: { url: string; version: string } | null;
  privacy: { url: string; version: string } | null;
  healthDataConsent: { url: string; version: string } | null;
};

export function signUpOptionsFrom(deployment: DeploymentConfig | undefined): SignUpOptions {
  if (deployment?.mode !== "cloud") {
    return {
      mode: "self-hosted",
      signUp: false,
      terms: null,
      privacy: null,
      healthDataConsent: null,
    };
  }
  return {
    mode: "cloud",
    signUp: true,
    terms: deployment.legal.terms,
    privacy: deployment.legal.privacy,
    healthDataConsent: deployment.legal.healthDataConsent,
  };
}

/** Sign-up is a 404 everywhere except Cloud: self-host has no such feature. */
export function requireSignUpEnabled(context: Context): void {
  if (context.deployment?.mode !== "cloud" || !context.publicSignUp?.enabled) {
    throw raiseApiError("NOT_FOUND", "Not found.");
  }
}

export const signUpRequestInput = z.object({
  email: z.string().min(1).max(320),
  // The app language, for the email and the new account. Anything unshipped
  // is ignored rather than rejected.
  locale: z.enum(LOCALES).optional().catch(undefined),
  // The person ticked "I agree to the terms of service and privacy policy".
  acceptedLegal: z.literal(true),
  acceptedHealthDataConsent: z.literal(true),
  healthDataConsentVersion: z.string().min(1).max(64),
});
