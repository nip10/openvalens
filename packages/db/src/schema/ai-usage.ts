import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

// ─── AI usage per person per month (Issue #299) ───────────────
//
// One row per person per calendar month (UTC): token counts, the estimated
// model cost and the number of provider calls, plus a short-lived reservation
// that holds back budget while calls are in flight. Counts only: no prompt,
// reply, conversation id or health value is ever stored here.
//
// `packages/ai/src/usage-store.ts` writes this table through SQL, so the
// column contract here is frozen.

/**
 * AI usage of one person in one calendar month (UTC). `month` is the first day
 * of the month. `cost_micros` is the estimated model cost in millionths of the
 * operator's configured currency (`AI_COST_CURRENCY`, default EUR), computed
 * from the configured per-token prices; `0` when no prices are configured.
 *
 * `reserved_micros` is budget held for calls that are still running;
 * `reserved_until` is when that hold lapses if the server dies before the
 * calls settle, so a crash never locks a person out for the rest of the month.
 */
export const aiUsageMonth = pgTable(
  "ai_usage_month",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    month: date("month", { mode: "string" }).notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    callCount: integer("call_count").notNull().default(0),
    reservedMicros: bigint("reserved_micros", { mode: "number" }).notNull().default(0),
    reservedUntil: timestamp("reserved_until", { withTimezone: true, mode: "date" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.month] }),
    aiUsageMonthCostIdx: index("ai_usage_month_month_cost_idx").on(table.month, table.costMicros),
    aiUsageMonthFirstDayCheck: check(
      "ai_usage_month_first_day_check",
      sql`extract(day from ${table.month}) = 1`,
    ),
    aiUsageMonthNonNegativeCheck: check(
      "ai_usage_month_non_negative_check",
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.cachedInputTokens} >= 0 and ${table.costMicros} >= 0 and ${table.callCount} >= 0 and ${table.reservedMicros} >= 0`,
    ),
  }),
);
