FROM oven/bun:1.4.2 AS builder
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/server && bun run build

FROM oven/bun:1.4.2 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=bun:bun /app /app
RUN mkdir -p /app/.turbo/cache && chown -R bun:bun /app/.turbo
# Issue #62 — local object storage root. A fresh named volume mounted here
# inherits this owner and mode, so only the server user can read objects.
RUN mkdir -p /var/lib/openvalens/storage && chown bun:bun /var/lib/openvalens/storage && chmod 0700 /var/lib/openvalens/storage

EXPOSE 3000

WORKDIR /app/apps/server
USER bun
CMD ["bun", "dist/index.mjs"]
