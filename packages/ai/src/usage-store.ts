/**
 * Postgres AI usage meter (Issue #299): one `ai_usage_month` row per person
 * per calendar month (UTC).
 *
 * Cap check and overshoot guard: `begin` locks the person's row for the
 * month, refuses when recorded cost plus live reservations already reach the
 * limit, and otherwise reserves an estimate of this call (prompt size plus an
 * output allowance). Concurrent calls therefore see each other's reservations,
 * so parallel streams cannot all start on the last cents of budget. A call
 * that is let through may still cost more than its estimate: the overshoot is
 * bounded by the calls already in flight when the budget ran out (normally one
 * chat turn). `finish` replaces the reservation with the real usage.
 *
 * Reservations lapse after {@link AI_USAGE_RESERVATION_TTL_MS}, so a server
 * that dies mid-call never locks anyone out for the month. All state is in
 * Postgres, so the cap holds across restarts and replicas.
 *
 * Only counts are written and logged: never a prompt, reply or health value.
 */
import { aiUsageMonth } from "@openvalens/db/schema/ai-usage";
import type { Database } from "@openvalens/db";
import { createStructuredLogger, type StructuredLogger } from "@openvalens/observability";
import { and, desc, eq, sql } from "drizzle-orm";

import {
  AI_USAGE_RESERVATION_TTL_MS,
  AiUsageLimitError,
  costMicros,
  estimateCallMicros,
  usageMonthOf,
  usageResetDateOf,
  type AiUsageAccount,
  type AiUsageBeginInput,
  type AiUsageConfig,
  type AiUsageLease,
  type AiUsageMeter,
  type AiUsageSummary,
  type AiUsageTokens,
} from "./usage";

export type PgAiUsageMeterOptions = {
  db: Database;
  config: AiUsageConfig;
  /** Clock injection for tests. Defaults to the wall clock. */
  now?: () => Date;
  logger?: StructuredLogger;
};

const DEFAULT_TOP = 10;
const MAX_TOP = 50;

export function createPgAiUsageMeter(options: PgAiUsageMeterOptions): AiUsageMeter {
  const { db, config } = options;
  const now = options.now ?? (() => new Date());
  const logger =
    options.logger ?? createStructuredLogger({ level: "info" }).child({ component: "ai-usage" });

  /** Locks the month row, checks the cap, and holds `estimate` micros. */
  async function reserve(userId: string, month: string, estimate: number, at: Date) {
    const limit = config.monthlyLimitMicros;
    if (limit === null) return;
    await db.transaction(async (tx) => {
      await tx.insert(aiUsageMonth).values({ userId, month }).onConflictDoNothing();
      const [row] = await tx
        .select({
          costMicros: aiUsageMonth.costMicros,
          reservedMicros: aiUsageMonth.reservedMicros,
          reservedUntil: aiUsageMonth.reservedUntil,
        })
        .from(aiUsageMonth)
        .where(and(eq(aiUsageMonth.userId, userId), eq(aiUsageMonth.month, month)))
        .for("update");
      const live = row?.reservedUntil && row.reservedUntil > at ? row.reservedMicros : 0;
      const spent = row?.costMicros ?? 0;
      if (spent + live >= limit) throw new AiUsageLimitError(usageResetDateOf(at));
      await tx
        .update(aiUsageMonth)
        .set({
          reservedMicros: live + estimate,
          reservedUntil: new Date(at.getTime() + AI_USAGE_RESERVATION_TTL_MS),
          updatedAt: at,
        })
        .where(and(eq(aiUsageMonth.userId, userId), eq(aiUsageMonth.month, month)));
    });
  }

  async function settle(input: {
    userId: string;
    reservedMonth: string;
    reserved: number;
    tokens: AiUsageTokens;
    calls: number;
  }): Promise<void> {
    const at = now();
    const month = usageMonthOf(at);
    const cost = costMicros(input.tokens, config.prices);
    await db.transaction(async (tx) => {
      if (input.reserved > 0) {
        await tx
          .update(aiUsageMonth)
          .set({
            reservedMicros: sql`greatest(${aiUsageMonth.reservedMicros} - ${input.reserved}, 0)`,
            updatedAt: at,
          })
          .where(
            and(eq(aiUsageMonth.userId, input.userId), eq(aiUsageMonth.month, input.reservedMonth)),
          );
      }
      if (input.calls === 0) return;
      await tx
        .insert(aiUsageMonth)
        .values({
          userId: input.userId,
          month,
          inputTokens: input.tokens.inputTokens,
          outputTokens: input.tokens.outputTokens,
          cachedInputTokens: input.tokens.cachedInputTokens,
          costMicros: cost,
          callCount: input.calls,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [aiUsageMonth.userId, aiUsageMonth.month],
          set: {
            inputTokens: sql`${aiUsageMonth.inputTokens} + ${input.tokens.inputTokens}`,
            outputTokens: sql`${aiUsageMonth.outputTokens} + ${input.tokens.outputTokens}`,
            cachedInputTokens: sql`${aiUsageMonth.cachedInputTokens} + ${input.tokens.cachedInputTokens}`,
            costMicros: sql`${aiUsageMonth.costMicros} + ${cost}`,
            callCount: sql`${aiUsageMonth.callCount} + ${input.calls}`,
            updatedAt: at,
          },
        });
    });
  }

  return {
    config,

    async begin(input: AiUsageBeginInput): Promise<AiUsageLease> {
      const at = now();
      const reservedMonth = usageMonthOf(at);
      const reserved =
        config.monthlyLimitMicros === null
          ? 0
          : estimateCallMicros(input.promptChars, config.prices);
      await reserve(input.userId, reservedMonth, reserved, at);

      const tokens: AiUsageTokens = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
      let calls = 0;
      let finished = false;
      return {
        add(usage) {
          if (finished) return;
          tokens.inputTokens += usage.inputTokens;
          tokens.outputTokens += usage.outputTokens;
          tokens.cachedInputTokens += usage.cachedInputTokens;
          calls += 1;
        },
        async finish() {
          if (finished) return;
          finished = true;
          try {
            await settle({ userId: input.userId, reservedMonth, reserved, tokens, calls });
          } catch (error) {
            // Counts only; the observability logger reduces errors to name/code.
            logger.error("ai.usage.record_failed", {
              calls,
              inputTokens: tokens.inputTokens,
              outputTokens: tokens.outputTokens,
              error,
            });
          }
        },
      };
    },

    async summary(input = {}): Promise<AiUsageSummary> {
      const at = now();
      const month = usageMonthOf(at);
      const top = Math.min(Math.max(Math.trunc(input.top ?? DEFAULT_TOP), 1), MAX_TOP);
      const inMonth = eq(aiUsageMonth.month, month);

      const [totals] = await db
        .select({
          accounts: sql<number>`count(*) filter (where ${aiUsageMonth.callCount} > 0)::int`,
          inputTokens: sql<string>`coalesce(sum(${aiUsageMonth.inputTokens}), 0)`,
          outputTokens: sql<string>`coalesce(sum(${aiUsageMonth.outputTokens}), 0)`,
          cachedInputTokens: sql<string>`coalesce(sum(${aiUsageMonth.cachedInputTokens}), 0)`,
          costMicros: sql<string>`coalesce(sum(${aiUsageMonth.costMicros}), 0)`,
          callCount: sql<string>`coalesce(sum(${aiUsageMonth.callCount}), 0)`,
        })
        .from(aiUsageMonth)
        .where(inMonth);

      const rows = await db
        .select({
          userId: aiUsageMonth.userId,
          inputTokens: aiUsageMonth.inputTokens,
          outputTokens: aiUsageMonth.outputTokens,
          cachedInputTokens: aiUsageMonth.cachedInputTokens,
          costMicros: aiUsageMonth.costMicros,
          callCount: aiUsageMonth.callCount,
        })
        .from(aiUsageMonth)
        .where(and(inMonth, sql`${aiUsageMonth.callCount} > 0`))
        .orderBy(
          desc(aiUsageMonth.costMicros),
          desc(sql`${aiUsageMonth.inputTokens} + ${aiUsageMonth.outputTokens}`),
          aiUsageMonth.userId,
        )
        .limit(top);

      const accounts: AiUsageAccount[] = rows.map((row) => ({
        userId: row.userId,
        inputTokens: Number(row.inputTokens),
        outputTokens: Number(row.outputTokens),
        cachedInputTokens: Number(row.cachedInputTokens),
        costMicros: Number(row.costMicros),
        callCount: Number(row.callCount),
      }));

      return {
        month,
        resetsOn: usageResetDateOf(at),
        currency: config.currency,
        monthlyLimitMicros: config.monthlyLimitMicros,
        pricesConfigured: config.prices !== null,
        totals: {
          accounts: Number(totals?.accounts ?? 0),
          inputTokens: Number(totals?.inputTokens ?? 0),
          outputTokens: Number(totals?.outputTokens ?? 0),
          cachedInputTokens: Number(totals?.cachedInputTokens ?? 0),
          costMicros: Number(totals?.costMicros ?? 0),
          callCount: Number(totals?.callCount ?? 0),
        },
        top: accounts,
      };
    },
  };
}
