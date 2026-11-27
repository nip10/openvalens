#!/bin/sh
# Writes the API origin into the web bundle and its security headers at
# container start, so one published image serves any domain. Release images
# are built with the placeholder origin below
# (.github/workflows/publish-images.yml); an image built for one domain
# (deploy/setup.sh --build, the hosted service's images) has no placeholder,
# and this does nothing. Runs before 40-csp-mode.sh copies the headers.
set -eu

placeholder="https://openvalens-runtime-server-url.invalid"
html="${OPENVALENS_WEB_ROOT:-/usr/share/nginx/html}"
headers="${OPENVALENS_WEB_HEADERS:-/etc/nginx/security-headers}"

files=$(grep -rlF "$placeholder" "$html" "$headers" 2>/dev/null || true)
[ -n "$files" ] || exit 0

url="${OPENVALENS_SERVER_URL:-}"
url="${url%/}"
# Scheme and host (and port) only: the value lands in JavaScript strings and
# nginx header values, so nothing that could escape either is accepted.
if ! printf '%s' "$url" | grep -Eq '^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'; then
  echo "30-server-url: set OPENVALENS_SERVER_URL to the API origin, for example https://health.example.org" >&2
  exit 1
fi

pattern=$(printf '%s' "$placeholder" | sed 's/\./\\./g')
printf '%s\n' "$files" | while IFS= read -r file; do
  sed "s|$pattern|$url|g" "$file" >"$file.tmp"
  cat "$file.tmp" >"$file"
  rm -f "$file.tmp"
done
echo "30-server-url: the web app uses $url"
