/**
 * Issue #302 — the fixed ports and names of the local e2e stack. Everything
 * binds to loopback; the ports sit away from the usual dev ports (3000, 3001,
 * 8081, 5432) so the suite can run next to a normal dev session. Override any
 * of them with the environment variable of the same name.
 */
import { join } from "node:path";

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return value;
}

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
export const NATIVE_DIR = join(REPO_ROOT, "apps", "native");
export const FLOWS_DIR = join(NATIVE_DIR, ".maestro");

export const E2E = {
  pgPort: port("E2E_PG_PORT", 55451),
  serverPort: port("E2E_SERVER_PORT", 3410),
  helperPort: port("E2E_HELPER_PORT", 3411),
  metroPort: port("E2E_METRO_PORT", 8291),
  pgContainer: process.env.E2E_PG_CONTAINER ?? "openvalens-e2e-pg",
  /** Must match the demo-seed guard: loopback and `openvalens_demo_<suffix>`. */
  database: "openvalens_demo_e2e",
  appId: "com.openvalens.app",
  iosSimulator: process.env.E2E_IOS_SIMULATOR ?? "OpenValens-E2E",
  iosDeviceType: process.env.E2E_IOS_DEVICE_TYPE ?? "iPhone 17 Pro",
  androidAvd: process.env.E2E_ANDROID_AVD ?? "ov-e2e",
  /** Git-ignored output root (screenshots, logs, Maestro reports). */
  outDir: process.env.E2E_OUT_DIR ?? join(NATIVE_DIR, "e2e-artifacts"),
} as const;

export const databaseUrl = () => `postgres://postgres:pw@127.0.0.1:${E2E.pgPort}/${E2E.database}`;
/** What the app types into "My own server". Android reaches it through `adb reverse`. */
export const serverUrl = () => `http://localhost:${E2E.serverPort}`;
export const helperUrl = () => `http://localhost:${E2E.helperPort}`;
/** No web app runs in the suite; this origin only has to be a valid URL. */
export const webOrigin = () => `http://localhost:${E2E.serverPort + 2}`;
