# The landing site (apps/site) as a static nginx container.
# Build: docker build -f apps/site/Dockerfile .   Run with SITE_APP_URL set to the
# web app's origin (e.g. https://app.openvalens.com): any path the site does not
# have (old app links, emailed sign-in links) is redirected there.
FROM oven/bun:1.4.2 AS builder
WORKDIR /app
COPY apps/site ./apps/site
RUN cd apps/site && bun scripts/build.ts dist \
  && awk '/^  [A-Za-z-]+: /{ line=$0; sub(/^  /, "", line); i=index(line, ": "); name=substr(line, 1, i-1); v=substr(line, i+2); gsub(/"/, "\\\"", v); printf "add_header %s \"%s\" always;\n", name, v }' dist/_headers > /app/security-headers.conf \
  && rm dist/_headers

FROM nginx:1.29-alpine AS runner
ENV SITE_APP_URL=""
COPY --from=builder /app/apps/site/dist /usr/share/nginx/html
COPY --from=builder /app/security-headers.conf /etc/nginx/site-security-headers.conf
COPY apps/site/deploy/default.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
