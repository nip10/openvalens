import "@openvalens/config/file-secrets-preload.server";
import { createRequire } from "node:module";
import type * as GeneratedEnv from "./env";
import { validateProductionSecrets } from "./validate-production-secrets";

// Varlock must load only after the *_FILE preload has populated `process.env`.
//
// Static ESM imports (and the production bundler) hoist `varlock/env` and
// `varlock/auto-load` above every module body, which would make Varlock snapshot
// `process.env` before file secrets were resolved. These synchronous requires
// run here, in source order, after the preload module body. `varlock/env` shares
// the proxy instance that `varlock/auto-load` initialises, so `ENV` is typed via
// the generated schema and read only after validation.
const require = createRequire(import.meta.url);
require("varlock/auto-load");
const { ENV } = require("varlock/env") as {
  ENV: (typeof GeneratedEnv)["ENV"];
};

validateProductionSecrets(ENV);

export { ENV };
