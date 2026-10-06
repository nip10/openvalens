import { randomBytes, randomUUID } from "node:crypto";
import { access, chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";

const repository = new URL("../", import.meta.url).pathname;
const artifactRoot = "/private/var/folders/8t/tp50trfs7rg_gwkp1pycpmvm0000gn/T/opencode";
const ownershipLabel = "com.openvalens.deployment-smoke.run";

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
`;
}

function help(): void {
  console.log("Usage: bun scripts/deployment-smoke.ts [--help]");
  console.log("Build and exercise production images against a new, isolated Postgres volume.");
  console.log("The smoke test never reads repository .env files or the legacy compose project.");
}

function log(message: string): void {
  console.log(`[deployment-smoke] ${message}`);
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
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

async function runCommand(
  args: string[],
  logPath: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const process = Bun.spawn(args, {
    cwd: options.cwd ?? repository,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const outputPromise = Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs) {
    timer = setTimeout(() => process.kill("SIGTERM"), options.timeoutMs);
  }
  const code = await process.exited;
  if (timer) clearTimeout(timer);
  const [stdout, stderr] = await outputPromise;
  const output = `${stdout}${stderr ? `\n${stderr}` : ""}`;
  await Bun.write(logPath, output);
  await chmod(logPath, 0o600);
  return { code, output: output.trim() };
}

function ensureSuccess(result: CommandResult, operation: string): string {
  if (result.code !== 0)
    throw new Error(`${operation} failed (exit ${result.code}); inspect private logs`);
  return result.output;
}

async function inspectLabels(
  target: string,
  logPath: string,
  resource: "container" | "volume" | "image" = "container",
): Promise<Record<string, string> | null> {
  const result = await runCommand(
    [
      "docker",
      ...(resource === "volume"
        ? ["volume", "inspect", "--format", "{{json .Labels}}"]
        : resource === "image"
          ? ["image", "inspect", "--format", "{{json .Config.Labels}}"]
          : ["inspect", "--format", "{{json .Config.Labels}}"]),
      target,
    ],
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

async function cleanup(
  config: SmokeConfiguration,
  composePath: string,
  artifacts: string,
): Promise<boolean> {
  const logPath = join(artifacts, "cleanup.log");
  const composeBase = ["docker", "compose", "-p", config.project, "-f", composePath];
  const listing = await runCommand([...composeBase, "ps", "-aq"], logPath, { timeoutMs: 15_000 });
  if (listing.code !== 0) {
    log("cleanup skipped: isolated compose project could not be verified");
    return false;
  }

  const containers = listing.output.split(/\s+/).filter(Boolean);
  for (const container of containers) {
    const labels = await inspectLabels(container, logPath);
    if (!labels || !canRemoveSmokeResource(labels, config.project, config.runId)) {
      log("cleanup skipped: a compose container failed ownership verification");
      return false;
    }
  }

  const volumeList = await runCommand(
    [
      "docker",
      "volume",
      "ls",
      "--filter",
      `label=${ownershipLabel}=${config.runId}`,
      "--format",
      "{{.Name}}",
    ],
    logPath,
    { timeoutMs: 15_000 },
  );
  if (volumeList.code !== 0) {
    log("cleanup skipped: isolated volume could not be verified");
    return false;
  }
  const volumes = volumeList.output.split(/\s+/).filter(Boolean);
  for (const volume of volumes) {
    const labels = await inspectLabels(volume, logPath, "volume");
    if (
      !labels ||
      labels[ownershipLabel] !== config.runId ||
      labels["com.docker.compose.project"] !== config.project
    ) {
      log("cleanup skipped: a volume failed ownership verification");
      return false;
    }
  }

  const down = await runCommand([...composeBase, "down", "--timeout", "10"], logPath, {
    timeoutMs: 30_000,
  });
  if (down.code !== 0) {
    log("cleanup incomplete: isolated containers/network need manual review");
    return false;
  }
  for (const volume of volumes) {
    const labels = await inspectLabels(volume, logPath, "volume");
    if (
      labels?.[ownershipLabel] === config.runId &&
      labels["com.docker.compose.project"] === config.project
    ) {
      const removed = await runCommand(["docker", "volume", "rm", volume], logPath, {
        timeoutMs: 15_000,
      });
      if (removed.code !== 0) {
        log("cleanup incomplete: owned smoke volume could not be removed");
        return false;
      }
    }
  }

  return true;
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
      const response = await fetch(root, { signal: AbortSignal.timeout(2_000) });
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
  await Bun.$`mkdir -p ${artifactRoot}`.quiet();
  const artifacts = await mkdtemp(join(artifactRoot, `${project}-`));
  await chmod(artifacts, 0o700);
  const privateDir = join(artifacts, "private");
  await Bun.$`mkdir -p ${privateDir}`.quiet();
  await chmod(privateDir, 0o700);

  const serverPort = await availablePort();
  let webPort = await availablePort();
  while (webPort === serverPort) webPort = await availablePort();
  const apiOrigin = `http://127.0.0.1:${serverPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const postgresPassword = randomBytes(32).toString("hex");
  const config: SmokeConfiguration = {
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
  const composePath = join(artifacts, "compose.yaml");
  const composeBase = ["docker", "compose", "-p", project, "-f", composePath];
  const imageLabel = `${ownershipLabel}=${runId}`;
  const imageIds: string[] = [];
  const password = postgresPassword;
  const envFiles = makeEnvFiles({
    apiOrigin,
    webOrigin,
    databaseUrl: `postgresql://postgres:${password}@db:5432/openhealth`,
    authSecret: randomBytes(48).toString("hex"),
    cronSecret: randomBytes(24).toString("hex"),
    webhookSecret: randomBytes(24).toString("hex"),
    postgresPassword,
  });
  await writePrivateFile(config.serverEnvFile, envFiles.server);
  await writePrivateFile(config.webEnvFile, envFiles.web);
  await writePrivateFile(config.postgresEnvFile, envFiles.postgres);
  await writePrivateFile(composePath, createSmokeComposeConfig(config));

  log(`private artifacts: ${artifacts}`);
  log("building pinned production images with frozen workspace lockfile");
  try {
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
      const labels = await inspectLabels(image, join(artifacts, "image-label-check.log"), "image");
      if (labels?.[ownershipLabel] !== runId || !/^sha256:[0-9a-f]{64}$/.test(imageId)) {
        throw new Error("Built image failed run-ownership verification");
      }
      imageIds.push(`${image} ${imageId}`);
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
    const networkListing = await runCommand(
      [
        "docker",
        "network",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${project}`,
        "--format",
        "{{.Name}}",
      ],
      join(artifacts, "compose-network.log"),
      { timeoutMs: 15_000 },
    );
    const network = networkListing.output.split(/\s+/).filter(Boolean)[0];
    if (networkListing.code !== 0 || !network)
      throw new Error("Could not verify isolated migration network");
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
    const negativeEnvPath = join(privateDir, "placeholder-secrets.env");
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

    const readiness = await fetch(`${apiOrigin}/api-reference/health/readiness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
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

    const webResponse = await fetch(`${webOrigin}/login`, { signal: AbortSignal.timeout(10_000) });
    const html = await webResponse.text();
    if (webResponse.status !== 200 || !html.includes("<html"))
      throw new Error("Web SPA did not return an HTML page");
    const scriptAsset = html.match(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/i)?.[1];
    if (!scriptAsset) throw new Error("Web SPA HTML did not reference a compiled asset");
    const assetResponse = await fetch(new URL(scriptAsset, webOrigin), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!assetResponse.ok) throw new Error("Web compiled asset did not load");
    log("web SPA and compiled asset returned HTTP 200");
    const jsAsset = html.match(/<script\b[^>]*src="([^"]+\.js(?:\?[^"]*)?)"/i)?.[1];
    const cssAsset = html.match(/<link\b[^>]*href="([^"]+\.css(?:\?[^"]*)?)"/i)?.[1];
    if (!jsAsset || !cssAsset) throw new Error("Web /login did not reference JS and CSS assets");
    const [jsResponse, cssResponse] = await Promise.all([
      fetch(new URL(jsAsset, webOrigin), { signal: AbortSignal.timeout(10_000) }),
      fetch(new URL(cssAsset, webOrigin), { signal: AbortSignal.timeout(10_000) }),
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
        composePath,
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

    const allowedCors = await fetch(`${apiOrigin}/api/auth/get-session`, {
      method: "OPTIONS",
      headers: { Origin: webOrigin, "Access-Control-Request-Method": "GET" },
    });
    const allowedOrigin = allowedCors.headers.get("access-control-allow-origin");
    if (allowedOrigin !== webOrigin)
      throw new Error("API CORS did not allow the configured test web origin");
    const forbiddenCors = await fetch(`${apiOrigin}/api/auth/get-session`, {
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
        composePath,
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
    const cleaned = await cleanup(config, composePath, artifacts);
    if (cleaned)
      log("owned smoke containers, network, and volume cleaned up; tagged images retained");
    await rm(privateDir, { recursive: true, force: true });
    log(`private logs retained at ${artifacts}`);
  }
}

if (import.meta.main) {
  if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
    help();
  } else {
    performSmoke().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown deployment smoke failure";
      log(`failed: ${message}`);
      process.exitCode = 1;
    });
  }
}
