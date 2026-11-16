import { type Database } from "@openvalens/db";
import { writeAuditLog } from "@openvalens/audit-security";
import {
  applyExportPeriod,
  buildExportPayload,
  createClinicalExportRepository,
  EXPORT_SCHEMA_VERSION,
  isExportDomain,
  normalizeClinicalExportLimit,
  parseExportRequest,
  renderCsvExport,
  renderPdfExport,
  type CsvExportFile,
  type ExportDomain,
  type ExportPayload,
  type ParseExportRequestResult,
} from "@openvalens/clinical-export";
import { z } from "zod";
import { permissionedProcedure, raiseApiError, validateInput } from "../index";

const bundleInput = z
  .strictObject({
    limit: z.union([z.number(), z.string()]).optional().transform(normalizeClinicalExportLimit),
  })
  .default({ limit: 200 });

const exportDate = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

/** exports#4 — an inclusive period for the dated sections; omitted for all time. */
const periodInput = z
  .strictObject({ from: exportDate.nullable().optional(), to: exportDate.nullable().optional() })
  .refine((period) => !period.from || !period.to || period.from <= period.to, {
    message: "Request body failed validation.",
  })
  .optional();

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
  period: periodInput,
});

const legacyPdfDownloadInput = z.strictObject({
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
  format: z.literal("pdf").optional().default("pdf"),
  period: periodInput,
});

function periodOf(period: { from?: string | null; to?: string | null } | undefined) {
  return period ? { from: period.from ?? null, to: period.to ?? null } : null;
}

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
        { limit: input.limit, userId: context.authz.user.id },
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

      const payload: ExportPayload = applyExportPeriod(
        await buildExportPayload(
          context.db as unknown as Database,
          requestCheck.data.domains as readonly ExportDomain[],
          { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id },
        ),
        periodOf(input.period),
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
          periodApplied: payload.period !== undefined,
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
  legacyPdfDownload: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(legacyPdfDownloadInput))
    .input(legacyPdfDownloadInput)
    .handler(async ({ context, input }) => {
      // Reject tenant-override headers — identity is exclusively authz-derived.
      if (context.honoContext.req.raw.headers.has("x-organization-id"))
        throw raiseApiError("INVALID_INPUT", "Organization overrides are not supported.");

      // The strict schema rejects empty domain arrays; when the caller omits
      // `domains` we fall back to the anchor's canonical defaults.
      const domains: ExportDomain[] =
        input.domains ?? (["blood", "body", "medications", "supplements"] as ExportDomain[]);

      // Defense in depth: the source validates via `parseExportRequest` even
      // though Zod has already filtered unknowns — keep the validation surface
      // and error codes identical to the source. The format literal is "pdf".
      const requestCheck: ParseExportRequestResult = parseExportRequest({
        format: "pdf",
        domains,
      });
      if (!requestCheck.ok) {
        throw raiseApiError("INVALID_INPUT", "Request body failed validation.");
      }

      const payload: ExportPayload = applyExportPeriod(
        await buildExportPayload(
          context.db as unknown as Database,
          requestCheck.data.domains as readonly ExportDomain[],
          { organizationId: context.authz.activeOrganizationId, userId: context.authz.user.id },
        ),
        periodOf(input.period),
      );

      const rendered = renderPdfExport(payload);

      // Single audit row, sanitized metadata — no payload values, no row
      // contents. The route is the "HTML attachment" view of the legacy
      // export; one file per render.
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
          format: "pdf",
          selectedDomains: payload.selectedDomains,
          fileCount: 1,
          periodApplied: payload.period !== undefined,
        },
      });

      return {
        generatedAt: payload.generatedAt,
        schemaVersion: payload.schemaVersion,
        selectedDomains: payload.selectedDomains,
        fileName: rendered.fileName,
        content: rendered.html,
        contentType: rendered.contentTypeHint,
        contentDisposition: `attachment; filename="${rendered.fileName}"`,
      };
    }),
};
