import { describe, expect, test } from "bun:test";
import { AdmissionError, type PublicSignUpService } from "@openvalens/auth/admission";
import type { DeploymentConfig } from "@openvalens/auth/deployment";

import type { Context } from "../context";
import { clientIpFrom, SignUpRateLimiter } from "../sign-up";
import { appRouter } from "./index";

/** Issue #294 — `signUp` RPC: mode gate, origin, per-IP/per-email limits, no enumeration. */

const ORIGIN = "https://app.test";
const CLOUD: DeploymentConfig = {
  mode: "cloud",
  legal: {
    terms: { url: "https://legal.test/terms", version: "t-1" },
    privacy: { url: "https://legal.test/privacy", version: "p-1" },
    healthDataConsent: { url: "https://legal.test/privacy", version: "h-1" },
  },
};

type Call = Parameters<PublicSignUpService["signUpPublic"]>[0];

function signUpService(
  impl: (input: Call) => Promise<{ accepted: true }> = async () => ({ accepted: true }),
): PublicSignUpService & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    enabled: true,
    calls,
    signUpPublic: async (input) => {
      calls.push(input);
      return impl(input);
    },
    completePublicSignUp: async () => ({ status: "invalid" }),
  };
}

function context(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": "203.0.113.7" },
): Context {
  return {
    session: null,
    db: {},
    correlationId: "corr-1",
    admissionOrigin: ORIGIN,
    deployment: CLOUD,
    publicSignUp: signUpService(),
    signUpRateLimiter: new SignUpRateLimiter(),
    honoContext: { req: { raw: { headers: new Headers(headers) } } },
    ...overrides,
  } as unknown as Context;
}

const body = {
  email: "new@example.test",
  acceptedLegal: true as const,
  acceptedHealthDataConsent: true as const,
  healthDataConsentVersion: "h-1",
};
const call = (ctx: Context, input: unknown = body) =>
  appRouter.signUp.request.callable({ context: ctx })(input as typeof body);

describe("signUp.options", () => {
  test("self-hosted (no deployment in context) has no sign-up and no legal links", async () => {
    expect(
      await appRouter.signUp.options.callable({ context: context({ deployment: undefined }) })({}),
    ).toEqual({
      mode: "self-hosted",
      signUp: false,
      terms: null,
      privacy: null,
      healthDataConsent: null,
    });
  });

  test("cloud exposes the mode and the terms/privacy links and versions", async () => {
    expect(await appRouter.signUp.options.callable({ context: context() })({})).toEqual({
      mode: "cloud",
      signUp: true,
      terms: CLOUD.mode === "cloud" ? CLOUD.legal.terms : null,
      privacy: CLOUD.mode === "cloud" ? CLOUD.legal.privacy : null,
      healthDataConsent: CLOUD.mode === "cloud" ? CLOUD.legal.healthDataConsent : null,
    });
  });
});

describe("signUp.request", () => {
  test("is NOT_FOUND on a self-hosted deployment, before origin or input checks", async () => {
    const service = signUpService();
    await expect(
      call(context({ deployment: { mode: "self-hosted" }, publicSignUp: service }, {}), {
        junk: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(context({ deployment: undefined, publicSignUp: service })),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(service.calls).toHaveLength(0);
  });

  test("refuses a foreign or missing Origin", async () => {
    const service = signUpService();
    await expect(
      call(context({ publicSignUp: service }, { origin: "https://evil.test" })),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(call(context({ publicSignUp: service }, {}))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(service.calls).toHaveLength(0);
  });

  test("requires ticking the terms and privacy policy, with a value-free error", async () => {
    const service = signUpService();
    let error: unknown;
    try {
      await call(context({ publicSignUp: service }), {
        email: "secret-person@example.test",
        acceptedLegal: false,
        acceptedHealthDataConsent: true,
        healthDataConsentVersion: "h-1",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(error)).not.toContain("secret-person");
    expect(service.calls).toHaveLength(0);
  });

  test("passes email, locale and acceptance to the admission core", async () => {
    const service = signUpService();
    expect(await call(context({ publicSignUp: service }), { ...body, locale: "pt-PT" })).toEqual({
      accepted: true,
    });
    expect(service.calls).toEqual([{ ...body, locale: "pt-PT" }]);
  });

  test("missing or false health-data consent is rejected before the admission core", async () => {
    const service = signUpService();
    await expect(
      call(context({ publicSignUp: service }), {
        email: "missing@example.test",
        acceptedLegal: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      call(context({ publicSignUp: service }), {
        ...body,
        acceptedHealthDataConsent: false,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(service.calls).toHaveLength(0);
  });

  test("forwards the presented health-consent version to the admission core", async () => {
    const service = signUpService();
    await call(context({ publicSignUp: service }), { ...body, healthDataConsentVersion: "stale" });
    expect(service.calls[0]).toMatchObject({
      acceptedHealthDataConsent: true,
      healthDataConsentVersion: "stale",
    });
  });

  test("answers identically whether or not the email has an account", async () => {
    // The core takes a different branch for a known address but resolves the
    // same way; the router must not add any difference of its own.
    const known = await call(context({ publicSignUp: signUpService() }), {
      ...body,
      email: "known@example.test",
    });
    const unknown = await call(context({ publicSignUp: signUpService() }), {
      ...body,
      email: "unknown@example.test",
    });
    expect(known).toEqual(unknown);
  });

  test("a delivery failure is a generic INTERNAL, whichever branch failed", async () => {
    const service = signUpService(async () => {
      throw new AdmissionError("DELIVERY_FAILED");
    });
    await expect(call(context({ publicSignUp: service }))).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("per-email limit: the 4th request for one address in the window is refused", async () => {
    const limiter = new SignUpRateLimiter();
    const service = signUpService();
    for (let i = 0; i < 3; i += 1) {
      await call(
        context(
          { publicSignUp: service, signUpRateLimiter: limiter },
          { origin: ORIGIN, "x-forwarded-for": `198.51.100.${i}` },
        ),
        { ...body, email: i === 1 ? "NEW@Example.test" : "new@example.test" },
      );
    }
    await expect(
      call(
        context(
          { publicSignUp: service, signUpRateLimiter: limiter },
          { origin: ORIGIN, "x-forwarded-for": "198.51.100.99" },
        ),
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(service.calls).toHaveLength(3);
    // Another address is unaffected.
    await expect(
      call(context({ publicSignUp: service, signUpRateLimiter: limiter }), {
        ...body,
        email: "other@example.test",
      }),
    ).resolves.toEqual({ accepted: true });
  });

  test("per-IP limit: one client cannot cycle through many addresses", async () => {
    const limiter = new SignUpRateLimiter();
    const service = signUpService();
    const fromIp = (ip: string) =>
      context(
        { publicSignUp: service, signUpRateLimiter: limiter },
        { origin: ORIGIN, "x-forwarded-for": ip },
      );
    for (let i = 0; i < 10; i += 1) {
      await call(fromIp("203.0.113.50"), { ...body, email: `person${i}@example.test` });
    }
    await expect(
      call(fromIp("203.0.113.50"), { ...body, email: "person-next@example.test" }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // The IP limit applies before input validation: even a malformed body counts.
    await expect(call(fromIp("203.0.113.50"), { nope: true })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(
      call(fromIp("203.0.113.51"), { ...body, email: "person-next@example.test" }),
    ).resolves.toEqual({ accepted: true });
    expect(service.calls).toHaveLength(11);
  });
});

describe("SignUpRateLimiter", () => {
  test("windows reset and sweep drops idle keys", () => {
    let now = 0;
    const limiter = new SignUpRateLimiter({
      perIp: 1,
      perEmail: 1,
      windowMs: 1000,
      now: () => now,
    });
    expect(limiter.checkIp("a").allowed).toBe(true);
    expect(limiter.checkIp("a").allowed).toBe(false);
    expect(limiter.checkEmail("x@example.test").allowed).toBe(true);
    expect(limiter.checkEmail("X@EXAMPLE.TEST").allowed).toBe(false);
    now = 1001;
    expect(limiter.checkIp("a").allowed).toBe(true);
    expect(limiter.checkEmail("x@example.test").allowed).toBe(true);
  });

  test("memory stays bounded by recent traffic", () => {
    let now = 0;
    const limiter = new SignUpRateLimiter({ windowMs: 1000, now: () => now });
    for (let i = 0; i < 499; i += 1) limiter.checkIp(`10.0.0.${i}`);
    expect(limiter.size).toBe(499);
    now = 5000;
    limiter.checkIp("10.1.0.1"); // the 500th check sweeps idle keys
    expect(limiter.size).toBe(1);
  });
});

describe("clientIpFrom", () => {
  test("takes the right-most X-Forwarded-For entry (the one our proxy appended)", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
    expect(clientIpFrom(new Headers({ "x-real-ip": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});
