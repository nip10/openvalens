import { describe, expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  canRemoveSmokeResource,
  cleanupAndRemoveFixtures,
  cleanupOwnedSmokeResources,
  createSmokeComposeConfig,
  createSmokeProjectName,
  DockerSmokeResourceExecutor,
  fetchWithSmokeTimeout,
  getCanonicalRepositoryRoot,
  parseSmokeArguments,
  preflightSmokeResources,
  removePrivateFixtures,
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

  test("SIGTERM stops an active child after fixtures exist and removes private fixtures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ov-smoke-signal-test-"));
    const artifactParent = join(directory, "artifacts");
    const marker = join(directory, "docker-started");
    const childTerminated = join(directory, "docker-terminated");
    const fixturePathFile = join(directory, "fixture-path");
    const fakeDocker = join(directory, "docker");
    await writeFile(
      fakeDocker,
      `#!/bin/bash
case "$1 $2" in
  "container ls"|"network ls"|"volume ls") exit 0 ;;
esac
if [ "$1" = "build" ]; then
  fixture=
  for arg in "$@"; do
    case "$arg" in id=server_env,src=*) fixture="\${arg#id=server_env,src=}" ;; esac
  done
  [ -n "$fixture" ] && [ -f "$fixture" ] || exit 31
  printf '%s' "$$" > ${JSON.stringify(marker)}
  printf '%s' "$fixture" > ${JSON.stringify(fixturePathFile)}
  trap 'printf term > ${childTerminated}; exit 0' TERM
  while :; do :; done
fi
exit 0
`,
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
      let signalEvidence: { pid: number; fixture: string } | undefined;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
          signalEvidence = {
            pid: Number(await readFile(marker, "utf8")),
            fixture: await readFile(fixturePathFile, "utf8"),
          };
          break;
        } catch {
          await Bun.sleep(25);
        }
      }
      expect(signalEvidence).toBeDefined();
      await access(signalEvidence!.fixture);
      child.kill("SIGTERM");
      let termHandled = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          await access(childTerminated);
          termHandled = true;
          break;
        } catch {
          await Bun.sleep(25);
        }
      }
      expect(termHandled).toBe(true);
      const exitCode = await Promise.race([child.exited, Bun.sleep(15_000).then(() => null)]);
      if (exitCode === null) child.kill("SIGKILL");
      expect(exitCode).not.toBeNull();
      expect(exitCode).not.toBe(0);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          process.kill(signalEvidence!.pid, 0);
          await Bun.sleep(25);
        } catch {
          break;
        }
      }
      expect(() => process.kill(signalEvidence!.pid, 0)).toThrow();
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
  }, 25_000);

  test("canonical artifact roots reject repository paths and accept external temp paths", async () => {
    const repository = await getCanonicalRepositoryRoot();
    const external = await mkdtemp(join(tmpdir(), "ov-smoke-path-test-"));
    const link = join(external, "repo-link");
    try {
      await symlink(repository, link);
      expect(await resolveArtifactRoot(undefined, external)).toBe(await realpath(external));
      await expect(resolveArtifactRoot(undefined, repository)).rejects.toThrow(/outside/);
      await expect(resolveArtifactRoot(join(repository, "nested-temp"))).rejects.toThrow(/outside/);
      await expect(
        resolveArtifactRoot(undefined, join(repository, "nested-default")),
      ).rejects.toThrow(/outside/);
      await expect(resolveArtifactRoot(join(link, "nested-temp"))).rejects.toThrow(/outside/);
      await expect(resolveArtifactRoot("relative/path")).rejects.toThrow();
      await expect(resolveArtifactRoot("/")).rejects.toThrow();
    } finally {
      await rm(external, { recursive: true, force: true });
    }
    expect(parseSmokeArguments([])).toEqual({ help: false });
    expect(parseSmokeArguments(["--help"])).toEqual({ help: true });
    expect(() => parseSmokeArguments(["--dry-run"])).toThrow();
    expect(() => parseSmokeArguments(["--help", "--dry-run"])).toThrow();
  });

  test("CLI rejects repository artifact overrides before creating fixtures or calling Docker", async () => {
    const repository = await getCanonicalRepositoryRoot();
    const outside = await mkdtemp(join(tmpdir(), "ov-smoke-repo-override-test-"));
    const marker = join(outside, "docker-called");
    const fakeDocker = join(outside, "docker");
    const forbiddenOverride = join(repository, `.ov-smoke-forbidden-${randomUUID()}`);
    const forbiddenDefault = join(repository, `.ov-smoke-default-${randomUUID()}`);
    try {
      await writeFile(fakeDocker, `#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
      await chmod(fakeDocker, 0o700);
      const overrideEnv = {
        ...process.env,
        PATH: `${outside}:${process.env.PATH}`,
        OPENVALENS_SMOKE_TMPDIR: forbiddenOverride,
      };
      const overrideResult = Bun.spawnSync({
        cmd: ["bun", "scripts/deployment-smoke.ts"],
        cwd: process.cwd(),
        env: overrideEnv,
      });
      expect(overrideResult.exitCode).not.toBe(0);

      const defaultEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${outside}:${process.env.PATH}`,
        TMPDIR: forbiddenDefault,
      };
      delete defaultEnv.OPENVALENS_SMOKE_TMPDIR;
      const defaultResult = Bun.spawnSync({
        cmd: ["bun", "scripts/deployment-smoke.ts"],
        cwd: process.cwd(),
        env: defaultEnv,
      });
      expect(defaultResult.exitCode).not.toBe(0);
      await expect(readFile(marker)).rejects.toThrow();
      await expect(access(forbiddenOverride)).rejects.toThrow();
      await expect(access(forbiddenDefault)).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
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

  test("Docker collision inspection requests and logs only ownership metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ov-smoke-inspect-test-"));
    const trace = join(directory, "formats.log");
    const fakeDocker = join(directory, "docker");
    const secretSentinel = "ForeignConfigEnv_SENTINEL_93";
    await writeFile(
      fakeDocker,
      `#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);const trace=${JSON.stringify(trace)};
if(args[0]==='container'&&args[1]==='ls'){
 const filter=args[args.indexOf('--filter')+1];if(filter==='name=${project}')process.stdout.write('container-id\\n');process.exit(0);
}
if(args[0]==='network'||args[0]==='volume'){process.exit(0)}
if(args[0]==='inspect'){
 const format=args[args.indexOf('--format')+1];fs.appendFileSync(trace,format+'\\n');
 if(format.includes('{{json .}}')){
  process.stdout.write(JSON.stringify({Id:'container-id',Name:'/${project}-server-1',Config:{Labels:{'com.docker.compose.project':'${project}','com.openvalens.deployment-smoke.run':'foreign-run','com.docker.compose.service':'server'},Env:['SYNTHETIC_UNKNOWN_SECRET=${secretSentinel}']}}));
 }else{
  process.stdout.write(['container-id','/${project}-server-1','${project}','foreign-run','server'].map(value=>JSON.stringify(value)).join('\\n'));
 }
 process.exit(0);
}
process.exit(0);
`,
    );
    await chmod(fakeDocker, 0o700);
    try {
      const executor = new DockerSmokeResourceExecutor(directory, false, fakeDocker);
      await expect(preflightSmokeResources(executor, project, runId)).rejects.toThrow(/collision/);
      const formatTrace = await readFile(trace, "utf8");
      expect(formatTrace).toContain(".Config.Labels");
      expect(formatTrace).not.toContain(".Config.Env");
      expect(formatTrace).not.toContain("json .}}");
      for (const file of await readdir(directory)) {
        if (!file.endsWith(".log")) continue;
        expect(await readFile(join(directory, file), "utf8")).not.toContain(secretSentinel);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("blocked smoke HTTP requests abort promptly", async () => {
    let requestSeen!: () => void;
    const receivedRequest = new Promise<void>((resolve) => {
      requestSeen = resolve;
    });
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        requestSeen();
        return new Promise<Response>(() => {});
      },
    });
    const controller = new AbortController();
    try {
      const pending = fetchWithSmokeTimeout(
        server.url,
        { method: "OPTIONS" },
        10_000,
        controller.signal,
      );
      await receivedRequest;
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      server.stop(true);
    }
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

  test("production fixture finalizer removes successful fixture writes after Docker cleanup throws", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ov-smoke-cleanup-finalizer-test-"));
    const privateDir = join(directory, "private");
    await mkdir(privateDir, { mode: 0o700 });
    try {
      await writePrivateFixtures(privateDir, { "server.env": "synthetic-only" });
      await expect(
        cleanupAndRemoveFixtures(
          async () => {
            throw new Error("injected Docker daemon failure");
          },
          () => removePrivateFixtures(privateDir),
        ),
      ).rejects.toThrow(/injected Docker daemon failure/);
      await expect(access(privateDir)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
