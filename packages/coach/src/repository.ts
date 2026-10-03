import type { Database } from "@openvalens/db";
import { aiFeedback, coachProfile, coachTemplate, insight } from "@openvalens/db/schema/coach";
import { and, desc, eq } from "drizzle-orm";

import { GLOBAL_COACH_PROFILE_DEFAULTS } from "./templates";
import {
  isCoachDisclaimerMode,
  isCoachRiskTolerance,
  isCoachTemplateId,
  isCoachTone,
  type AiFeedback,
  type CoachProfile,
  type CoachTemplate,
  type Insight,
  type InstructionPreset,
} from "./types";

/**
 * Org-scoped CRUD repository for the coach domain (Issue #19).
 *
 * Tables:
 *
 * - `coachProfile`  — org-scoped; one row per org.
 * - `coachTemplate` — global catalog (no `organizationId`). Templates can
 *   be customised per-org through `selectedTemplateKey` on `coachProfile`
 *   — there's no per-org template override table in this schema.
 * - `aiFeedback`    — org-scoped feedback rows written after AI chat or
 *   insight interactions.
 * - `insight`       — org-scoped insight rows. Generation is owned by #13;
 *   this repo only exposes reads.
 *
 * No PHI is logged. `notes` / `comment` / `body` round-trip but never
 * appear in any log line.
 */

export type UpsertProfileInput = {
  tone: CoachProfile["tone"];
  assertiveness: number;
  riskTolerance: CoachProfile["riskTolerance"];
  medicalDisclaimerMode: CoachProfile["medicalDisclaimerMode"];
  selectedTemplateKey: CoachProfile["selectedTemplateKey"];
};

export type UpsertTemplateInput = {
  key: CoachTemplate["key"];
  title: string;
  description: string;
  instructionPreset: InstructionPreset;
  isActive: boolean;
};

export type RecordFeedbackInput = {
  source: AiFeedback["source"];
  referenceId: number | null;
  rating: AiFeedback["rating"];
  comment: string | null;
};

export type CoachRepository = ReturnType<typeof createCoachRepository>;

export function createCoachRepository(db: Database) {
  return {
    // ─── profile ────────────────────────────────────────────

    async getProfile(organizationId: string): Promise<CoachProfile | null> {
      const rows = (await db
        .select()
        .from(coachProfile)
        .where(eq(coachProfile.organizationId, organizationId))
        .limit(1)) as CoachProfile[];
      const row = rows[0];
      if (!row) return null;
      return normalizeProfile(row);
    },

    async ensureProfile(organizationId: string): Promise<CoachProfile> {
      const existing = await this.getProfile(organizationId);
      if (existing) return existing;
      const inserted = (await db
        .insert(coachProfile)
        .values({
          organizationId,
          tone: GLOBAL_COACH_PROFILE_DEFAULTS.tone,
          assertiveness: GLOBAL_COACH_PROFILE_DEFAULTS.assertiveness,
          riskTolerance: GLOBAL_COACH_PROFILE_DEFAULTS.riskTolerance,
          medicalDisclaimerMode: GLOBAL_COACH_PROFILE_DEFAULTS.medicalDisclaimerMode,
          selectedTemplateKey: GLOBAL_COACH_PROFILE_DEFAULTS.selectedTemplateKey,
        })
        .returning()) as CoachProfile[];
      const row = inserted[0];
      if (!row) throw new Error("Coach profile insert did not return a row");
      return normalizeProfile(row);
    },

    async upsertProfile(organizationId: string, input: UpsertProfileInput): Promise<CoachProfile> {
      const existing = await this.getProfile(organizationId);
      if (existing) {
        await db
          .update(coachProfile)
          .set({
            tone: input.tone,
            assertiveness: input.assertiveness,
            riskTolerance: input.riskTolerance,
            medicalDisclaimerMode: input.medicalDisclaimerMode,
            selectedTemplateKey: input.selectedTemplateKey,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(coachProfile.id, existing.id));
        const refreshed = await this.getProfile(organizationId);
        if (!refreshed) throw new Error("Coach profile disappeared after update");
        return refreshed;
      }

      const inserted = (await db
        .insert(coachProfile)
        .values({
          organizationId,
          tone: input.tone,
          assertiveness: input.assertiveness,
          riskTolerance: input.riskTolerance,
          medicalDisclaimerMode: input.medicalDisclaimerMode,
          selectedTemplateKey: input.selectedTemplateKey,
        })
        .returning()) as CoachProfile[];
      const row = inserted[0];
      if (!row) throw new Error("Coach profile insert did not return a row");
      return normalizeProfile(row);
    },

    // ─── templates ──────────────────────────────────────────

    async listTemplates(): Promise<CoachTemplate[]> {
      const rows = (await db.select().from(coachTemplate).orderBy(coachTemplate.key)) as Array<{
        id: number;
        key: string;
        title: string;
        description: string | null;
        instructionPreset: unknown;
        isActive: boolean;
        createdAt: string;
      }>;
      return rows.map(normalizeTemplate).sort((a, b) => a.key.localeCompare(b.key));
    },

    async upsertTemplate(input: UpsertTemplateInput): Promise<CoachTemplate> {
      type TemplateRow = {
        id: number;
        key: string;
        title: string;
        description: string | null;
        instructionPreset: unknown;
        isActive: boolean;
        createdAt: string;
      };
      const existing = (await db
        .select({ id: coachTemplate.id })
        .from(coachTemplate)
        .where(eq(coachTemplate.key, input.key))
        .limit(1)) as Array<{ id: number }>;
      if (existing.length > 0) {
        await db
          .update(coachTemplate)
          .set({
            title: input.title,
            description: input.description,
            instructionPreset: input.instructionPreset,
            isActive: input.isActive,
          })
          .where(eq(coachTemplate.id, existing[0]!.id));
        const refreshed = (await db
          .select()
          .from(coachTemplate)
          .where(eq(coachTemplate.id, existing[0]!.id))
          .limit(1)) as TemplateRow[];
        return normalizeTemplate(refreshed[0]!);
      }

      const inserted = (await db
        .insert(coachTemplate)
        .values({
          key: input.key,
          title: input.title,
          description: input.description,
          instructionPreset: input.instructionPreset,
          isActive: input.isActive,
        })
        .returning()) as TemplateRow[];
      return normalizeTemplate(inserted[0]!);
    },

    // ─── feedback ───────────────────────────────────────────

    async recordFeedback(organizationId: string, input: RecordFeedbackInput): Promise<AiFeedback> {
      const inserted = (await db
        .insert(aiFeedback)
        .values({
          organizationId,
          source: input.source,
          referenceId: input.referenceId,
          rating: input.rating,
          comment: input.comment,
        })
        .returning()) as AiFeedback[];
      const row = inserted[0];
      if (!row) throw new Error("AI feedback insert did not return a row");
      return row;
    },

    // ─── insights (read-only; generation owned by #13) ──────

    async listInsights(
      organizationId: string,
      params: { limit?: number } = {},
    ): Promise<Insight[]> {
      const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
      const rows = (await db
        .select()
        .from(insight)
        .where(eq(insight.organizationId, organizationId))
        .orderBy(desc(insight.createdAt), desc(insight.id))
        .limit(limit)) as Array<{
        id: number;
        organizationId: string;
        type: string;
        severity: string | null;
        title: string;
        body: string | null;
        createdAt: string;
      }>;
      return rows.map(normalizeInsight);
    },

    async getInsight(organizationId: string, id: number): Promise<Insight | null> {
      const rows = (await db
        .select()
        .from(insight)
        .where(and(eq(insight.organizationId, organizationId), eq(insight.id, id)))
        .limit(1)) as Array<{
        id: number;
        organizationId: string;
        type: string;
        severity: string | null;
        title: string;
        body: string | null;
        createdAt: string;
      }>;
      const row = rows[0];
      if (!row) return null;
      return normalizeInsight(row);
    },
  };
}

function normalizeProfile(row: CoachProfile): CoachProfile {
  return {
    id: row.id,
    organizationId: row.organizationId,
    tone: isCoachTone(row.tone) ? row.tone : GLOBAL_COACH_PROFILE_DEFAULTS.tone,
    assertiveness:
      Number.isFinite(row.assertiveness) && row.assertiveness >= 1 && row.assertiveness <= 5
        ? row.assertiveness
        : GLOBAL_COACH_PROFILE_DEFAULTS.assertiveness,
    riskTolerance: isCoachRiskTolerance(row.riskTolerance)
      ? row.riskTolerance
      : GLOBAL_COACH_PROFILE_DEFAULTS.riskTolerance,
    medicalDisclaimerMode: isCoachDisclaimerMode(row.medicalDisclaimerMode)
      ? row.medicalDisclaimerMode
      : GLOBAL_COACH_PROFILE_DEFAULTS.medicalDisclaimerMode,
    selectedTemplateKey: isCoachTemplateId(row.selectedTemplateKey)
      ? row.selectedTemplateKey
      : GLOBAL_COACH_PROFILE_DEFAULTS.selectedTemplateKey,
    updatedAt: row.updatedAt,
  };
}

function normalizeTemplate(row: {
  key: string;
  title: string;
  description: string | null;
  instructionPreset: unknown;
  isActive: boolean;
}): CoachTemplate {
  const key = isCoachTemplateId(row.key) ? row.key : "maintenance";
  return {
    key,
    title: row.title,
    description: row.description ?? "",
    instructionPreset: normalizePreset(row.instructionPreset),
    isActive: row.isActive,
  };
}

function normalizePreset(value: unknown): InstructionPreset {
  if (!isRecord(value)) {
    return { objective: "", directives: [], outputStyle: "" };
  }
  const objective = typeof value.objective === "string" ? value.objective : "";
  const outputStyle = typeof value.outputStyle === "string" ? value.outputStyle : "";
  const directives = Array.isArray(value.directives)
    ? value.directives.filter((item): item is string => typeof item === "string")
    : [];
  return { objective, directives, outputStyle };
}

function normalizeInsight(row: {
  id: number;
  organizationId: string;
  type: string;
  severity: string | null;
  title: string;
  body: string | null;
  createdAt: string;
}): Insight {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type:
      row.type === "trend" || row.type === "flag" || row.type === "recommendation"
        ? row.type
        : "trend",
    severity:
      row.severity === "info" || row.severity === "warning" || row.severity === "critical"
        ? row.severity
        : null,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
