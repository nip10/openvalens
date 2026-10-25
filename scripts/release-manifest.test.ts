/**
 * Release-artifact manifest (Issue #129). Docker and git are replaced by an
 * injected runner, so nothing is built, inspected or pushed here.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  createManifest,
  diffMigrations,
  dockerTagFrom,
  listMigrations,
  parseArgs,
  parseComposeImages,
  parseDockerfileBases,
  verifyManifest,
  type CreateOptions,
  type Runner,
} from "./release-manifest";

const repo = join(import.meta.dir, "..");
const COMMIT = "a".repeat(40);
const SERVER_ID = `sha256:${"1".repeat(64)}`;
const WEB_ID = `sha256:${"2".repeat(64)}`;

function fakeRunner(opts: { dirty?: boolean; revision?: string; images?: boolean } = {}) {
  const calls: string[][] = [];
  const run: Runner = (cmd) => {
    calls.push(cmd);
    const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
    if (cmd[0] === "git" && cmd[1] === "rev-parse") return ok(`${COMMIT}\n`);
    if (cmd[0] === "git" && cmd[1] === "describe") return ok("v1.0.0\n");
    if (cmd[0] === "git" && cmd[1] === "status") return ok(opts.dirty ? " M file\n" : "");
    if (cmd[0] === "docker" && cmd[1] === "build") return ok("");
    if (cmd[0] === "docker" && cmd[1] === "image") {
      const reference = cmd.at(-1)!;
      if (opts.images === false) return { exitCode: 1, stdout: "", stderr: "" };
      const id = reference.startsWith("openvalens-server")
        ? SERVER_ID
        : reference.startsWith("openvalens-web")
          ? WEB_ID
          : `sha256:${"9".repeat(64)}`;
      return ok(
        JSON.stringify({
          Id: id,
          RepoDigests: reference.startsWith("openvalens-")
            ? []
            : [`${reference.split(":")[0]}@sha256:${"3".repeat(64)}`],
          Config: { Labels: { "org.opencontainers.image.revision": opts.revision ?? COMMIT } },
        }),
      );
    }
    throw new Error(`unexpected command ${cmd.join(" ")}`);
  };
  return { run, calls };
}

function createOptions(overrides: Partial<CreateOptions> = {}): CreateOptions {
  return {
    command: "create",
    serverUrl: "https://health.example.org",
    output: null,
    version: null,
    previousManifest: null,
    build: true,
    allowDirty: false,
    dryRun: false,
    ...overrides,
  };
}

const quiet = () => {};

describe("createManifest", () => {
  test("builds both images, pins them by content digest and records the commit", () => {
    const { run, calls } = fakeRunner();
    const manifest = createManifest(createOptions(), run, quiet, repo);
    expect(manifest.version).toBe("v1.0.0");
    expect(manifest.git).toEqual({ commit: COMMIT, describe: "v1.0.0", dirty: false });
    expect(manifest.images.map((image) => [image.reference, image.imageId])).toEqual([
      ["openvalens-server:v1.0.0", SERVER_ID],
      ["openvalens-web:v1.0.0", WEB_ID],
    ]);
    const builds = calls.filter((cmd) => cmd[0] === "docker" && cmd[1] === "build");
    expect(builds).toHaveLength(2);
    expect(builds[1]).toContain("VITE_SERVER_URL=https://health.example.org");
    // Never pushes, tags in git or logs in to a registry.
    expect(calls.some((cmd) => cmd.includes("push") || cmd.includes("login"))).toBe(false);
    expect(calls.some((cmd) => cmd[0] === "git" && cmd[1] === "tag")).toBe(false);
  });

  test("records the tracked migrations and the third-party digests", () => {
    const { run } = fakeRunner();
    const manifest = createManifest(createOptions(), run, quiet, repo);
    expect(manifest.migrations.names).toEqual(listMigrations(repo));
    expect(manifest.migrations.count).toBeGreaterThan(40);
    expect(manifest.thirdPartyImages.map((image) => image.service).sort()).toEqual([
      "caddy",
      "postgres",
    ]);
    // The locally built backup image's base is the pinned Postgres image.
    const backupBase = manifest.baseImages.find(
      (base) => base.dockerfile === "deploy/backup/Dockerfile",
    );
    expect(backupBase?.pinnedByDigest).toBe(true);
    expect(backupBase?.reference).toBe(
      manifest.thirdPartyImages.find((image) => image.service === "postgres")?.reference,
    );
    expect(manifest.thirdPartyImages.every((image) => image.pinnedByDigest)).toBe(true);
    for (const base of manifest.baseImages) {
      expect(base.resolvedDigest).toMatch(/@sha256:/);
    }
  });

  test("dry run builds and inspects nothing", () => {
    const { run, calls } = fakeRunner();
    const lines: string[] = [];
    const manifest = createManifest(
      createOptions({ dryRun: true }),
      run,
      (line) => lines.push(line),
      repo,
    );
    expect(calls.every((cmd) => cmd[0] === "git")).toBe(true);
    expect(manifest.dryRun).toBe(true);
    expect(manifest.images.every((image) => image.imageId === null)).toBe(true);
    expect(lines.filter((line) => line.includes("would run: docker build"))).toHaveLength(2);
  });

  test("refuses a dirty tree unless allowed, and records it", () => {
    expect(() =>
      createManifest(createOptions(), fakeRunner({ dirty: true }).run, quiet, repo),
    ).toThrow(/uncommitted/);
    const manifest = createManifest(
      createOptions({ allowDirty: true }),
      fakeRunner({ dirty: true }).run,
      quiet,
      repo,
    );
    expect(manifest.git.dirty).toBe(true);
  });

  test("refuses an image built from another commit, or a missing image", () => {
    expect(() =>
      createManifest(
        createOptions({ build: false }),
        fakeRunner({ revision: "b".repeat(40) }).run,
        quiet,
        repo,
      ),
    ).toThrow(/different commit/);
    expect(() =>
      createManifest(
        createOptions({ build: false }),
        fakeRunner({ images: false }).run,
        quiet,
        repo,
      ),
    ).toThrow(/not found locally/);
  });
});

describe("verifyManifest", () => {
  test("passes only when every local digest matches", () => {
    const manifest = createManifest(createOptions(), fakeRunner().run, quiet, repo);
    expect(verifyManifest(manifest, fakeRunner().run).every((result) => result.ok)).toBe(true);

    const tampered = structuredClone(manifest);
    tampered.images[0]!.imageId = `sha256:${"f".repeat(64)}`;
    const results = verifyManifest(tampered, fakeRunner().run);
    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(results[0]!.detail).toBe("digest differs from manifest");
  });

  test("never accepts a dry-run manifest", () => {
    const manifest = createManifest(createOptions({ dryRun: true }), fakeRunner().run, quiet, repo);
    expect(verifyManifest(manifest, fakeRunner().run)[0]!.ok).toBe(false);
  });
});

describe("helpers", () => {
  test("diffMigrations reports added and missing migrations", () => {
    expect(diffMigrations(["a", "b", "c"], ["a", "b"])).toEqual({ added: ["c"], missing: [] });
    expect(diffMigrations(["a", "c"], ["a", "b"])).toEqual({ added: ["c"], missing: ["b"] });
  });

  test("parseDockerfileBases ignores build stages and flags unpinned bases", () => {
    const bases = parseDockerfileBases(
      "Dockerfile",
      [
        "FROM node:24-slim AS builder",
        "COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun",
        `FROM nginx@sha256:${"4".repeat(64)} AS runner`,
        "COPY --from=builder /app /app",
      ].join("\n"),
    );
    expect(bases.map((base) => [base.reference, base.pinnedByDigest])).toEqual([
      ["node:24-slim", false],
      ["oven/bun:1.4.2", false],
      [`nginx@sha256:${"4".repeat(64)}`, true],
    ]);
  });

  test("parseComposeImages skips the locally built app images", () => {
    const images = parseComposeImages(
      [
        "services:",
        "  server:",
        "    image: openvalens-server:${OPENVALENS_VERSION:?x}",
        "  migrate:",
        "    image: openvalens-server:${OPENVALENS_VERSION:?x}",
        "  postgres:",
        "    image: postgres:18.6",
      ].join("\n"),
    );
    expect(images).toEqual([
      { service: "postgres", reference: "postgres:18.6", pinnedByDigest: false },
    ]);
  });

  test("dockerTagFrom matches the setup.sh tag charset", () => {
    expect(dockerTagFrom("v1.2.3-4-gabc+dirty")).toBe("v1.2.3-4-gabc-dirty");
    expect(dockerTagFrom("")).toBe("local");
  });
});

describe("parseArgs", () => {
  test("create requires an https origin compiled into the web bundle", () => {
    expect(() => parseArgs(["create"])).toThrow(/--server-url/);
    expect(() => parseArgs(["create", "--server-url", "http://health.example.org"])).toThrow(
      /https/,
    );
    expect(() => parseArgs(["create", "--server-url", "https://health.example.org/api"])).toThrow(
      /bare origin/,
    );
    expect(
      parseArgs(["create", "--server-url", "https://health.example.org", "--dry-run"]),
    ).toMatchObject({ command: "create", dryRun: true, build: true });
  });

  test("verify requires only a manifest path", () => {
    expect(parseArgs(["verify", "--manifest", "m.json"])).toEqual({
      command: "verify",
      manifest: "m.json",
    });
    expect(() => parseArgs(["verify"])).toThrow(/--manifest/);
    expect(() => parseArgs(["verify", "--manifest", "m.json", "--dry-run"])).toThrow();
  });

  test("rejects unknown commands and options without echoing them", () => {
    expect(() => parseArgs(["push"])).toThrow(/unknown command/);
    try {
      parseArgs(["create", "--token=s3cr3t"]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect((error as Error).message).not.toContain("s3cr3t");
    }
  });
});
