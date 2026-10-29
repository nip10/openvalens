-- Issue #299 — AI usage per person per calendar month (UTC), for the monthly
-- AI cost cap (`AI_MONTHLY_COST_LIMIT`) and the operator usage view.
--
-- Counts only: token totals, the estimated model cost in millionths of the
-- configured currency, and the number of provider calls. No prompt, reply,
-- conversation id or health value is stored. `reserved_micros` holds budget
-- for calls still in flight; it lapses at `reserved_until` so a crashed
-- server never locks a person out for the rest of the month.
CREATE TABLE "ai_usage_month" (
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"month" date NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"call_count" integer DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_month_pkey" PRIMARY KEY ("user_id", "month"),
	CONSTRAINT "ai_usage_month_first_day_check" CHECK (extract(day from "month") = 1),
	CONSTRAINT "ai_usage_month_non_negative_check" CHECK ("input_tokens" >= 0 and "output_tokens" >= 0 and "cached_input_tokens" >= 0 and "cost_micros" >= 0 and "call_count" >= 0 and "reserved_micros" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_usage_month_month_cost_idx" ON "ai_usage_month" ("month", "cost_micros");
