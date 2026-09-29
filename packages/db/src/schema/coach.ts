import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { orgId } from "./auth";

// ─── AI Feedback ──────────────────────────────────────────────

export const aiFeedback = pgTable(
  "ai_feedback",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    source: text("source").notNull(), // "insight" | "chat"
    referenceId: integer("reference_id"), // insight.id for insight feedback, null for chat
    rating: text("rating").notNull(), // "up" | "down"
    comment: text("comment"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    aiFeedbackOrgIdx: index("ai_feedback_organization_id_idx").on(table.organizationId),
  }),
);

// ─── AI Coach ──────────────────────────────────────────────────

export const coachProfile = pgTable(
  "coach_profile",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    tone: text("tone").notNull(), // "strict" | "balanced" | "supportive"
    assertiveness: integer("assertiveness").notNull(), // 1..5
    riskTolerance: text("risk_tolerance").notNull(), // "conservative" | "moderate" | "aggressive"
    medicalDisclaimerMode: text("medical_disclaimer_mode").notNull(), // "always" | "contextual"
    selectedTemplateKey: text("selected_template_key").notNull(),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    coachProfileOrgIdx: index("coach_profile_organization_id_idx").on(table.organizationId),
  }),
);

export const coachTemplate = pgTable("coach_template", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  instructionPreset: jsonb("instruction_preset").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const insight = pgTable(
  "insight",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    type: text("type").notNull(), // "trend", "flag", "recommendation"
    severity: text("severity"), // "info", "warning", "critical"
    title: text("title").notNull(),
    body: text("body"), // Markdown
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    insightOrgIdx: index("insight_organization_id_idx").on(table.organizationId),
    insightOrgCreatedAtIdx: index("insight_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export const chatMessage = pgTable(
  "chat_message",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(), // "user", "assistant", "system"
    content: text("content").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    chatMessageOrgIdx: index("chat_message_organization_id_idx").on(table.organizationId),
    chatMessageOrgIdUnique: uniqueIndex("chat_message_org_id_key").on(
      table.organizationId,
      table.id,
    ),
  }),
);
