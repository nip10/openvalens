-- Custom SQL migration file, put your code below! --
ALTER TABLE "insight_preference" DROP CONSTRAINT "insight_preference_disabled_channels_check";--> statement-breakpoint
ALTER TABLE "insight_preference" ADD CONSTRAINT "insight_preference_disabled_channels_check" CHECK ("disabled_channels" <@ array[
  'change:in_app', 'change:push', 'change:email',
  'goal_milestone:in_app', 'goal_milestone:push', 'goal_milestone:email',
  'data_quality:in_app', 'data_quality:push', 'data_quality:email',
  'streak:in_app', 'streak:push', 'streak:email',
  'reminder:in_app', 'reminder:push', 'reminder:email',
  'observation:enabled', 'observation:in_app', 'observation:push', 'observation:email'
]::text[]);
