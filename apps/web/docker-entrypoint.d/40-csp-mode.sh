#!/bin/sh
# Issue #127 — selects the web document's CSP mode at container start. The
# snippets are rendered at build time by scripts/render-web-security-headers.ts.
# Unset means enforce (the image is production-only); an invalid value stops
# the container instead of silently falling back. See docs/security-csp.md.
set -eu

dir=/etc/nginx/security-headers

case "${CSP_MODE:-enforce}" in
  enforce | report-only) mode="${CSP_MODE:-enforce}" ;;
  *)
    echo "40-csp-mode: invalid CSP_MODE (expected enforce or report-only); see docs/security-csp.md" >&2
    exit 1
    ;;
esac

cp "$dir/security-headers.$mode.conf" "$dir/active.conf"
echo "40-csp-mode: web CSP mode is $mode"
