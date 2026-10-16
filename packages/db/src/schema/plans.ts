import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  text,
  integer,
  real,
  serial,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/pg-core";

import { orgId, user, member } from "./auth";

// ─── Supplements & Medications ────────────────────────────────

export const supplement = pgTable("supplement", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  dose: text("dose"), // "800mcg", "4000 IU"
  form: text("form"), // "capsule", "powder", "liquid"
  category: text("category"), // "vitamin", "mineral", "peptide", "amino acid"
});

export const supplementSchedule = pgTable(
  "supplement_schedule",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    supplementId: integer("supplement_id")
      .notNull()
      .references(() => supplement.id),
    timeOfDay: text("time_of_day").notNull(), // "morning", "lunch", "dinner", "pre-bed", "training"
    quantity: text("quantity"), // "1 capsule", "2 capsules", "4g"
    frequency: text("frequency"), // "daily", "training days", "weekly"
    notes: text("notes"),
    status: text("status").notNull().default("active"), // "active", "paused", "stopped"
  },
  (table) => ({
    supplementScheduleUserStatusIdx: index("supplement_schedule_user_id_status_idx").on(
      table.userId,
      table.status,
    ),
    supplementScheduleOrgIdx: index("supplement_schedule_organization_id_idx").on(
      table.organizationId,
    ),
    supplementScheduleMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "supplement_schedule_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

export const supplementChange = pgTable(
  "supplement_change",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    supplementId: integer("supplement_id").references(() => supplement.id),
    changeType: text("change_type").notNull(), // "added", "removed", "paused", "resumed", "dose_changed"
    reason: text("reason"),
    details: text("details"),
  },
  (table) => ({
    supplementChangeOrgIdx: index("supplement_change_organization_id_idx").on(table.organizationId),
  }),
);

export const medication = pgTable(
  "medication",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dose: text("dose"),
    route: text("route"), // "oral", "topical", "SC"
    protocol: text("protocol"), // Description of the schedule
    frequency: text("frequency"),
    status: text("status").notNull().default("active"), // "active", "completed", "paused"
    interactions: text("interactions"),
    notes: text("notes"),
  },
  (table) => ({
    medicationUserStatusIdx: index("medication_user_id_status_idx").on(table.userId, table.status),
    medicationOrgIdx: index("medication_organization_id_idx").on(table.organizationId),
    medicationMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "medication_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);

// ─── Goals ────────────────────────────────────────────────────

export const goal = pgTable(
  "goal",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    title: text("title").notNull(),
    category: text("category").notNull(), // "body_composition", "strength", "endurance", "health"
    horizon: text("horizon"), // "short", "medium", "long"
    status: text("status").notNull().default("not_started"), // "not_started", "in_progress", "achieved", "paused", "cancelled"
    currentValue: text("current_value"),
    targetValue: text("target_value"),
    targetDate: text("target_date"),
    notes: text("notes"),
    // Issue #95 — goal measurement contract (additive, all nullable so
    // existing goals keep working). `direction` says which way counts as
    // progress, `baselineValue` is the starting point progress is measured
    // from, and `priority` is the person's own weighting for goal progress.
    direction: text("direction"), // "increase", "decrease"
    baselineValue: text("baseline_value"),
    priority: text("priority"), // "low", "normal", "high"
  },
  (table) => ({
    goalOrgIdx: index("goal_organization_id_idx").on(table.organizationId),
    goalOrgIdUnique: uniqueIndex("goal_org_id_key").on(table.organizationId, table.id),
    goalDirectionCheck: check(
      "goal_direction_check",
      sql`${table.direction} is null or ${table.direction} in ('increase', 'decrease')`,
    ),
    goalPriorityCheck: check(
      "goal_priority_check",
      sql`${table.priority} is null or ${table.priority} in ('low', 'normal', 'high')`,
    ),
  }),
);

export const goalCheckin = pgTable(
  "goal_checkin",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    goalId: integer("goal_id")
      .notNull()
      .references(() => goal.id),
    date: text("date").notNull(), // ISO 8601
    value: text("value"), // e.g. "24.1%", "82 kg"
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    goalCheckinOrgIdx: index("goal_checkin_organization_id_idx").on(table.organizationId),
    goalCheckinGoalFk: foreignKey({
      columns: [table.organizationId, table.goalId],
      foreignColumns: [goal.organizationId, goal.id],
      name: "goal_checkin_org_goal_fk",
    }).onDelete("cascade"),
  }),
);

export const workout = pgTable(
  "workout",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    type: text("type").notNull(), // "weights", "tennis", "running", "cycling"
    duration: integer("duration"), // minutes
    exercises: text("exercises"), // JSON
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    // Issue #99 — activity load. Self-reported intensity (talk test) and
    // session effort (CR-10, 0–10). Null means "not recorded", never a default.
    intensity: text("intensity"), // "light" | "moderate" | "vigorous"
    effortRating: integer("effort_rating"),
    effortRatedAt: text("effort_rated_at"), // ISO timestamp of the latest rating
  },
  (table) => ({
    workoutOrgIdx: index("workout_organization_id_idx").on(table.organizationId),
    workoutOrgIdUnique: uniqueIndex("workout_org_id_key").on(table.organizationId, table.id),
    workoutIntensityCheck: check(
      "workout_intensity_check",
      sql`${table.intensity} is null or ${table.intensity} in ('light', 'moderate', 'vigorous')`,
    ),
    workoutEffortRatingCheck: check(
      "workout_effort_rating_check",
      sql`${table.effortRating} is null or (${table.effortRating} >= 0 and ${table.effortRating} <= 10)`,
    ),
    workoutOrgDateIdx: index("workout_organization_id_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);

export const workoutExercise = pgTable(
  "workout_exercise",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    workoutId: integer("workout_id")
      .notNull()
      .references(() => workout.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    name: text("name").notNull(),
    notes: text("notes"),
  },
  (table) => ({
    workoutExerciseOrgIdx: index("workout_exercise_organization_id_idx").on(table.organizationId),
    workoutExerciseOrgIdUnique: uniqueIndex("workout_exercise_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    workoutExerciseWorkoutIdIdx: index("workout_exercise_workout_id_idx").on(table.workoutId),
    workoutExerciseWorkoutSortOrderIdx: index("workout_exercise_workout_id_sort_order_idx").on(
      table.workoutId,
      table.sortOrder,
    ),
    workoutExerciseWorkoutSortOrderUnique: uniqueIndex(
      "workout_exercise_workout_id_sort_order_key",
    ).on(table.workoutId, table.sortOrder),
    workoutExerciseWorkoutFk: foreignKey({
      columns: [table.organizationId, table.workoutId],
      foreignColumns: [workout.organizationId, workout.id],
      name: "workout_exercise_org_workout_fk",
    }).onDelete("cascade"),
  }),
);

export const workoutSet = pgTable(
  "workout_set",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => workoutExercise.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    reps: integer("reps"),
    weightKg: real("weight_kg"),
    rpe: real("rpe"),
    notes: text("notes"),
  },
  (table) => ({
    workoutSetOrgIdx: index("workout_set_organization_id_idx").on(table.organizationId),
    workoutSetExerciseIdIdx: index("workout_set_exercise_id_idx").on(table.exerciseId),
    workoutSetExerciseSortOrderIdx: index("workout_set_exercise_id_sort_order_idx").on(
      table.exerciseId,
      table.sortOrder,
    ),
    workoutSetExerciseSortOrderUnique: uniqueIndex("workout_set_exercise_id_sort_order_key").on(
      table.exerciseId,
      table.sortOrder,
    ),
    workoutSetExerciseFk: foreignKey({
      columns: [table.organizationId, table.exerciseId],
      foreignColumns: [workoutExercise.organizationId, workoutExercise.id],
      name: "workout_set_org_exercise_fk",
    }).onDelete("cascade"),
  }),
);

export const weeklyReview = pgTable(
  "weekly_review",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    weekStart: text("week_start").notNull(),
    adherence: integer("adherence"), // 1-10
    energy: integer("energy"), // 1-10
    sleep: integer("sleep"), // 1-10
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    weeklyReviewOrgIdx: index("weekly_review_organization_id_idx").on(table.organizationId),
  }),
);

// ─── System ───────────────────────────────────────────────────

export const calendarEvent = pgTable(
  "calendar_event",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    date: text("date").notNull(),
    type: text("type").notNull(), // "blood_panel", "dexa", "consultation", "workout", "weight", "medication"
    category: text("category"), // color-coding group
    title: text("title").notNull(),
    referenceTable: text("reference_table"),
    referenceId: integer("reference_id"),
  },
  (table) => ({
    calendarEventOrgIdx: index("calendar_event_organization_id_idx").on(table.organizationId),
    calendarEventOrgDateIdx: index("calendar_event_organization_id_date_idx").on(
      table.organizationId,
      table.date,
    ),
  }),
);

export const scheduledEvent = pgTable(
  "scheduled_event",
  {
    id: serial("id").primaryKey(),
    organizationId: orgId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: text("type").notNull(), // "lab", "appointment", "medication", "supplement", "custom"
    startDate: text("start_date").notNull(),
    endDate: text("end_date"), // null = ongoing
    frequency: text("frequency").notNull(), // "once", "daily", "weekly", "biweekly", "monthly"
    interval: integer("interval").default(1), // every N periods
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    scheduledEventUserStartEndIdx: index("scheduled_event_user_id_start_date_end_date_idx").on(
      table.userId,
      table.startDate,
      table.endDate,
    ),
    scheduledEventOrgIdx: index("scheduled_event_organization_id_idx").on(table.organizationId),
    scheduledEventOrgIdUnique: uniqueIndex("scheduled_event_org_id_key").on(
      table.organizationId,
      table.id,
    ),
    scheduledEventMemberFk: foreignKey({
      columns: [table.organizationId, table.userId],
      foreignColumns: [member.organizationId, member.userId],
      name: "scheduled_event_org_user_member_fk",
    }).onDelete("restrict"),
  }),
);
