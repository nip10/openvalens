#!/usr/bin/env bash
#
# Supported launcher for the admission operator CLI (Issue #63).
#
# Bun automatically loads a `.env` from the current directory and its parents.
# That ambient file must never be able to supply the operator database
# implicitly, so this launcher runs the CLI with `.env` autoload disabled
# (`bun --no-env-file`). The CLI then requires an explicit `DATABASE_URL` or
# `DATABASE_URL_FILE` in the environment.
#
# Always invoke the CLI through this launcher, never `bun run` / a bare
# `bun scripts/admission.ts` (both may load `.env`).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun --no-env-file "$here/admission.ts" "$@"
