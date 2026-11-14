-- Issue #507: an OAuth grant's label is the name the app declared about
-- itself, so the apps show the app's host next to it. New grants store the
-- host the consent screen showed; existing ones get it from their client:
-- the client id's host for a metadata-document (CIMD) client, else the host
-- of its first redirect URL (a custom scheme with no host gives the scheme).
ALTER TABLE "ai_app_grant" ADD COLUMN "client_host" text;
--> statement-breakpoint
UPDATE "ai_app_grant" AS "grant"
SET "client_host" = lower(coalesce(
  substring("source"."uri" from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^@/?#]*@)?(\[[^]/?#]*\]|[^:/?#]+)'),
  substring("source"."uri" from '^([A-Za-z][A-Za-z0-9+.-]*):')
))
FROM (
  SELECT "client_id",
    CASE WHEN "client_discovery_id" IS NOT NULL THEN "client_id" ELSE "redirect_uris"[1] END AS "uri"
  FROM "oauth_client"
) AS "source"
WHERE "grant"."kind" = 'oauth'
  AND "grant"."client_host" IS NULL
  AND "source"."client_id" = "grant"."oauth_client_id";
