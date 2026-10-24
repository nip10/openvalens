-- Daily supplement/medication/event reminders by email: a separate opt-in,
-- off for every existing and new member.
ALTER TABLE "insight_preference" ADD COLUMN "daily_reminder_email" boolean DEFAULT false NOT NULL;
