import { type Database } from "@openvalens/db";
import { writeAuditLog } from "@openvalens/audit-security";
import {
  buildExportPayload,
  CLINICAL_PDF_VERSION,
  createClinicalExportRepository,
  DEFAULT_CLINICAL_PDF_DOMAINS,
  isClinicalPdfDomain,
  normalizeClinicalPdfDomains,
  renderClinicalPdf,
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

const CLINICAL_PDF_DOMAIN_LIMIT = 32;

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
});

// Issue #132 — the clinical PDF accepts only PDF-eligible domains. Unknown or
// non-PDF domains are rejected (not silently dropped) with a static message.
const clinicalPdfInput = z
  .strictObject({
    domains: z
      .array(z.string())
      .min(1)
      .max(CLINICAL_PDF_DOMAIN_LIMIT)
      .refine((domains) => domains.every(isClinicalPdfDomain), {
        message: "Request body failed validation.",
      })
      .optional(),
  })
  .default({});

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
  // Printable HTML view of the legacy export (still used by the mobile app).
  // The real PDF is `clinicalPdf` below.
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

      const payload: ExportPayload = await buildExportPayload(
        context.db as unknown as Database,
        requestCheck.data.domains as readonly ExportDomain[],
        { organizationId: context.authz.activeOrganizationId },
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
  /**
   * Issue #132 — real clinical PDF (`application/pdf`), organization-authorized
   * by `records:read` and scoped to the session's active organization.
   *
   * Stateless and transient by design: the PDF is rendered in memory and
   * returned once in this authenticated response (base64). It is never
   * written to disk or object storage, never logged, and no download URL is
   * minted, so there is no stored file to protect, expire or delete. The
   * audit row records only the format, domains and file count.
   */
  clinicalPdf: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(clinicalPdfInput))
    .input(clinicalPdfInput)
    .handler(async ({ context, input }) => {
      if (context.honoContext.req.raw.headers.has("x-organization-id"))
        throw raiseApiError("INVALID_INPUT", "Organization overrides are not supported.");

      const domains = normalizeClinicalPdfDomains(input.domains ?? DEFAULT_CLINICAL_PDF_DOMAINS);
      if (domains.length === 0) {
        throw raiseApiError("INVALID_INPUT", "Request body failed validation.");
      }

      const organizationId = context.authz.activeOrganizationId;
      const payload = await buildExportPayload(context.db as unknown as Database, domains, {
        organizationId,
      });
      const rendered = await renderClinicalPdf(payload);

      await writeAuditLog({
        db: context.db as unknown as Database,
        organizationId,
        actorUserId: context.authz.user.id,
        eventType: "EXPORT_GENERATED",
        targetType: "records",
        targetId: payload.generatedAt,
        correlationId: context.correlationId,
        metadata: {
          schemaVersion: CLINICAL_PDF_VERSION,
          format: "pdf",
          selectedDomains: payload.selectedDomains,
          fileCount: 1,
        },
      });

      return {
        generatedAt: payload.generatedAt,
        schemaVersion: CLINICAL_PDF_VERSION,
        selectedDomains: payload.selectedDomains,
        fileName: rendered.fileName,
        contentType: rendered.contentType,
        byteLength: rendered.bytes.byteLength,
        pageCount: rendered.pageCount,
        contentBase64: Buffer.from(rendered.bytes).toString("base64"),
      };
    }),
};
