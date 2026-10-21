CREATE TABLE "analytics_consent" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
