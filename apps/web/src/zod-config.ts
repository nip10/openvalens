import { z } from "zod";

// Issue #127 — the enforced CSP has no 'unsafe-eval'. Zod v4 otherwise probes
// `Function("")` on first object parse to decide whether to JIT-compile
// parsers; the probe is caught, but the browser still files a CSP violation
// report on every page load. Jitless mode skips the probe entirely.
z.config({ jitless: true });
