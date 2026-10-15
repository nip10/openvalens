import { createStructuredLogger } from "@openvalens/observability";
import { z } from "zod";

import { protectedProcedure, validateInput } from "../index";
import {
  createWellnessProfileService,
  mapWellnessProfileError,
  requireProfileOwner,
} from "../wellness-profile";
import {
  wellnessProfileSnapshotSchema,
  wellnessProfileUpdateInput,
} from "../wellness-profile-contract";

/**
 * Issue #98 — the signed-in person's own wellness profile.
 *
 * - `profile.get`    — the caller's snapshot (an empty profile when nothing
 *                      has been answered).
 * - `profile.update` — strict partial update with `expectedRevision`.
 *
 * Both are keyed only by the trusted session user: there is no user or
 * organization id in the input, no workspace role grants access, and an
 * impersonated session is denied. Logs carry field names and consent purposes,
 * never answers.
 */

const logger = createStructuredLogger({ level: "info" });
const emptyInput = z.strictObject({});

export const profileRouter = {
  get: protectedProcedure
    .use(validateInput(emptyInput))
    .input(emptyInput)
    .output(wellnessProfileSnapshotSchema)
    .handler(async ({ context }) => {
      const userId = requireProfileOwner(context.session);
      try {
        return await createWellnessProfileService({ db: context.db }).read(userId);
      } catch (error) {
        mapWellnessProfileError(error);
      }
    }),

  update: protectedProcedure
    .use(validateInput(wellnessProfileUpdateInput))
    .input(wellnessProfileUpdateInput)
    .output(wellnessProfileSnapshotSchema)
    .handler(async ({ context, input }) => {
      const userId = requireProfileOwner(context.session);
      try {
        const outcome = await createWellnessProfileService({ db: context.db }).update(
          userId,
          input,
        );
        if (outcome.changedFields.length > 0 || outcome.consentChanges.length > 0) {
          logger.info("profile.updated", {
            correlationId: context.correlationId,
            changedFields: outcome.changedFields,
            consentChanges: outcome.consentChanges.map((c) => `${c.purpose}:${c.action}`),
            revision: outcome.snapshot.revision,
          });
        }
        return outcome.snapshot;
      } catch (error) {
        mapWellnessProfileError(error);
      }
    }),
};
