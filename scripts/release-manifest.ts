#!/usr/bin/env bun
/**
 * Release-artifact manifest (Issue #129).
 *
 *   bun scripts/release-manifest.ts create --server-url https://health.example.org \
 *     --output /path/to/release-manifest.json [--version <tag>] \
 *     [--previous-manifest <path>] [--no-build] [--allow-dirty] [--dry-run]
 *   bun scripts/release-manifest.ts verify --manifest /path/to/release-manifest.json
 *
 * `create` builds (or, with `--no-build`, only inspects) the `openvalens-server`
 * and `openvalens-web` images for the current checkout and writes a manifest
 * that pins each image by its content digest (`docker image inspect` `.Id`),
 * together with the git commit, the third-party image digests from
 * `deploy/compose.yml`, the Dockerfile base images, and the tracked migration
 * list (plus the delta against a previous manifest). `--dry-run` builds and
 * inspects nothing: it prints the Docker commands it would run and a manifest
 * with null image digests.
 *
 * `verify` re-inspects the local images named in a manifest and fails unless
 * every digest still matches, so the images an operator is about to start are
 * exactly the approved ones.
 *
 * This tool never pushes an image, creates a tag, contacts a registry other
 * than Docker's own base-image pulls during `docker build`, or reads a secret.
 * Deploying, migrating and tagging remain separate, explicitly authorized
 * human steps (docs/release.md).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS_DIR = "packages/db/src/migrations";
const MANIFEST_SCHEMA = "openvalens.release-manifest/v1";

export type AppImage = {
  /** Compose service that runs the image. */
  service: "server" | "web";
  /** Local reference, `openvalens-<service>:<version>`. */
  reference: string;
  dockerfile: string;
  /** Content digest (`docker image inspect .Id`); null in a dry run. */
  imageId: string | null;
  /** Registry digests; empty until an authorized human pushes the image. */
  repoDigests: string[];
};

export type PinnedImage = { service: string; reference: string; pinnedByDigest: boolean };
export type BaseImage = {
  dockerfile: string;
  reference: string;
  pinnedByDigest: boolean;
  /**
   * Registry digest of the base image as pulled for this build (from the
   * local image cache); null in a dry run or when Docker has no record.
   */
  resolvedDigest?: string | null;
};

export type ReleaseManifest = {
  schema: typeof MANIFEST_SCHEMA;
  version: string;
  git: { commit: string; describe: string; dirty: boolean };
  createdAt: string;
  dryRun: boolean;
  /** Public API origin compiled into the web bundle (`VITE_SERVER_URL`). */
  serverUrl: string;
  images: AppImage[];
  thirdPartyImages: PinnedImage[];
  baseImages: BaseImage[];
  migrations: {
    count: number;
    names: string[];
    /** Migrations not in the previous manifest; null without one. */
    added: string[] | null;
    /** Migrations in the previous manifest missing here (must be empty). */
    missing: string[] | null;
    previousVersion: string | null;
  };
};

export type CreateOptions = {
  command: "create";
  serverUrl: string;
  output: string | null;
  version: string | null;
  previousManifest: string | null;
  build: boolean;
  allowDirty: boolean;
  dryRun: boolean;
};
export type VerifyOptions = { command: "verify"; manifest: string };
export type ParsedArgs = CreateOptions | VerifyOptions | { command: "help" };

const VALUE_FLAGS = new Set([
  "--server-url",
  "--output",
  "--version",
  "--previous-manifest",
  "--manifest",
]);
const BOOLEAN_FLAGS = new Set(["--no-build", "--allow-dirty", "--dry-run"]);

/** Parses CLI arguments; never echoes a rejected value (it may be a secret). */
export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    return { command: "help" };
  }
  if (command !== "create" && command !== "verify") {
    throw new Error("unknown command (expected create or verify; see --help)");
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--help" || arg === "-h") return { command: "help" };
    if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg);
    } else if (VALUE_FLAGS.has(arg)) {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      values.set(arg, value);
      i++;
    } else {
      throw new Error("unknown option (see --help)");
    }
  }

  if (command === "verify") {
    const manifest = values.get("--manifest");
    if (!manifest) throw new Error("verify requires --manifest <path>");
    if (flags.size > 0 || values.size > 1) {
      throw new Error("verify accepts only --manifest");
    }
    return { command: "verify", manifest };
  }

  if (values.has("--manifest")) throw new Error("--manifest is only valid with verify");
  const serverUrl = values.get("--server-url");
  if (!serverUrl) throw new Error("create requires --server-url <public API origin>");
  assertServerUrl(serverUrl);
  const version = values.get("--version") ?? null;
  if (version !== null && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(version)) {
    throw new Error("--version must be a valid Docker tag");
  }
  return {
    command: "create",
    serverUrl,
    output: values.get("--output") ?? null,
    version,
    previousManifest: values.get("--previous-manifest") ?? null,
    build: !flags.has("--no-build"),
    allowDirty: flags.has("--allow-dirty"),
    dryRun: flags.has("--dry-run"),
  };
}

/** The web bundle compiles this origin in; it must be a bare https origin. */
export function assertServerUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--server-url must be an absolute URL");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("--server-url must use https (http is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("--server-url must be a bare origin (no credentials, path or query)");
  }
}

/** Every `image:` reference in a compose file, keyed by service. */
export function parseComposeImages(composeYaml: string): PinnedImage[] {
  const compose = Bun.YAML.parse(composeYaml) as {
    services?: Record<string, { image?: string; build?: unknown }>;
  };
  return Object.entries(compose.services ?? {})
    .filter(([, service]) => service.image !== undefined && service.build === undefined)
    .filter(([, service]) => !service.image!.includes("${OPENVALENS_VERSION"))
    .map(([name, service]) => ({
      service: name,
      reference: service.image!,
      pinnedByDigest: /@sha256:[0-9a-f]{64}$/.test(service.image!),
    }));
}

/** External `FROM` and `COPY --from=<image>` references in a Dockerfile. */
export function parseDockerfileBases(dockerfile: string, content: string): BaseImage[] {
  const stages = new Set<string>();
  const references: string[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) {
      if (!stages.has(from[1]!.toLowerCase())) references.push(from[1]!);
      if (from[2]) stages.add(from[2].toLowerCase());
      continue;
    }
    const copy = /^COPY\s+.*--from=(\S+)/i.exec(line);
    if (copy && !stages.has(copy[1]!.toLowerCase()) && !/^\d+$/.test(copy[1]!)) {
      references.push(copy[1]!);
    }
  }
  return [...new Set(references)].map((reference) => ({
    dockerfile,
    reference,
    pinnedByDigest: /@sha256:[0-9a-f]{64}$/.test(reference),
  }));
}

/** Tracked Drizzle migration folder names, in apply order. */
export function listMigrations(root = repository): string[] {
  return readdirSync(join(root, MIGRATIONS_DIR), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function diffMigrations(
  current: string[],
  previous: string[],
): { added: string[]; missing: string[] } {
  const before = new Set(previous);
  const now = new Set(current);
  return {
    added: current.filter((name) => !before.has(name)),
    missing: previous.filter((name) => !now.has(name)),
  };
}

type CommandResult = { exitCode: number; stdout: string; stderr: string };
export type Runner = (cmd: string[], options?: { inherit?: boolean }) => CommandResult;

const defaultRunner: Runner = (cmd, options) => {
  const result = Bun.spawnSync(cmd, {
    cwd: repository,
    stdout: options?.inherit ? "inherit" : "pipe",
    stderr: options?.inherit ? "inherit" : "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
  };
};

function git(run: Runner, args: string[]): string {
  const result = run(["git", ...args]);
  if (result.exitCode !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

/** `git describe`, sanitized to the tag charset `deploy/setup.sh` uses. */
export function dockerTagFrom(describe: string): string {
  return (describe || "local").replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120);
}

export function buildCommands(
  options: Pick<CreateOptions, "serverUrl">,
  version: string,
  commit: string,
): string[][] {
  const label = `org.opencontainers.image.revision=${commit}`;
  return [
    [
      "docker",
      "build",
      "--file",
      "apps/server/Dockerfile",
      "--tag",
      `openvalens-server:${version}`,
      "--label",
      label,
      ".",
    ],
    [
      "docker",
      "build",
      "--file",
      "apps/web/Dockerfile",
      "--build-arg",
      `VITE_SERVER_URL=${options.serverUrl}`,
      "--tag",
      `openvalens-web:${version}`,
      "--label",
      label,
      ".",
    ],
  ];
}

type Inspected = { id: string; repoDigests: string[]; revision: string | null };

export function inspectImage(run: Runner, reference: string): Inspected | null {
  const result = run(["docker", "image", "inspect", "--format", "{{json .}}", reference]);
  if (result.exitCode !== 0) return null;
  const parsed = JSON.parse(result.stdout) as {
    Id: string;
    RepoDigests?: string[] | null;
    Config?: { Labels?: Record<string, string> | null };
  };
  return {
    id: parsed.Id,
    repoDigests: parsed.RepoDigests ?? [],
    revision: parsed.Config?.Labels?.["org.opencontainers.image.revision"] ?? null,
  };
}

export function createManifest(
  options: CreateOptions,
  run: Runner = defaultRunner,
  log: (line: string) => void = (line) => console.error(line),
  root = repository,
): ReleaseManifest {
  const commit = git(run, ["rev-parse", "HEAD"]);
  const describe = git(run, ["describe", "--tags", "--always", "--dirty"]);
  const dirty = git(run, ["status", "--porcelain", "--untracked-files=no"]) !== "";
  if (dirty && !options.allowDirty) {
    throw new Error("the working tree has uncommitted changes; commit them or pass --allow-dirty");
  }
  const version = options.version ?? dockerTagFrom(describe);

  const images: AppImage[] = [
    {
      service: "server",
      reference: `openvalens-server:${version}`,
      dockerfile: "apps/server/Dockerfile",
      imageId: null,
      repoDigests: [],
    },
    {
      service: "web",
      reference: `openvalens-web:${version}`,
      dockerfile: "apps/web/Dockerfile",
      imageId: null,
      repoDigests: [],
    },
  ];

  if (options.dryRun) {
    if (options.build) {
      for (const cmd of buildCommands(options, version, commit)) {
        log(`release-manifest: [dry-run] would run: ${cmd.join(" ")}`);
      }
    }
    log("release-manifest: [dry-run] image digests are null; nothing was built or inspected");
  } else {
    if (options.build) {
      for (const cmd of buildCommands(options, version, commit)) {
        log(`release-manifest: running: ${cmd.join(" ")}`);
        if (run(cmd, { inherit: true }).exitCode !== 0) {
          throw new Error(`docker build failed for ${cmd[cmd.indexOf("--tag") + 1]}`);
        }
      }
    }
    for (const image of images) {
      const inspected = inspectImage(run, image.reference);
      if (!inspected) {
        throw new Error(`image ${image.reference} not found locally (build it or drop --no-build)`);
      }
      if (inspected.revision !== null && inspected.revision !== commit) {
        throw new Error(`image ${image.reference} was built from a different commit`);
      }
      image.imageId = inspected.id;
      image.repoDigests = inspected.repoDigests;
    }
  }

  const names = listMigrations(root);
  let added: string[] | null = null;
  let missing: string[] | null = null;
  let previousVersion: string | null = null;
  if (options.previousManifest) {
    const previous = readManifest(options.previousManifest);
    const diff = diffMigrations(names, previous.migrations.names);
    added = diff.added;
    missing = diff.missing;
    previousVersion = previous.version;
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} migration(s) from the previous release are missing; migrations are append-only`,
      );
    }
  }

  return {
    schema: MANIFEST_SCHEMA,
    version,
    git: { commit, describe, dirty },
    createdAt: new Date().toISOString(),
    dryRun: options.dryRun,
    serverUrl: options.serverUrl,
    images,
    thirdPartyImages: parseComposeImages(readFileSync(join(root, "deploy/compose.yml"), "utf8")),
    baseImages: images
      .flatMap((image) =>
        parseDockerfileBases(image.dockerfile, readFileSync(join(root, image.dockerfile), "utf8")),
      )
      .map((base) => ({
        ...base,
        resolvedDigest: options.dryRun
          ? null
          : (inspectImage(run, base.reference)?.repoDigests[0] ?? null),
      })),
    migrations: { count: names.length, names, added, missing, previousVersion },
  };
}

export function readManifest(path: string): ReleaseManifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ReleaseManifest;
  if (manifest.schema !== MANIFEST_SCHEMA) {
    throw new Error("not a release manifest (unexpected schema)");
  }
  return manifest;
}

export type VerifyResult = { reference: string; ok: boolean; detail: string };

/** Compares the local images to the manifest's pinned digests. */
export function verifyManifest(manifest: ReleaseManifest, run: Runner = defaultRunner) {
  if (manifest.dryRun) {
    return [{ reference: "(manifest)", ok: false, detail: "dry-run manifest has no digests" }];
  }
  return manifest.images.map((image): VerifyResult => {
    const inspected = inspectImage(run, image.reference);
    if (!inspected) return { reference: image.reference, ok: false, detail: "not found locally" };
    if (inspected.id !== image.imageId) {
      return { reference: image.reference, ok: false, detail: "digest differs from manifest" };
    }
    return { reference: image.reference, ok: true, detail: inspected.id };
  });
}

/** Human-readable summary lines (no secrets exist in a manifest). */
export function summarize(manifest: ReleaseManifest): string[] {
  const lines = [
    `version ${manifest.version} (commit ${manifest.git.commit}${manifest.git.dirty ? ", DIRTY" : ""})`,
    ...manifest.images.map((image) => `image ${image.reference} ${image.imageId ?? "(dry-run)"}`),
    ...manifest.thirdPartyImages.map(
      (image) =>
        `third-party ${image.service} ${image.reference}${image.pinnedByDigest ? "" : " (NOT digest-pinned)"}`,
    ),
    ...manifest.baseImages.map(
      (image) =>
        `base ${image.dockerfile} ${image.reference}${
          image.pinnedByDigest
            ? ""
            : ` (NOT digest-pinned; resolved ${image.resolvedDigest ?? "unknown"})`
        }`,
    ),
    `migrations ${manifest.migrations.count} tracked`,
  ];
  if (manifest.migrations.added !== null) {
    lines.push(
      `migrations added since ${manifest.migrations.previousVersion}: ${
        manifest.migrations.added.length === 0 ? "none" : manifest.migrations.added.join(", ")
      }`,
    );
  }
  return lines;
}

const USAGE = readFileSync(fileURLToPath(import.meta.url), "utf8")
  .split("\n")
  .slice(2)
  .join("\n")
  .split("\n */")[0]!
  .replace(/^ \* ?/gm, "");

function writeOutput(path: string, content: string): void {
  const target = isAbsolute(path) ? path : resolve(process.cwd(), path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { flag: "wx", mode: 0o644 });
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === "help") {
      console.log(USAGE);
    } else if (args.command === "verify") {
      const results = verifyManifest(readManifest(args.manifest));
      for (const result of results) {
        console.log(`${result.ok ? "PASS" : "FAIL"} ${result.reference} ${result.detail}`);
      }
      process.exit(results.every((result) => result.ok) ? 0 : 1);
    } else {
      const manifest = createManifest(args);
      for (const line of summarize(manifest)) console.error(`release-manifest: ${line}`);
      const json = `${JSON.stringify(manifest, null, 2)}\n`;
      if (args.output && !args.dryRun) {
        writeOutput(args.output, json);
        console.error(`release-manifest: wrote ${args.output}`);
      } else {
        process.stdout.write(json);
      }
    }
  } catch (error) {
    console.error(`release-manifest: ERROR: ${(error as Error).message}`);
    process.exit(1);
  }
}
