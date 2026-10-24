-- Daily reminders follow each member's local hour and cover weekly and
-- training-day items.
--
-- 1. The local hour (0-23) from which the day's supplement / medication /
--    event reminders may go out, in the member's notification time zone
--    (insight_preference.time_zone). Separate from the weekly-insight
--    delivery_hour. 8 for every existing and new row.
ALTER TABLE "insight_preference" ADD COLUMN "daily_reminder_hour" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "insight_preference" ADD CONSTRAINT "insight_preference_daily_reminder_hour_check" CHECK ("daily_reminder_hour" between 0 and 23);--> statement-breakpoint
-- 2. Which ISO weekdays (1 = Monday ... 7 = Sunday) a weekly or training-day
--    item is taken. Null (or empty) means no day chosen: no reminder.
ALTER TABLE "supplement_schedule" ADD COLUMN "days_of_week" smallint[];--> statement-breakpoint
ALTER TABLE "supplement_schedule" ADD CONSTRAINT "supplement_schedule_days_of_week_check" CHECK ("days_of_week" is null or "days_of_week" <@ array[1,2,3,4,5,6,7]::smallint[]);--> statement-breakpoint
ALTER TABLE "medication" ADD COLUMN "days_of_week" smallint[];--> statement-breakpoint
ALTER TABLE "medication" ADD CONSTRAINT "medication_days_of_week_check" CHECK ("days_of_week" is null or "days_of_week" <@ array[1,2,3,4,5,6,7]::smallint[]);
