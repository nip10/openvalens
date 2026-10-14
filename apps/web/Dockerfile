FROM node:24-slim AS builder
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV NODE_ENV=production
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local --mount=type=secret,id=server_env,target=/app/apps/server/.env.local cd apps/web && bun run build
# Issue #127 — render the web document's security headers for VITE_SERVER_URL.
RUN --mount=type=secret,id=web_env,target=/app/apps/web/.env.local cd apps/web && bun ../../scripts/render-web-security-headers.ts security-headers

FROM nginx:alpine AS runner
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/security-headers /etc/nginx/security-headers
COPY --chmod=0755 apps/web/docker-entrypoint.d/40-csp-mode.sh /docker-entrypoint.d/40-csp-mode.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
