import { describe, expect, test } from "bun:test";
import {
  canRemoveSmokeResource,
  createSmokeComposeConfig,
  createSmokeProjectName,
} from "./deployment-smoke";

describe("deployment smoke safety seams", () => {
  test("CLI help exits successfully without starting Docker", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/deployment-smoke.ts", "--help"],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("isolated Postgres volume");
  });

  test("creates a unique compose-safe project without a tracking service name", () => {
    expect(createSmokeProjectName("ab12-cdef-3456")).toBe("ov-smoke-ab12cdef3456");
    expect(() => createSmokeProjectName("bad")).toThrow();
  });

  test("permits cleanup only when both project and per-run ownership labels match", () => {
    const labels = {
      "com.docker.compose.project": "ov-smoke-ab12cdef3456",
      "com.openvalens.deployment-smoke.run": "run-1",
    };
    expect(canRemoveSmokeResource(labels, "ov-smoke-ab12cdef3456", "run-1")).toBe(true);
    expect(canRemoveSmokeResource(labels, "openvalens", "run-1")).toBe(false);
    expect(canRemoveSmokeResource(labels, "ov-smoke-ab12cdef3456", "run-2")).toBe(false);
  });

  test("renders an isolated postgres project with loopback app ports and an owned volume", () => {
    const yaml = createSmokeComposeConfig({
      project: "ov-smoke-ab12cdef3456",
      runId: "run-1",
      serverImage: "openvalens-smoke-server:run-1",
      webImage: "openvalens-smoke-web:run-1",
      serverEnvFile: "/private/server.env",
      webEnvFile: "/private/web.env",
      postgresEnvFile: "/private/postgres.env",
      serverPort: 43210,
      webPort: 43211,
    });

    expect(yaml).toContain("image: postgres:18");
    expect(yaml).toContain('"127.0.0.1:43210:3000"');
    expect(yaml).toContain('"127.0.0.1:43211:80"');
    expect(yaml).toContain("smoke_data:/var/lib/postgresql");
    expect(yaml).toContain("com.openvalens.deployment-smoke.run");
    expect(yaml).not.toContain("container_name:");
    expect(yaml).not.toContain("openhealth_openhealth_postgres_data");
    expect(yaml).not.toMatch(/\n\s+ports:\n\s+- .*5432/);
  });
});
