import { randomBytes, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const canonicalRepository = realpath(repository);
const ownershipLabel = "com.openvalens.deployment-smoke.run";
const composeProjectLabel = "com.docker.compose.project";
const composeServiceLabel = "com.docker.compose.service";

const activeChildren = new Set<ReturnType<typeof Bun.spawn>>();
let receivedSignal: "SIGINT" | "SIGTERM" | undefined;
let interruptController: AbortController | null = null;
const sensitiveValues = new Set<string>();

export type SmokeResourceKind = "container" | "network" | "volume";

export type SmokeResource = {
  kind: SmokeResourceKind;
  id: string;
  name: string;
  labels: Record<string, string | undefined>;
  service?: string;
  references?: string[];
};

export interface SmokeResourceExecutor {
  list(kind: SmokeResourceKind, project: string, runId: string): Promise<SmokeResource[]>;
  inspect(kind: SmokeResourceKind, id: string): Promise<SmokeResource | null>;
  remove(kind: SmokeResourceKind, id: string): Promise<void>;
}

export function parseSmokeArguments(args: string[]): { help: boolean } {
  if (args.length === 0) return { help: false };
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { help: true };
  }
  throw new Error("Unknown or unsupported smoke-test arguments. Run with --help for usage.");
}

async function canonicalizeCandidate(path: string): Promise<string> {
  let candidate = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      const info = await stat(candidate);
      if (!info.isDirectory()) {
        throw new Error("Smoke artifact path has a non-directory ancestor");
      }
      const canonicalAncestor = await realpath(candidate);
      return resolve(canonicalAncestor, ...suffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw new Error("Could not resolve smoke artifact path");
      suffix.push(candidate.slice(parent.length + (parent.endsWith(parse(parent).root) ? 0 : 1)));
      candidate = parent;
    }
  }
}

function assertOutsideRepository(path: string, repositoryPath: string): void {
  const relativePath = relative(repositoryPath, path);
  if (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  ) {
    throw new Error("Smoke artifacts must be outside the repository and Docker build context");
  }
}

export async function getCanonicalRepositoryRoot(): Promise<string> {
  return canonicalRepository;
}

export async function resolveArtifactRoot(
  override: string | undefined,
  defaultRoot = tmpdir(),
): Promise<string> {
  const selected = override?.trim() || defaultRoot;
  if (!isAbsolute(selected)) {
    throw new Error("OPENVALENS_SMOKE_TMPDIR must be an absolute directory path");
  }
  const [root, repositoryPath] = await Promise.all([
    canonicalizeCandidate(selected),
    canonicalRepository,
  ]);
  assertOutsideRepository(root, repositoryPath);
  if (root === parse(root).root) {
    throw new Error("Smoke artifact directory cannot be a filesystem root");
  }
  return root;
}

export function fetchWithSmokeTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = abortSignal ? AbortSignal.any([timeout, abortSignal]) : timeout;
  return fetch(input, { ...init, signal });
}

function rememberSensitiveEnv(content: string): void {
  for (const line of content.split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (/(?:SECRET|PASSWORD|DATABASE_URL)/.test(key) && value.length > 0) {
      sensitiveValues.add(value);
    }
  }
}

function sanitizeOutput(output: string): string {
  let sanitized = output;
  for (const value of sensitiveValues) {
    sanitized = sanitized.replaceAll(value, "[REDACTED]");
  }
  return sanitized;
}

type SmokeConfiguration = {
  project: string;
  runId: string;
  serverImage: string;
  webImage: string;
  serverEnvFile: string;
  webEnvFile: string;
  postgresEnvFile: string;
  serverPort: number;
  webPort: number;
};

export function createSmokeProjectName(id: string): string {
  const suffix = id
    .replaceAll(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 12);
  if (suffix.length < 8)
    throw new Error("Smoke ID must contain at least eight alphanumeric characters");
  return `ov-smoke-${suffix}`;
}

export function canRemoveSmokeResource(
  labels: Record<string, string | undefined>,
  project: string,
  runId: string,
): boolean {
  return labels["com.docker.compose.project"] === project && labels[ownershipLabel] === runId;
}

export function createSmokeComposeConfig(config: SmokeConfiguration): string {
  const quote = (value: string) => JSON.stringify(value);
  return `services:
  db:
    image: postgres:18
    env_file:
      - ${quote(config.postgresEnvFile)}
    volumes:
      - smoke_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d openhealth"]
      interval: 3s
      timeout: 3s
      retries: 40
    labels:
      ${ownershipLabel}: ${quote(config.runId)}
    restart: "no"
  server:
    image: ${quote(config.serverImage)}
    env_file:
      - ${quote(config.serverEnvFile)}
    depends_on:
      db:
        condition: service_healthy
    ports:
      - ${quote(`127.0.0.1:${config.serverPort}:3000`)}
    labels:
      ${ownershipLabel}: ${quote(config.runId)}
    init: true
    restart: "no"
  web:
    image: ${quote(config.webImage)}
    ports:
      - ${quote(`127.0.0.1:${config.webPort}:80`)}
    labels:
      ${ownershipLabel}: ${quote(config.runId)}
    restart: "no"
volumes:
  smoke_data:
    labels:
      ${ownershipLabel}: ${quote(config.runId)}
networks:
  default:
    labels:
      ${ownershipLabel}: ${quote(config.runId)}
`;
}

function help(): void {
  console.log("Usage: bun scripts/deployment-smoke.ts [--help]");
  console.log("Build and exercise production images against a new, isolated Postgres volume.");
  console.log("The smoke test never reads repository .env files or the legacy compose project.");
  console.log(
    "Set OPENVALENS_SMOKE_TMPDIR to choose an absolute private artifact parent directory.",
  );
}

function log(message: string): void {
  console.log(`[deployment-smoke] ${message}`);
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  assertNotInterrupted();
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
  assertNotInterrupted();
}

function assertNotInterrupted(): void {
  if (receivedSignal) throw new Error("Deployment smoke interrupted");
}

function smokeFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10_000) {
  return fetchWithSmokeTimeout(input, init, timeoutMs, interruptController?.signal);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve a local test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

type CommandResult = { code: number; output: string };

function signalChildProcess(child: ReturnType<typeof Bun.spawn>, signal: "SIGTERM" | "SIGKILL") {
  try {
    process.kill(child.pid, signal);
  } catch {
    // A child can exit between inventory and the signal attempt.
  }
}

async function runCommand(
  args: string[],
  logPath: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    allowDuringShutdown?: boolean;
  } = {},
): Promise<CommandResult> {
  if (!options.allowDuringShutdown) assertNotInterrupted();
  const child = Bun.spawn(args, {
    cwd: options.cwd ?? repository,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  activeChildren.add(child);
  const outputPromise = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) {
    timer = setTimeout(() => {
      signalChildProcess(child, "SIGTERM");
      killTimer = setTimeout(() => signalChildProcess(child, "SIGKILL"), 1_000);
    }, options.timeoutMs);
  }
  try {
    const code = await child.exited;
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    const [stdout, stderr] = await outputPromise;
    const output = sanitizeOutput(`${stdout}${stderr ? `\n${stderr}` : ""}`);
    await writeFile(logPath, output, { mode: 0o600 });
    await chmod(logPath, 0o600);
    if (!options.allowDuringShutdown) assertNotInterrupted();
    return { code, output: output.trim() };
  } finally {
    if (timer) clearTimeout(timer);
    activeChildren.delete(child);
  }
}

function ensureSuccess(result: CommandResult, operation: string): string {
  if (result.code !== 0)
    throw new Error(`${operation} failed (exit ${result.code}); inspect private logs`);
  return result.output;
}

function expectedResourceName(kind: SmokeResourceKind, project: string): string[] {
  if (kind === "container") {
    return [`${project}-db-1`, `${project}-server-1`, `${project}-web-1`, `${project}-migration`];
  }
  return [kind === "network" ? `${project}_default` : `${project}_smoke_data`];
}

function isCandidateResource(resource: SmokeResource, project: string, runId: string): boolean {
  return (
    resource.labels[composeProjectLabel] === project ||
    resource.labels[ownershipLabel] === runId ||
    expectedResourceName(resource.kind, project).includes(resource.name)
  );
}

function isExpectedOwnedResource(resource: SmokeResource, project: string, runId: string): boolean {
  const correctLabels =
    resource.labels[composeProjectLabel] === project && resource.labels[ownershipLabel] === runId;
  if (!correctLabels) return false;
  if (resource.kind === "network") return resource.name === `${project}_default`;
  if (resource.kind === "volume") return resource.name === `${project}_smoke_data`;
  const services = new Map([
    [`${project}-db-1`, "db"],
    [`${project}-server-1`, "server"],
    [`${project}-web-1`, "web"],
    [`${project}-migration`, "migration"],
  ]);
  return services.get(resource.name) === resource.service;
}

function ensureValidCandidateSet(resources: SmokeResource[], project: string, runId: string): void {
  for (const kind of ["container", "network", "volume"] as const) {
    const seenNames = new Set<string>();
    for (const resource of resources.filter((item) => item.kind === kind)) {
      if (!isExpectedOwnedResource(resource, project, runId)) {
        throw new Error("Docker resource ownership verification failed");
      }
      if (seenNames.has(resource.name)) {
        throw new Error("Docker resource identity was duplicated");
      }
      seenNames.add(resource.name);
    }
  }
}

export async function preflightSmokeResources(
  executor: SmokeResourceExecutor,
  project: string,
  runId: string,
): Promise<void> {
  const inventories: SmokeResource[][] = [];
  for (const kind of ["container", "network", "volume"] as const) {
    inventories.push(await executor.list(kind, project, runId));
  }
  const candidates = inventories
    .flat()
    .filter((resource) => isCandidateResource(resource, project, runId));
  if (candidates.length > 0) {
    throw new Error("Smoke project resource collision detected; refusing to start");
  }
}

export async function getOwnedSmokeNetworkName(
  executor: SmokeResourceExecutor,
  project: string,
  runId: string,
): Promise<string> {
  const resources = (await executor.list("network", project, runId)).filter((resource) =>
    isCandidateResource(resource, project, runId),
  );
  ensureValidCandidateSet(resources, project, runId);
  if (resources.length !== 1 || resources[0]?.name !== `${project}_default`) {
    throw new Error("Expected exactly one run-owned smoke network");
  }
  return resources[0].name;
}

export async function cleanupOwnedSmokeResources(
  executor: SmokeResourceExecutor,
  project: string,
  runId: string,
): Promise<boolean> {
  try {
    const inventories: SmokeResource[][] = [];
    for (const kind of ["container", "network", "volume"] as const) {
      inventories.push(await executor.list(kind, project, runId));
    }
    const candidates = inventories
      .flat()
      .filter((resource) => isCandidateResource(resource, project, runId));
    ensureValidCandidateSet(candidates, project, runId);

    const containers = candidates
      .filter((resource) => resource.kind === "container")
      .sort((left, right) => {
        const order = ["web", "server", "db"];
        return order.indexOf(left.service ?? "") - order.indexOf(right.service ?? "");
      });
    const networks = candidates.filter((resource) => resource.kind === "network");
    const volumes = candidates.filter((resource) => resource.kind === "volume");

    for (const expected of containers) {
      const current = await executor.inspect("container", expected.id);
      if (current === null) continue;
      if (current.id !== expected.id || !isExpectedOwnedResource(current, project, runId)) {
        throw new Error("Container changed ownership before cleanup");
      }
      await executor.remove("container", current.id);
    }
    for (const expected of networks) {
      const current = await executor.inspect("network", expected.id);
      if (current === null) continue;
      if (
        current.id !== expected.id ||
        !isExpectedOwnedResource(current, project, runId) ||
        (current.references?.length ?? 0) > 0
      ) {
        throw new Error("Network changed ownership or remains attached before cleanup");
      }
      await executor.remove("network", current.id);
    }
    for (const expected of volumes) {
      const current = await executor.inspect("volume", expected.id);
      if (current === null) continue;
      if (current.id !== expected.id || !isExpectedOwnedResource(current, project, runId)) {
        throw new Error("Volume changed ownership before cleanup");
      }
      await executor.remove("volume", current.id);
    }
    return true;
  } catch {
    return false;
  }
}

export class DockerSmokeResourceExecutor implements SmokeResourceExecutor {
  private logIndex = 0;
  private readonly shutdownDeadline: number;

  constructor(
    private readonly artifacts: string,
    private readonly allowDuringShutdown: boolean,
    private readonly dockerExecutable = "docker",
  ) {
    this.shutdownDeadline = allowDuringShutdown ? Date.now() + 60_000 : Number.POSITIVE_INFINITY;
  }

  private async command(args: string[], label: string): Promise<CommandResult> {
    const remaining = this.shutdownDeadline - Date.now();
    if (remaining <= 0) throw new Error("Docker cleanup time budget exhausted");
    const result = await runCommand(
      args,
      join(
        this.artifacts,
        `${this.allowDuringShutdown ? "cleanup" : "preflight"}-${++this.logIndex}-${label}.log`,
      ),
      {
        timeoutMs: Math.min(10_000, remaining),
        allowDuringShutdown: this.allowDuringShutdown,
      },
    );
    if (result.code !== 0) throw new Error("Docker command failed; inspect private logs");
    return result;
  }

  async list(kind: SmokeResourceKind, project: string, runId: string): Promise<SmokeResource[]> {
    const [cli, baseArgs] =
      kind === "container"
        ? ["container", ["ls", "-aq"]]
        : kind === "network"
          ? ["network", ["ls", "-q"]]
          : ["volume", ["ls", "-q"]];
    const filters = [
      `name=${project}`,
      `label=${composeProjectLabel}=${project}`,
      `label=${ownershipLabel}=${runId}`,
    ];
    const ids = new Set<string>();
    for (const [index, filter] of filters.entries()) {
      const result = await this.command(
        [this.dockerExecutable, cli, ...baseArgs, "--filter", filter],
        `${kind}-list-${index}`,
      );
      for (const id of result.output.split(/\s+/).filter(Boolean)) ids.add(id);
    }
    const resources: SmokeResource[] = [];
    for (const id of ids) {
      const inspected = await this.inspect(kind, id);
      if (inspected) resources.push(inspected);
    }
    return resources;
  }

  async inspect(kind: SmokeResourceKind, id: string): Promise<SmokeResource | null> {
    const format =
      kind === "container"
        ? [
            "{{json .Id}}",
            "{{json .Name}}",
            `{{json (index .Config.Labels "${composeProjectLabel}")}}`,
            `{{json (index .Config.Labels "${ownershipLabel}")}}`,
            `{{json (index .Config.Labels "${composeServiceLabel}")}}`,
          ].join("\n")
        : kind === "network"
          ? [
              "{{json .Id}}",
              "{{json .Name}}",
              `{{json (index .Labels "${composeProjectLabel}")}}`,
              `{{json (index .Labels "${ownershipLabel}")}}`,
              '{{range $id, $attachment := .Containers}}{{json $id}}{{"\\n"}}{{end}}',
            ].join("\n")
          : [
              "{{json .Name}}",
              `{{json (index .Labels "${composeProjectLabel}")}}`,
              `{{json (index .Labels "${ownershipLabel}")}}`,
            ].join("\n");
    const args =
      kind === "container"
        ? [this.dockerExecutable, "inspect", "--type", "container", "--format", format, id]
        : [this.dockerExecutable, kind, "inspect", "--format", format, id];
    const remaining = this.shutdownDeadline - Date.now();
    if (remaining <= 0) throw new Error("Docker cleanup time budget exhausted");
    const result = await runCommand(
      args,
      join(
        this.artifacts,
        `${this.allowDuringShutdown ? "cleanup" : "preflight"}-${++this.logIndex}-${kind}-inspect.log`,
      ),
      {
        timeoutMs: Math.min(10_000, remaining),
        allowDuringShutdown: this.allowDuringShutdown,
      },
    );
    if (result.code !== 0) {
      const message = result.output.toLowerCase();
      const knownGone =
        (kind === "container" &&
          (message.includes("no such object") || message.includes("no such container"))) ||
        (kind === "network" &&
          (message.includes("no such network") ||
            (message.includes("network") && message.includes("not found")))) ||
        (kind === "volume" &&
          (message.includes("no such volume") ||
            (message.includes("volume") && message.includes("not found"))));
      if (knownGone) return null;
      throw new Error("Docker resource inspection failed; inspect private logs");
    }
    try {
      const fields = result.output.split("\n").map((field) => JSON.parse(field) as unknown);
      if (fields.length < (kind === "container" ? 5 : kind === "network" ? 4 : 3)) {
        throw new Error("Docker returned incomplete resource metadata");
      }
      const labelValue = (field: unknown) => (typeof field === "string" ? field : undefined);
      const labels: Record<string, string | undefined> =
        kind === "container"
          ? {
              [composeProjectLabel]: labelValue(fields[2]),
              [ownershipLabel]: labelValue(fields[3]),
              [composeServiceLabel]: labelValue(fields[4]),
            }
          : kind === "network"
            ? {
                [composeProjectLabel]: labelValue(fields[2]),
                [ownershipLabel]: labelValue(fields[3]),
              }
            : {
                [composeProjectLabel]: labelValue(fields[1]),
                [ownershipLabel]: labelValue(fields[2]),
              };
      const name = String(fields[kind === "volume" ? 0 : 1] ?? "").replace(/^\/+/, "");
      const rawId = kind === "volume" ? name : String(fields[0] ?? "");
      if (!rawId || !name) throw new Error("Docker resource identity is incomplete");
      const service = kind === "container" ? labelValue(fields[4]) : undefined;
      return {
        kind,
        id: rawId,
        name,
        labels,
        service,
        references: kind === "network" ? fields.slice(4).map(String) : undefined,
      };
    } catch {
      throw new Error("Docker returned malformed resource metadata");
    }
  }

  async remove(kind: SmokeResourceKind, id: string): Promise<void> {
    const args =
      kind === "container"
        ? [this.dockerExecutable, "container", "rm", "--force", id]
        : [this.dockerExecutable, kind, "rm", id];
    await this.command(args, `${kind}-remove`);
  }
}

export async function cleanupAndRemoveFixtures(
  cleanupResources: () => Promise<unknown>,
  removeFixtures: () => Promise<void>,
): Promise<void> {
  try {
    await cleanupResources();
  } finally {
    await removeFixtures();
  }
}

export async function writePrivateFixtures(
  directory: string,
  files: Record<string, string>,
  writer: (path: string, content: string) => Promise<void> = writePrivateFile,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writer(join(directory, name), content);
  }
}

export async function removePrivateFixtures(directory: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(100 * (attempt + 1));
    }
  }
  void lastError;
  throw new Error("Private fixture removal failed");
}

async function inspectImageLabels(
  target: string,
  logPath: string,
): Promise<Record<string, string> | null> {
  const result = await runCommand(
    ["docker", "image", "inspect", "--format", "{{json .Config.Labels}}", target],
    logPath,
    { timeoutMs: 15_000 },
  );
  if (result.code !== 0) return null;
  try {
    return JSON.parse(result.output) as Record<string, string>;
  } catch {
    return null;
  }
}

async function countTrackedMigrations(): Promise<number> {
  const directory = join(repository, "packages/db/src/migrations");
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await access(join(directory, entry.name, "migration.sql"));
      count += 1;
    } catch {
      // Only migration directories with the tracked SQL payload count.
    }
  }
  return count;
}

function makeEnvFiles(config: {
  apiOrigin: string;
  webOrigin: string;
  databaseUrl: string;
  authSecret: string;
  cronSecret: string;
  webhookSecret: string;
  postgresPassword: string;
}): { server: string; web: string; postgres: string } {
  const server = [
    "NODE_ENV=production",
    `BETTER_AUTH_SECRET=${config.authSecret}`,
    `BETTER_AUTH_URL=${config.apiOrigin}`,
    `CORS_ORIGIN=${config.webOrigin}`,
    `DATABASE_URL=${config.databaseUrl}`,
    `CRON_SECRET=${config.cronSecret}`,
    "EMAIL_FROM=Smoke Test <smoke@example.invalid>",
    "EMAIL_DRY_RUN=true",
    "AUTH_DEV_MAGIC_LINK_CONSOLE=false",
    `TELEGRAM_WEBHOOK_SECRET=${config.webhookSecret}`,
    "TELEGRAM_CONNECT_TOKEN_TTL_SECONDS=600",
    "TELEGRAM_API_BASE_URL=https://api.telegram.org",
    "AI_MODEL=claude-sonnet-5-5",
    "AI_RATE_LIMIT_PER_MINUTE=20",
  ].join("\n");
  const web = `NODE_ENV=production\nVITE_SERVER_URL=${config.apiOrigin}\n`;
  const postgres = `POSTGRES_DB=openhealth\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD=${config.postgresPassword}\n`;
  return { server: `${server}\n`, web, postgres };
}

async function assertProductionGuard(
  container: string,
  compose: string[],
  artifacts: string,
): Promise<void> {
  const root = `http://127.0.0.1:${container}`;
  let lastStatus = "unavailable";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await smokeFetch(root, {}, 2_000);
      lastStatus = String(response.status);
      if (response.status === 200 && (await response.text()) === "OK") return;
    } catch {
      // The API may still be starting; retain no response body or environment values.
    }
    await Bun.sleep(1_000);
  }
  await runCommand(compose, join(artifacts, "server-wait.log"), { timeoutMs: 15_000 });
  throw new Error(`API liveness did not become ready (last HTTP status: ${lastStatus})`);
}

async function performSmoke(): Promise<void> {
  const runId = randomUUID();
  const project = createSmokeProjectName(runId);
  let artifacts: string | undefined;
  let privateDir: string | undefined;
  let config: SmokeConfiguration | undefined;
  let rootExecutor: DockerSmokeResourceExecutor | undefined;
  let imagesRetained = false;
  try {
    const configuredArtifactRoot = await resolveArtifactRoot(process.env.OPENVALENS_SMOKE_TMPDIR);
    await mkdir(configuredArtifactRoot, { recursive: true, mode: 0o700 });
    const artifactRoot = await resolveArtifactRoot(await realpath(configuredArtifactRoot));
    artifacts = await realpath(await mkdtemp(join(artifactRoot, `${project}-`)));
    await resolveArtifactRoot(artifacts);
    await chmod(artifacts, 0o700);
    privateDir = join(artifacts, "private");
    await mkdir(privateDir, { mode: 0o700 });
    await chmod(privateDir, 0o700);

    rootExecutor = new DockerSmokeResourceExecutor(artifacts, false);
    await preflightSmokeResources(rootExecutor, project, runId);

    const serverPort = await availablePort();
    let webPort = await availablePort();
    while (webPort === serverPort) webPort = await availablePort();
    const apiOrigin = `http://127.0.0.1:${serverPort}`;
    const webOrigin = `http://127.0.0.1:${webPort}`;
    const postgresPassword = randomBytes(32).toString("hex");
    config = {
      project,
      runId,
      serverImage: `openvalens-smoke-server:${runId.slice(0, 12)}`,
      webImage: `openvalens-smoke-web:${runId.slice(0, 12)}`,
      serverEnvFile: join(privateDir, "server.env"),
      webEnvFile: join(privateDir, "web.env"),
      postgresEnvFile: join(privateDir, "postgres.env"),
      serverPort,
      webPort,
    };
    const smokeConfig = config;
    const smokeComposePath = join(privateDir, "compose.yaml");
    const composeBase = ["docker", "compose", "-p", project, "-f", smokeComposePath];
    const imageLabel = `${ownershipLabel}=${runId}`;
    const imageIds: string[] = [];
    const password = postgresPassword;
    await resolveArtifactRoot(artifacts);
    const envFiles = makeEnvFiles({
      apiOrigin,
      webOrigin,
      databaseUrl: `postgresql://postgres:${password}@db:5432/openhealth`,
      authSecret: randomBytes(48).toString("hex"),
      cronSecret: randomBytes(24).toString("hex"),
      webhookSecret: randomBytes(24).toString("hex"),
      postgresPassword,
    });
    rememberSensitiveEnv(envFiles.server);
    rememberSensitiveEnv(envFiles.postgres);
    await writePrivateFixtures(privateDir, {
      "server.env": envFiles.server,
      "web.env": envFiles.web,
      "postgres.env": envFiles.postgres,
      "compose.yaml": createSmokeComposeConfig(smokeConfig),
    });

    log("private logs retained under the selected smoke artifact directory");
    log("building pinned production images with frozen workspace lockfile");
    const buildDeadline = Date.now() + 20 * 60 * 1000;
    for (const [image, dockerfile, secretArgs] of [
      [config.serverImage, "apps/server/Dockerfile", []],
      [config.webImage, "apps/web/Dockerfile", ["--build-arg", `VITE_SERVER_URL=${apiOrigin}`]],
    ] as const) {
      const remainingBuildMs = buildDeadline - Date.now();
      if (remainingBuildMs <= 0)
        throw new Error("Combined production image build exceeded its 20-minute budget");
      const build = await runCommand(
        [
          "docker",
          "build",
          "--progress=plain",
          "--label",
          imageLabel,
          "--secret",
          `id=server_env,src=${config.serverEnvFile}`,
          "--secret",
          `id=web_env,src=${config.webEnvFile}`,
          ...secretArgs,
          "-f",
          dockerfile,
          "-t",
          image,
          ".",
        ],
        join(artifacts, `${image.includes("server") ? "server" : "web"}-build.log`),
        { timeoutMs: remainingBuildMs },
      );
      ensureSuccess(build, `${image.includes("server") ? "server" : "web"} image build`);
      const imageInfo = await runCommand(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image],
        join(artifacts, `${image.includes("server") ? "server" : "web"}-image-id.log`),
        { timeoutMs: 15_000 },
      );
      const imageId = ensureSuccess(imageInfo, "built image inspection").trim();
      const labels = await inspectImageLabels(image, join(artifacts, "image-label-check.log"));
      if (labels?.[ownershipLabel] !== runId || !/^sha256:[0-9a-f]{64}$/.test(imageId)) {
        throw new Error("Built image failed run-ownership verification");
      }
      imageIds.push(`${image} ${imageId}`);
      imagesRetained = true;
      await writePrivateFile(join(artifacts, "images.txt"), `${imageIds.join("\n")}\n`);
      log(`retained image ${image} (${imageId})`);
      log(`${image.includes("server") ? "server" : "web"} image build passed`);
    }

    log("starting isolated PostgreSQL 18 only");
    const up = await runCommand(
      [...composeBase, "up", "-d", "--wait", "--wait-timeout", "120", "db"],
      join(artifacts, "compose-up.log"),
      {
        timeoutMs: 4 * 60 * 1000,
      },
    );
    ensureSuccess(up, "isolated compose startup");

    // Run the package's direct Drizzle script, avoiding the root's interactive Turbo task.
    // The generated database is reachable only over this isolated network.
    const network = await getOwnedSmokeNetworkName(rootExecutor, project, runId);
    const migrated = await runCommand(
      [
        "docker",
        "run",
        "--rm",
        "--network",
        network,
        "--env-file",
        config.serverEnvFile,
        "--label",
        imageLabel,
        "--label",
        `${composeProjectLabel}=${project}`,
        "--label",
        `${composeServiceLabel}=migration`,
        "--name",
        `${project}-migration`,
        "--workdir",
        "/app/packages/db",
        config.serverImage,
        "bun",
        "run",
        "db:migrate",
      ],
      join(artifacts, "migration.log"),
      { timeoutMs: 5 * 60 * 1000 },
    );
    ensureSuccess(migrated, "tracked database migrations");
    log("tracked database migrations passed");

    // Confirm a migration journal exists and is populated without exposing database data.
    const journalLookup = await runCommand(
      [
        ...composeBase,
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "openhealth",
        "-Atqc",
        "SELECT schemaname FROM pg_tables WHERE tablename = '__drizzle_migrations' LIMIT 1",
      ],
      join(artifacts, "migration-proof.log"),
      { timeoutMs: 15_000 },
    );
    const migrationSchema = ensureSuccess(journalLookup, "migration journal lookup").trim();
    if (!/^[a-z_][a-z0-9_]*$/.test(migrationSchema))
      throw new Error("Tracked migration journal was not found");
    const journalCount = await runCommand(
      [
        ...composeBase,
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "openhealth",
        "-Atqc",
        `SELECT count(*) FROM "${migrationSchema}"."__drizzle_migrations"`,
      ],
      join(artifacts, "migration-proof-count.log"),
      { timeoutMs: 15_000 },
    );
    const countText = ensureSuccess(journalCount, "migration journal count").trim();
    const migrationCount = Number(countText);
    if (!Number.isInteger(migrationCount) || migrationCount < 1)
      throw new Error("No tracked migrations recorded in isolated test database");
    const trackedMigrationCount = await countTrackedMigrations();
    if (migrationCount !== trackedMigrationCount) {
      throw new Error(
        `Migration journal count did not match tracked migration files (${migrationCount} vs ${trackedMigrationCount})`,
      );
    }
    log(`migration journal contains ${migrationCount} applied migrations`);

    const appsUp = await runCommand(
      [...composeBase, "up", "-d", "server", "web"],
      join(artifacts, "compose-apps-up.log"),
      {
        timeoutMs: 4 * 60 * 1000,
      },
    );
    ensureSuccess(appsUp, "isolated application startup");

    const placeholderAuth = "changeme".repeat(4);
    const placeholderCron = "password".repeat(4);
    const negativeEnv = envFiles.server
      .replace(/BETTER_AUTH_SECRET=[^\n]*/, `BETTER_AUTH_SECRET=${placeholderAuth}`)
      .replace(/CRON_SECRET=[^\n]*/, `CRON_SECRET=${placeholderCron}`);
    const negativeEnvPath = join(privateDir as string, "placeholder-secrets.env");
    rememberSensitiveEnv(negativeEnv);
    await writePrivateFile(negativeEnvPath, negativeEnv);
    const negativeGuard = await runCommand(
      [
        "docker",
        "run",
        "--rm",
        "--env-file",
        negativeEnvPath,
        "--workdir",
        "/app/apps/server",
        "--entrypoint",
        "bun",
        config.serverImage,
        "-e",
        "import './src/env.server.ts'",
      ],
      join(artifacts, "production-placeholder-guard.log"),
      { timeoutMs: 30_000 },
    );
    if (
      negativeGuard.code === 0 ||
      !negativeGuard.output.includes("BETTER_AUTH_SECRET") ||
      !negativeGuard.output.includes("CRON_SECRET") ||
      negativeGuard.output.includes(placeholderAuth) ||
      negativeGuard.output.includes(placeholderCron)
    ) {
      throw new Error(
        "Production placeholder guard did not reject test values without printing them",
      );
    }
    log(
      "production placeholder-secret guard rejected both generated invalid values without echoing them",
    );

    await assertProductionGuard(
      String(serverPort),
      [...composeBase, "logs", "--no-color", "server"],
      artifacts,
    );
    log("API GET / returned HTTP 200");

    const uidResult = await runCommand(
      [
        ...composeBase,
        "exec",
        "-T",
        "server",
        "bun",
        "-e",
        "process.stdout.write(String(process.getuid()))",
      ],
      join(artifacts, "server-uid.log"),
      { timeoutMs: 15_000 },
    );
    const serverUid = Number(ensureSuccess(uidResult, "server runtime UID check"));
    if (!Number.isInteger(serverUid) || serverUid < 1) {
      throw new Error("Server did not run under a non-root UID");
    }
    log(`server runtime UID is non-root (${serverUid})`);

    const readiness = await smokeFetch(`${apiOrigin}/api-reference/health/readiness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const readinessBody = (await readiness.json()) as {
      status?: string;
      checks?: { database?: string; secrets?: Record<string, string> };
    };
    if (
      readiness.status !== 200 ||
      readinessBody.status !== "ok" ||
      readinessBody.checks?.database !== "ok" ||
      readinessBody.checks?.secrets?.betterAuthSecret !== "ok" ||
      readinessBody.checks?.secrets?.cronSecret !== "ok"
    ) {
      throw new Error("Readiness endpoint did not report healthy DB and required secrets");
    }
    log("readiness POST passed with database and required secret checks OK");

    const webResponse = await smokeFetch(`${webOrigin}/login`);
    const html = await webResponse.text();
    if (webResponse.status !== 200 || !html.includes("<html"))
      throw new Error("Web SPA did not return an HTML page");
    const scriptAsset = html.match(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/i)?.[1];
    if (!scriptAsset) throw new Error("Web SPA HTML did not reference a compiled asset");
    const assetResponse = await smokeFetch(new URL(scriptAsset, webOrigin));
    if (!assetResponse.ok) throw new Error("Web compiled asset did not load");
    log("web SPA and compiled asset returned HTTP 200");
    const jsAsset = html.match(/<script\b[^>]*src="([^"]+\.js(?:\?[^"]*)?)"/i)?.[1];
    const cssAsset = html.match(/<link\b[^>]*href="([^"]+\.css(?:\?[^"]*)?)"/i)?.[1];
    if (!jsAsset || !cssAsset) throw new Error("Web /login did not reference JS and CSS assets");
    const [jsResponse, cssResponse] = await Promise.all([
      smokeFetch(new URL(jsAsset, webOrigin)),
      smokeFetch(new URL(cssAsset, webOrigin)),
    ]);
    if (!jsResponse.ok || !cssResponse.ok)
      throw new Error("Web JavaScript or CSS asset did not load");
    const configuredOrigin = await runCommand(
      [
        "docker",
        "compose",
        "-p",
        project,
        "-f",
        smokeComposePath,
        "exec",
        "-T",
        "web",
        "sh",
        "-c",
        'for file in /usr/share/nginx/html/assets/*.js; do grep -Fq "$1" "$file" && { echo found; exit 0; }; done; exit 1',
        "smoke-check",
        apiOrigin,
      ],
      join(artifacts, "compiled-api-origin-check.log"),
      { timeoutMs: 15_000 },
    );
    ensureSuccess(configuredOrigin, "compiled web API origin check");
    log("web JS/CSS served and bundle contains the compiled API origin");

    const allowedCors = await smokeFetch(`${apiOrigin}/api/auth/get-session`, {
      method: "OPTIONS",
      headers: { Origin: webOrigin, "Access-Control-Request-Method": "GET" },
    });
    const allowedOrigin = allowedCors.headers.get("access-control-allow-origin");
    if (allowedOrigin !== webOrigin)
      throw new Error("API CORS did not allow the configured test web origin");
    const forbiddenCors = await smokeFetch(`${apiOrigin}/api/auth/get-session`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://not-the-smoke-origin.invalid",
        "Access-Control-Request-Method": "GET",
      },
    });
    if (forbiddenCors.headers.get("access-control-allow-origin"))
      throw new Error("API CORS allowed an unrelated origin");
    log("CORS allowed only the configured web origin in tested preflight requests");

    const secretFiles = await runCommand(
      [
        "docker",
        "compose",
        "-p",
        project,
        "-f",
        smokeComposePath,
        "exec",
        "-T",
        "server",
        "bun",
        "-e",
        "const fs=require('node:fs');for(const p of ['/app/apps/server/.env.local','/app/apps/web/.env.local','/app/apps/server/.env','/app/apps/web/.env'])if(fs.existsSync(p))process.exit(2)",
      ],
      join(artifacts, "secret-file-check.log"),
      { timeoutMs: 15_000 },
    );
    ensureSuccess(secretFiles, "runtime secret-file absence check");
    log("runtime API image contains no mounted/copied .env value files");
    log(
      "synthetic fixture had no Resend/AI/Telegram credentials; external integrations were not exercised",
    );
  } finally {
    if (artifacts) {
      const cleanupExecutor = new DockerSmokeResourceExecutor(artifacts, true);
      try {
        await cleanupAndRemoveFixtures(
          async () => {
            try {
              if (config) {
                let cleaned = false;
                const cleanupAttempts = receivedSignal ? 3 : 1;
                for (let attempt = 0; attempt < cleanupAttempts; attempt += 1) {
                  cleaned = await cleanupOwnedSmokeResources(cleanupExecutor, project, runId);
                  if (cleaned) break;
                  if (attempt + 1 < cleanupAttempts) await Bun.sleep(300);
                }
                if (!cleaned) {
                  log("cleanup incomplete: owned resources could not be safely removed");
                } else {
                  log("verified owned smoke containers, network, and volume cleaned up");
                }
              }
            } catch {
              log("cleanup incomplete: inspect private artifact logs for owned resource details");
            }
          },
          async () => {
            if (privateDir) {
              await removePrivateFixtures(privateDir);
              log("synthetic environment fixtures removed");
            }
          },
        );
      } catch {
        if (privateDir) {
          log("fixture removal failed; private artifact directory requires manual cleanup");
        }
      } finally {
        log(
          imagesRetained
            ? "run-owned image tags retained for audit"
            : "no run-owned image retained",
        );
        log("private logs retained under the selected smoke artifact directory");
      }
    }
  }
}

if (import.meta.main) {
  let shuttingDown = false;
  const handleSignal = (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    receivedSignal = signal;
    log(`received ${signal}; stopping ${activeChildren.size} owned child command(s)`);
    if (interruptController) interruptController.abort();
    for (const child of activeChildren) {
      signalChildProcess(child, "SIGTERM");
      setTimeout(() => signalChildProcess(child, "SIGKILL"), 2_000).unref?.();
    }
  };
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  try {
    const parsed = parseSmokeArguments(Bun.argv.slice(2));
    if (parsed.help) help();
    else {
      interruptController = new AbortController();
      performSmoke().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown deployment smoke failure";
        log(
          receivedSignal
            ? "failed: interrupted; owned-resource cleanup attempted"
            : `failed: ${message}`,
        );
        process.exitCode = 1;
      });
    }
  } catch {
    log("Invalid smoke-test arguments or temporary directory configuration. Run --help for usage.");
    process.exitCode = 2;
  }
}
