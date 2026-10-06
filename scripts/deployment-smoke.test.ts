import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canRemoveSmokeResource,
  cleanupAndRemoveFixtures,
  cleanupOwnedSmokeResources,
  createSmokeComposeConfig,
  createSmokeProjectName,
  parseSmokeArguments,
  preflightSmokeResources,
  resolveArtifactRoot,
  type SmokeResource,
  type SmokeResourceExecutor,
  writePrivateFixtures,
} from "./deployment-smoke";

const project = "ov-smoke-ab12cdef3456";
const runId = "run-1";
const ownLabels = {
  "com.docker.compose.project": project,
  "com.openvalens.deployment-smoke.run": runId,
};

function resource(
  kind: SmokeResource["kind"],
  name: string,
  service?: string,
  labels: SmokeResource["labels"] = ownLabels,
): SmokeResource {
  return {
    kind,
    id: `${kind}-id-${name}`,
    name,
    labels,
    service,
    references: [],
  };
}

class FakeExecutor implements SmokeResourceExecutor {
  removed: string[] = [];
  resources: SmokeResource[] = [];
  failInspect = false;

  async list(kind: SmokeResource["kind"]): Promise<SmokeResource[]> {
    return this.resources.filter((item) => item.kind === kind);
  }

  async inspect(kind: SmokeResource["kind"], id: string): Promise<SmokeResource | null> {
    if (this.failInspect) throw new Error("Docker daemon failed");
    return this.resources.find((item) => item.kind === kind && item.id === id) ?? null;
  }

  async remove(kind: SmokeResource["kind"], id: string): Promise<void> {
    this.removed.push(`${kind}:${id}`);
    this.resources = this.resources.filter((item) => item.id !== id);
  }
}

describe("deployment smoke safety seams", () => {
  test("CLI help exits successfully without starting Docker", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "scripts/deployment-smoke.ts", "--help"],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("isolated Postgres volume");
  });

  test("rejects unknown CLI args before creating artifacts or invoking fake Docker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ov-smoke-cli-test-"));
    try {
      const marker = join(directory, "docker-called");
      const fakeDocker = join(directory, "docker");
      await writeFile(fakeDocker, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
      await chmod(fakeDocker, 0o700);
      const result = Bun.spawnSync({
        cmd: ["bun", "scripts/deployment-smoke.ts", "--dry-run"],
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          OPENVALENS_SMOKE_TMPDIR: join(directory, "artifacts"),
        },
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout.toString()).toContain("Invalid smoke-test arguments");
      await expect(readFile(marker)).rejects.toThrow();
      await expect(readdir(join(directory, "artifacts"))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("catchable interruption stops the child and removes its private fixture directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ov-smoke-signal-test-"));
    const artifactParent = join(directory, "artifacts");
    const marker = join(directory, "docker-started");
    const fakeDocker = join(directory, "docker");
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env node\nconst fs=require('node:fs');const marker=${JSON.stringify(marker)};if(!fs.existsSync(marker)){fs.writeFileSync(marker,'started');fs.writeFileSync(marker+'-pid',String(process.pid));process.kill(process.ppid,'SIGTERM')}\n`,
    );
    await chmod(fakeDocker, 0o700);
    const child = Bun.spawn({
      cmd: ["bun", "scripts/deployment-smoke.ts"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        OPENVALENS_SMOKE_TMPDIR: artifactParent,
      },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      expect(await child.exited).not.toBe(0);
      await readFile(marker);
      const childPid = Number(await readFile(`${marker}-pid`, "utf8"));
      expect(() => process.kill(childPid, 0)).toThrow();
      const artifactDirs = await readdir(artifactParent);
      expect(artifactDirs).toHaveLength(1);
      const remaining = await readdir(join(artifactParent, artifactDirs[0]!));
      expect(remaining).not.toContain("private");
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  test("uses a portable temp root and rejects relative or filesystem-root overrides", () => {
    expect(resolveArtifactRoot(undefined, "/tmp/system-temp")).toBe("/tmp/system-temp");
    expect(resolveArtifactRoot("/tmp/private-smoke")).toBe("/tmp/private-smoke");
    expect(() => resolveArtifactRoot("relative/path")).toThrow();
    expect(() => resolveArtifactRoot("/")).toThrow();
    expect(parseSmokeArguments([])).toEqual({ help: false });
    expect(parseSmokeArguments(["--help"])).toEqual({ help: true });
    expect(() => parseSmokeArguments(["--dry-run"])).toThrow();
    expect(() => parseSmokeArguments(["--help", "--dry-run"])).toThrow();
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
    expect(yaml).toContain("networks:");
    expect(yaml).not.toContain("container_name:");
    expect(yaml).not.toContain("openhealth_openhealth_postgres_data");
    expect(yaml).not.toMatch(/\n\s+ports:\n\s+- .*5432/);
  });

  test("preflight refuses project-name collisions before any startup", async () => {
    const executor = new FakeExecutor();
    executor.resources.push(
      resource("volume", `${project}_smoke_data`, undefined, { owner: "foreign" }),
    );
    await expect(preflightSmokeResources(executor, project, runId)).rejects.toThrow(/collision/);
    expect(executor.removed).toEqual([]);
  });

  test("cleanup refuses missing/wrong labels and foreign candidate resources before deleting anything", async () => {
    const badNetwork = new FakeExecutor();
    badNetwork.resources.push(
      resource("network", `${project}_default`, undefined, {
        "com.docker.compose.project": project,
      }),
      resource("container", `${project}-db-1`, "db"),
    );
    expect(await cleanupOwnedSmokeResources(badNetwork, project, runId)).toBe(false);
    expect(badNetwork.removed).toEqual([]);

    const foreign = new FakeExecutor();
    foreign.resources.push(
      resource("volume", `${project}_smoke_data`, undefined, {
        "com.docker.compose.project": "another-project",
        "com.openvalens.deployment-smoke.run": runId,
      }),
    );
    expect(await cleanupOwnedSmokeResources(foreign, project, runId)).toBe(false);
    expect(foreign.removed).toEqual([]);
  });

  test("cleanup removes only exact owned identities in container/network/volume order", async () => {
    const executor = new FakeExecutor();
    executor.resources.push(
      resource("container", `${project}-db-1`, "db"),
      resource("container", `${project}-server-1`, "server"),
      resource("container", `${project}-web-1`, "web"),
      resource("network", `${project}_default`),
      resource("volume", `${project}_smoke_data`),
    );
    expect(await cleanupOwnedSmokeResources(executor, project, runId)).toBe(true);
    expect(executor.removed.map((item) => item.split(":")[0])).toEqual([
      "container",
      "container",
      "container",
      "network",
      "volume",
    ]);
    expect(executor.resources).toEqual([]);
  });

  test("cleanup after a build-stage failure removes any partial owned startup without compose down", async () => {
    const executor = new FakeExecutor();
    executor.resources.push(resource("container", `${project}-db-1`, "db"));
    expect(await cleanupOwnedSmokeResources(executor, project, runId)).toBe(true);
    expect(executor.removed).toEqual([`container:container-id-${project}-db-1`]);
  });

  test("daemon inspection errors fail closed", async () => {
    const executor = new FakeExecutor();
    executor.resources.push(resource("volume", `${project}_smoke_data`));
    executor.failInspect = true;
    expect(await cleanupOwnedSmokeResources(executor, project, runId)).toBe(false);
    expect(executor.removed).toEqual([]);
  });

  test("fixtures are removed after partial creation or cleanup failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ov-smoke-fixture-test-"));
    const privateDir = join(directory, "private");
    await mkdir(privateDir, { mode: 0o700 });
    await Bun.write(join(directory, "marker"), "owned");
    try {
      await expect(
        writePrivateFixtures(
          privateDir,
          { "first.env": "synthetic", "second.env": "synthetic" },
          async (path, content) => {
            if (path.endsWith("second.env")) throw new Error("injected write failure");
            await Bun.write(path, content);
          },
        ),
      ).rejects.toThrow();
      await cleanupAndRemoveFixtures(
        async () => {
          throw new Error("injected Docker cleanup failure");
        },
        async () => rm(privateDir, { recursive: true, force: true }),
      ).catch(() => undefined);
      await expect(readdir(privateDir)).rejects.toThrow();
      expect(await readdir(directory)).toContain("marker");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
