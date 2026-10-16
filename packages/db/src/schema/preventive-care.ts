import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { member, orgId, user } from "./auth";

// ─── Preventive care (Issue #97) ───────────────────────────────
//
// The guideline items themselves are versioned data in the repo
// (`packages/api/src/preventive-care-pack.ts`), never stored here. These
// tables hold only what the person chose: self-declared criteria, their own
// dates and decisions per item, and whether the evidence-check library is on.
//
// Rows are keyed by (organization, user) and reference the `member` row with
// ON DELETE CASCADE. Only the workspace owner (the person the record belongs
// to) can read or write them. Item ids include the region (`us.…`, `uk.…`),
// so changing region keeps the history of the previous region's items.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
};

/** Per-person settings. The evidence-check library is off until turned on. */
export const preventiveCareSetting = pgTable(
  "preventive_care_setting",
  {
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    libraryEnabled: boolean("library_enabled").notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    preventiveCareSettingPk: primaryKey({
      columns: [table.organizationId, table.userId],
      name: "preventive_care_setting_pkey",
    }),
    preventiveCareSettingUserIdx: index("preventive_care_setting_user_id_idx").on(table.userId),
    preventiveCareSettingMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "preventive_care_setting_org_user_member_fk",
    }).onDelete("cascade"),
  }),
);

/**
 * Self-declared criteria (e.g. "ever smoked"). Optional, never inferred and
 * never pre-selected; clearing an answer deletes the row.
 */
export const preventiveCareDeclaration = pgTable(
  "preventive_care_declaration",
  {
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    criterionId: text("criterion_id").notNull(),
    /** `yes` | `no` | `prefer_not_to_say`. */
    answer: text("answer").notNull(),
    ...timestamps,
  },
  (table) => ({
    preventiveCareDeclarationPk: primaryKey({
      columns: [table.organizationId, table.userId, table.criterionId],
      name: "preventive_care_declaration_pkey",
    }),
    preventiveCareDeclarationUserIdx: index("preventive_care_declaration_user_id_idx").on(
      table.userId,
    ),
    preventiveCareDeclarationMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "preventive_care_declaration_org_user_member_fk",
    }).onDelete("cascade"),
    preventiveCareDeclarationAnswerCheck: check(
      "preventive_care_declaration_answer_check",
      sql`${table.answer} in ('yes', 'no', 'prefer_not_to_say')`,
    ),
  }),
);

/**
 * The person's own record for one guideline item: when they last had it,
 * the next date they set, whether to be reminded, and their plan
 * (expect the programme's invitation, or decided yes / no / later).
 */
export const preventiveCareItemState = pgTable(
  "preventive_care_item_state",
  {
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    /** Item version when last changed. */
    itemVersion: integer("item_version").notNull(),
    /** `none` | `expect_invitation` | `decided_yes` | `decided_no` | `decided_later`. */
    plan: text("plan").notNull().default("none"),
    lastDoneOn: date("last_done_on", { mode: "string" }),
    nextOn: date("next_on", { mode: "string" }),
    remind: boolean("remind").notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    preventiveCareItemStatePk: primaryKey({
      columns: [table.organizationId, table.userId, table.itemId],
      name: "preventive_care_item_state_pkey",
    }),
    preventiveCareItemStateUserIdx: index("preventive_care_item_state_user_id_idx").on(
      table.userId,
    ),
    preventiveCareItemStateRemindIdx: index("preventive_care_item_state_remind_idx")
      .on(table.nextOn)
      .where(sql`${table.remind}`),
    preventiveCareItemStateMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "preventive_care_item_state_org_user_member_fk",
    }).onDelete("cascade"),
    preventiveCareItemStatePlanCheck: check(
      "preventive_care_item_state_plan_check",
      sql`${table.plan} in ('none', 'expect_invitation', 'decided_yes', 'decided_no', 'decided_later')`,
    ),
    preventiveCareItemStateRemindCheck: check(
      "preventive_care_item_state_remind_check",
      sql`${table.remind} = false or (${table.nextOn} is not null and ${table.plan} <> 'decided_no')`,
    ),
  }),
);
