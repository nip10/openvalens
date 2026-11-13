import { isLocale, LOCALES } from "@openvalens/i18n";
import { z } from "zod";

import { protectedProcedure, raiseApiError, validateInput } from "../index";
import { requireProfileOwner } from "../wellness-profile";
import {
  pickWhatsNewCard,
  readWhatsNewState,
  serverReleaseNotes,
  whatsNewOutputSchema,
  writeWhatsNewState,
} from "../whats-new";

/**
 * Issue #446 — the "What's new" card on Today, mounted as
 * `appRouter.whatsNew`. The member's own, non-impersonated session only.
 */

/** The app's current language; without it, the member's saved one. */
const getInput = z.strictObject({ locale: z.enum(LOCALES).optional() });
const dismissInput = z.strictObject({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });
const setEnabledInput = z.strictObject({ enabled: z.boolean() });

export const whatsNewRouter = {
  get: protectedProcedure
    .use(validateInput(getInput))
    .input(getInput)
    .output(whatsNewOutputSchema)
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        const state = await readWhatsNewState(context.db, userId);
        const locale = input.locale ?? (isLocale(state.locale) ? state.locale : "en");
        return {
          enabled: state.enabled,
          card: pickWhatsNewCard(serverReleaseNotes(), state, locale),
        };
      } catch {
        throw raiseApiError("INTERNAL", "Unable to load preferences. Try again.");
      }
    }),

  dismiss: protectedProcedure
    .use(validateInput(dismissInput))
    .input(dismissInput)
    .output(z.object({ dismissedVersion: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        await writeWhatsNewState(context.db, userId, { dismissedVersion: input.version });
        return { dismissedVersion: input.version };
      } catch {
        throw raiseApiError("INTERNAL", "Unable to save preferences. Try again.");
      }
    }),

  setEnabled: protectedProcedure
    .use(validateInput(setEnabledInput))
    .input(setEnabledInput)
    .output(z.object({ enabled: z.boolean() }))
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        await writeWhatsNewState(context.db, userId, { enabled: input.enabled });
        return { enabled: input.enabled };
      } catch {
        throw raiseApiError("INTERNAL", "Unable to save preferences. Try again.");
      }
    }),
};
