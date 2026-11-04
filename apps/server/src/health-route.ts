import type { Hono } from "hono";

/** Public liveness path for uptime monitors. */
export const HEALTH_PATH = "/api/health";

/**
 * `GET /api/health` for uptime monitors that can only send GET or HEAD (#308).
 * It pings the database and answers 200 `{"status":"ok"}`, or 503
 * `{"status":"unready"}` when the database is unreachable. The full readiness
 * report stays at `POST /rpc/health/readiness`. Never cached.
 */
export function registerHealthRoute(
  app: Hono,
  options: { pingDatabase: () => Promise<"ok" | "unreachable"> },
): void {
  app.get(HEALTH_PATH, async (c) => {
    const database = await options.pingDatabase();
    const ok = database === "ok";
    return c.json({ status: ok ? "ok" : "unready", database }, ok ? 200 : 503, {
      "Cache-Control": "no-store",
    });
  });
}
