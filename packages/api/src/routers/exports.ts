import {
  createClinicalExportRepository,
  normalizeClinicalExportLimit,
} from "@openhealth/clinical-export";
import { z } from "zod";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

const bundleInput = z
  .strictObject({
    limit: z.union([z.number(), z.string()]).optional().transform(normalizeClinicalExportLimit),
  })
  .default({ limit: 200 });

export const exportsRouter = {
  clinicalBundle: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(bundleInput))
    .input(bundleInput)
    .handler(({ context, input }) => {
      // The source checked this optional header; this API accepts no tenant overrides,
      // even an override naming the active org. Identity is exclusively authz-derived.
      if (context.honoContext.req.raw.headers.has("x-organization-id"))
        throw raiseApiError("INVALID_INPUT", "Organization overrides are not supported.");
      return createClinicalExportRepository(context.db).buildBundle(
        context.authz.activeOrganizationId,
        { limit: input.limit },
      );
    }),
};
