import { isAdmissionError } from "@openvalens/auth/admission";
import { z } from "zod";

import { mapAdmissionError, requireAdmissionOrigin, safeAdmissionInput } from "../admission";
import { raiseApiError } from "../errors";
import { o, publicProcedure } from "../index";
import {
  clientIpFrom,
  requireSignUpEnabled,
  signUpOptionsFrom,
  signUpRequestInput,
} from "../sign-up";

/**
 * Issue #294 — `signUp` RPC namespace (public sign-up for OpenValens Cloud).
 *
 * `options` is a public read: the deployment mode, whether anyone may sign
 * up, and in Cloud the terms and privacy links and versions the form shows.
 * The web reads it to decide whether `/signup` and "Create account" exist.
 *
 * `request` starts a sign-up. It is `NOT_FOUND` on a self-hosted deployment.
 * In Cloud it enforces the same-origin `Origin` check, then the per-IP limit,
 * then value-free input validation, then the per-email limit, and finally
 * asks the admission core to email a sign-up link. It answers
 * `{ accepted: true }` whether or not the email already has an account.
 */

const legalDocument = z.object({ url: z.string(), version: z.string() });
const optionsOutput = z.object({
  mode: z.enum(["self-hosted", "cloud"]),
  signUp: z.boolean(),
  terms: legalDocument.nullable(),
  privacy: legalDocument.nullable(),
});
const requestOutput = z.object({ accepted: z.literal(true) });

const RATE_LIMITED_MESSAGE = "Too many attempts; try again later.";

/** 404 off Cloud, then same-origin, then the per-IP limit — all before the body is parsed. */
const signUpGate = o.middleware(async ({ context, next }) => {
  requireSignUpEnabled(context);
  requireAdmissionOrigin(context);
  const limiter = context.signUpRateLimiter;
  if (!limiter) throw raiseApiError("INTERNAL", "Something went wrong.");
  if (!limiter.checkIp(clientIpFrom(context.honoContext.req.raw.headers)).allowed) {
    throw raiseApiError("RATE_LIMITED", RATE_LIMITED_MESSAGE);
  }
  return next({});
});

export const signUpRouter = {
  options: publicProcedure
    .input(z.object({}))
    .output(optionsOutput)
    .handler(async ({ context }) => signUpOptionsFrom(context.deployment)),

  request: publicProcedure
    .use(signUpGate)
    .use(safeAdmissionInput(signUpRequestInput))
    .input(signUpRequestInput)
    .output(requestOutput)
    .handler(async ({ context, input }) => {
      if (!context.signUpRateLimiter!.checkEmail(input.email).allowed) {
        throw raiseApiError("RATE_LIMITED", RATE_LIMITED_MESSAGE);
      }

      try {
        return await context.publicSignUp!.signUpPublic({
          email: input.email,
          acceptedLegal: input.acceptedLegal,
          ...(input.locale ? { locale: input.locale } : {}),
        });
      } catch (error) {
        // A malformed address is refused by the core as `DENIED`; that is an
        // input problem, the same for every address, never an existence hint.
        if (isAdmissionError(error) && error.code === "DENIED") {
          throw raiseApiError("INVALID_INPUT", "Invalid input");
        }
        mapAdmissionError(error);
      }
    }),
};
