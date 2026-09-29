import { createAuth } from "@openhealth/auth";
import { createDb } from "@openhealth/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
