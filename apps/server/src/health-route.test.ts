import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { HEALTH_PATH, registerHealthRoute } from "./health-route";

function appWith(database: "ok" | "unreachable") {
  const app = new Hono();
  registerHealthRoute(app, { pingDatabase: async () => database });
  return app;
}

describe("GET /api/health (#308)", () => {
  test("answers 200 without a session when the database is up", async () => {
    const response = await appWith("ok").request(HEALTH_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  test("answers 503 when the database is unreachable", async () => {
    const response = await appWith("unreachable").request(HEALTH_PATH);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unready", database: "unreachable" });
  });

  test("answers HEAD too, for monitors that only send HEAD", async () => {
    const response = await appWith("ok").request(HEALTH_PATH, { method: "HEAD" });
    expect(response.status).toBe(200);
  });
});
