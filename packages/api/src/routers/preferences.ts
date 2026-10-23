import { LOCALES } from "@openvalens/i18n";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";
import { readUserLocale, writeUserLocale } from "../locale";
import { requireProfileOwner } from "../wellness-profile";

/**
 * Issue #231 — the member's own preferences, mounted as
 * `appRouter.preferences`. Today: the interface language, which server-sent
 * email and push use. The member's own, non-impersonated session only.
 */

const emptyInput = z.strictObject({});
const localeOutput = z.object({ locale: z.enum(LOCALES) });
const setLocaleInput = z.strictObject({ locale: z.enum(LOCALES) });

export const preferencesRouter = {
  get: protectedProcedure
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(localeOutput)
    .handler(async ({ context }) => {
      const userId = requireProfileOwner(context.session);
      try {
        return { locale: await readUserLocale(context.db, userId) };
      } catch {
        throw raiseApiError("INTERNAL", "Unable to load preferences. Try again.");
      }
    }),

  setLocale: protectedProcedure
    .use(validateInput(setLocaleInput))
    .input(setLocaleInput)
    .output(localeOutput)
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        await writeUserLocale(context.db, userId, input.locale);
        return { locale: input.locale };
      } catch {
        throw raiseApiError("INTERNAL", "Unable to save preferences. Try again.");
      }
    }),
};
