/**
 * Test-only Varlock initialization.
 *
 * Components under test import modules that read `ENV.VITE_SERVER_URL` through
 * the Varlock proxy. In the Bun test runner the Vite plugin is not active, so
 * we seed the Varlock env graph before any module accesses `ENV`.
 */

import { initVarlockEnv } from "varlock/env";

process.env.__VARLOCK_ENV = JSON.stringify({
  settings: { disableProcessEnvInjection: true },
  config: {
    VITE_SERVER_URL: {
      value: "http://localhost:3000",
      envStr: "http://localhost:3000",
    },
    NODE_ENV: {
      value: "test",
      envStr: "test",
    },
  },
});

// Another suite may have imported Varlock before this serialized test seed.
// Explicit initialization also handles that order without loading env files.
initVarlockEnv();
