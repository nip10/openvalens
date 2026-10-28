import { readBodyMapComposition, readBodyMapTraining } from "../body-map";
import {
  bodyMapCompositionInput,
  bodyMapCompositionOutput,
  bodyMapTrainingInput,
  bodyMapTrainingOutput,
} from "../contracts/body-map";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

/**
 * Issue #94 — body map, mounted as `appRouter.bodyMap`. Read-only.
 *
 * - `composition` — measured DEXA regional values for one scan, or two scans
 *   of the same record for compare mode. A scan outside the active record is
 *   `NOT_FOUND`, so compare can never mix records.
 * - `training`    — logged sets in the last 7 days per catalog exercise, with
 *   the catalog's muscles; unlinked exercises are listed, not counted.
 */
export const bodyMapRouter = {
  composition: permissionedProcedure({ resource: "dexa", action: "read" })
    .use(validateInput(bodyMapCompositionInput))
    .input(bodyMapCompositionInput)
    .output(bodyMapCompositionOutput)
    .handler(async ({ context, input }) => {
      const result = await readBodyMapComposition(
        context.db,
        context.authz.activeOrganizationId,
        input,
      );
      if (!result) throw raiseApiError("NOT_FOUND", "Scan not found.");
      return result;
    }),

  training: permissionedProcedure({ resource: "workout", action: "read" })
    .use(validateInput(bodyMapTrainingInput))
    .input(bodyMapTrainingInput)
    .output(bodyMapTrainingOutput)
    .handler(async ({ context, input }) =>
      readBodyMapTraining(
        context.db,
        context.authz.activeOrganizationId,
        context.authz.user.id,
        input.today,
      ),
    ),
};
