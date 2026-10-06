import "@openvalens/config/file-secrets-preload.database";
import "varlock/auto-load";
import { defineConfig } from "drizzle-kit";
import { ENV } from "./src/env";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    url: ENV.DATABASE_URL,
  },
});
