import type { Session } from "@openhealth/auth";
import type { Database } from "@openhealth/db";

export type Context = {
  session: Session | null;
  db: Database;
};
