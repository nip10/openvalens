import { type Database } from "@openhealth/db";
import { writeAuditLog } from "@openhealth/audit-security";
import {
  buildExportPayload,
  createClinicalExportRepository,
  EXPORT_SCHEMA_VERSION,
  isExportDomain,
  normalizeClinicalExportLimit,
  parseExportRequest,
  renderCsvExport,
  type CsvExportFile,
  type ExportDomain,
  type ExportPayload,
  type ParseExportRequestResult,
} from "@openhealth/clinical-export";
import { z } from "zod";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

const bundleInput = z
  .strictObject({
    limit: z.union([z.number(), z.string()]).optional().transform(normalizeClinicalExportLimit),
  })
  .default({ limit: 200 });

const legacyDownloadInput = z.strictObject({
  domains: z
    .array(z.string())
    .optional()
    .transform((domains, ctx) => {
      if (!domains) return undefined;
      const valid = domains.filter(isExportDomain) as ExportDomain[];
      if (valid.length === 0) {
        ctx.addIssue({ code: "custom", message: "Request body failed validation." });
        return z.NEVER;
      }
      return valid;
    }),
  format: z.literal("csv").optional().default("csv"),
});

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
  legacyDownload: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(legacyDownloadInput))
    .input(legacyDownloadInput)
    .handler(async ({ context, input }) => {
      // Reject tenant-override headers — identity is exclusively authz-derived.
      if (context.honoContext.req.raw.headers.has("x-organization-id"))
        throw raiseApiError("INVALID_INPUT", "Organization overrides are not supported.");

      // The strict schema rejects empty domain arrays; when the caller omits
      // `domains` we fall back to the anchor's canonical defaults.
      const domains: ExportDomain[] =
        input.domains ?? (["blood", "body", "medications", "supplements"] as ExportDomain[]);

      // Defense in depth: the source accepts an unknown domain as a
      // sanitized rejection. We mirror that path through `parseExportRequest`
      // even though our Zod input already filters unknowns, so the validation
      // surface and error codes remain identical to the source.
      const requestCheck: ParseExportRequestResult = parseExportRequest({
        format: "csv",
        domains,
      });
      if (!requestCheck.ok) {
        throw raiseApiError("INVALID_INPUT", "Request body failed validation.");
      }

      const payload: ExportPayload = await buildExportPayload(
        context.db as unknown as Database,
        requestCheck.data.domains as readonly ExportDomain[],
        { organizationId: context.authz.activeOrganizationId },
      );

      const files: CsvExportFile[] = input.format === "csv" ? renderCsvExport(payload) : [];

      // Audit the export success path so sharing can be traced. The metadata
      // shape mirrors the source route (`records.export.csv.success`) but
      // stays sanitized — no payload values, no row contents.
      await writeAuditLog({
        db: context.db as unknown as Database,
        organizationId: context.authz.activeOrganizationId,
        actorUserId: context.authz.user.id,
        eventType: "EXPORT_GENERATED",
        targetType: "records",
        targetId: payload.generatedAt,
        correlationId: context.correlationId,
        metadata: {
          schemaVersion: EXPORT_SCHEMA_VERSION,
          format: "csv",
          selectedDomains: payload.selectedDomains,
          fileCount: files.length,
        },
      });

      return {
        generatedAt: payload.generatedAt,
        schemaVersion: payload.schemaVersion,
        selectedDomains: payload.selectedDomains,
        files,
        contentType: "text/csv",
        contentDisposition: `attachment; filename="health-export-${payload.generatedAt.slice(0, 10)}.zip"`,
      };
    }),
};
