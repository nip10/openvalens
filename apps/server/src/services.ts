import { createAuth, setRegisteredAuth } from "@openhealth/auth";
import { createDb } from "@openhealth/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);

// Register the auth singleton so the guards in `@openhealth/auth/authz/*`
// can resolve the active Better Auth instance without it being threaded
// through every call site.
setRegisteredAuth(auth);
