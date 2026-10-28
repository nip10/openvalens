/**
 * Disposable-database guard for the demo seed (Issue #301).
 *
 * The seed drops and recreates the whole `public` schema, so it must never be
 * pointed at a database that holds anyone's records. Like the integration
 * suites, it accepts only a loopback host and a fixed, unmistakable database
 * name: `openvalens_demo`, optionally with a `_suffix` (the integration suite
 * uses `openvalens_demo_test`).
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const DEMO_DATABASE_NAME = /^openvalens_demo(?:_[a-z0-9_]+)?$/;

export class DemoGuardError extends Error {
  constructor() {
    // Value-free: never echoes the URL, host or credentials.
    super(
      "Refusing to seed: DEMO_DATABASE_URL must be a loopback Postgres database named openvalens_demo (or openvalens_demo_<suffix>).",
    );
    this.name = "DemoGuardError";
  }
}

/** Returns the URL when it names a disposable demo database; throws otherwise. */
export function assertDisposableDemoDatabase(candidate: string | undefined): string {
  if (!candidate) throw new DemoGuardError();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new DemoGuardError();
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new DemoGuardError();
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new DemoGuardError();
  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new DemoGuardError();
  }
  if (!DEMO_DATABASE_NAME.test(name)) throw new DemoGuardError();
  // A connection parameter could still point the client at another host or
  // database than the one the URL names.
  for (const key of parsed.searchParams.keys()) {
    if (["host", "hostaddr", "dbname", "database", "service"].includes(key.toLowerCase()))
      throw new DemoGuardError();
  }
  return candidate;
}
