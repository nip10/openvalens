// Source: anchovy/apps/web/src/lib/export/request.ts
// Sanitized request validation for the legacy export route. All error codes and
// messages are static — caller-provided values are never echoed back to avoid
// PHI or user-controlled value leakage in error envelopes.
import { z } from "zod";
import { EXPORT_DOMAIN_ORDER, isExportDomain, type ExportDomain } from "./domains";

export type ExportFormat = "csv" | "pdf";

type ExportRequestData = {
  format: ExportFormat;
  domains: ExportDomain[];
};

export type ExportRequestErrorCode =
  | "invalid_json"
  | "invalid_format"
  | "invalid_domains"
  | "empty_domains"
  | "invalid_domain"
  | "invalid_payload";

export type ExportRequestError = {
  ok: false;
  error: {
    code: ExportRequestErrorCode;
    message: string;
  };
};

export type ExportRequestSuccess = {
  ok: true;
  data: ExportRequestData;
};

export type ParseExportRequestResult = ExportRequestSuccess | ExportRequestError;

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "csv" || value === "pdf";
}

const exportRequestSchema = z
  .strictObject({
    format: z.union([z.literal("csv"), z.literal("pdf")]),
    domains: z.array(z.string()).min(1),
  })
  .superRefine((value, ctx) => {
    for (const domain of value.domains) {
      if (!isExportDomain(domain)) {
        ctx.addIssue({ code: "custom", path: ["domains"], message: "unsupported domain" });
        return;
      }
    }
  });

export function parseExportRequest(body: unknown): ParseExportRequestResult {
  const parsed = exportRequestSchema.safeParse(body);
  if (parsed.success) {
    const selected = new Set<ExportDomain>(parsed.data.domains as ExportDomain[]);
    const normalizedDomains = EXPORT_DOMAIN_ORDER.filter((domain) => selected.has(domain));

    if (normalizedDomains.length === 0) {
      return {
        ok: false,
        error: {
          code: "empty_domains",
          message: "domains must include at least one export domain.",
        },
      };
    }

    return {
      ok: true,
      data: {
        format: parsed.data.format,
        domains: normalizedDomains,
      },
    };
  }

  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: "Invalid JSON body.",
      },
    };
  }

  const rawKeys = Object.keys(body as Record<string, unknown>);
  if (rawKeys.some((key) => key !== "format" && key !== "domains")) {
    return {
      ok: false,
      error: {
        code: "invalid_payload",
        message: "Request body failed validation.",
      },
    };
  }

  const raw = body as Record<string, unknown>;
  if (!isExportFormat(raw.format)) {
    return {
      ok: false,
      error: {
        code: "invalid_format",
        message: "format must be one of: csv, pdf.",
      },
    };
  }

  if (!Array.isArray(raw.domains)) {
    return {
      ok: false,
      error: {
        code: "invalid_domains",
        message: "domains must be a non-empty array of export domains.",
      },
    };
  }

  if (raw.domains.length === 0) {
    return {
      ok: false,
      error: {
        code: "empty_domains",
        message: "domains must include at least one export domain.",
      },
    };
  }

  for (const domain of raw.domains) {
    if (!isExportDomain(domain)) {
      return {
        ok: false,
        error: {
          code: "invalid_domain",
          message: "domains contains an unsupported export domain.",
        },
      };
    }
  }

  return { ok: false, error: { code: "invalid_json", message: "Request body failed validation." } };
}
