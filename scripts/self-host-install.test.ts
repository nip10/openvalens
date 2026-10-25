/**
 * Static and dry-run checks for the production self-host install (Issue #63):
 * `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/setup.sh` and the
 * pre-migrate backup hook. Nothing here starts containers or touches a
 * database; the live install/upgrade/failed-migration evidence is in the PR.
 */
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FILE_SECRET_KEYS } from "@openvalens/config/file-secrets";

import { CSP_REPORT_PATH } from "../apps/server/src/security-csp-report";

const repo = join(import.meta.dir, "..");
const deploy = join(repo, "deploy");

type Service = {
  image?: string;
  ports?: unknown[];
  networks?: string[];
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition: string }>;
  restart?: string;
  volumes?: string[];
  build?: unknown;
  profiles?: string[];
  entrypoint?: string[];
  command?: string[];
};
type Compose = {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean } | null>;
};

const compose = Bun.YAML.parse(await Bun.file(join(deploy, "compose.yml")).text()) as Compose;
const services = compose.services;

/** Server keys that are secrets and must only ever arrive via `<KEY>_FILE`. */
const SECRET_KEYS = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "CRON_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "POSTGRES_PASSWORD",
  "AI_API_KEY",
  "EMAIL_AUDIT_BCC",
  "STORAGE_S3_ACCESS_KEY_ID",
  "STORAGE_S3_SECRET_ACCESS_KEY",
  "OIDC_CLIENT_SECRET",
  "WEARABLES_OURA_CLIENT_SECRET",
  "WEARABLES_WHOOP_CLIENT_SECRET",
  "WEARABLES_POLAR_CLIENT_SECRET",
  "WEARABLES_POLAR_WEBHOOK_SECRET",
  "WEARABLES_WITHINGS_CLIENT_SECRET",
  "WEARABLES_GOOGLE_HEALTH_CLIENT_SECRET",
  "POSTHOG_PROJECT_TOKEN",
];

/** `KEY=default` assignments of `apps/server/.env.schema`, in schema order. */
const serverSchema = new Map(
  [
    ...readFileSync(join(repo, "apps", "server", ".env.schema"), "utf8").matchAll(
      /^([A-Z][A-Z0-9_]*)=(.*)$/gm,
    ),
  ].map((match) => [match[1]!, match[2]!] as const),
);

/**
 * Server keys `deploy/compose.yml` deliberately does not pass through, and why.
 * Every other schema key must reach the server, so a new key cannot be added
 * without deciding whether self-hosters may set it.
 */
const NOT_PASSED_THROUGH: Record<string, string> = {
  AUTH_DEV_MAGIC_LINK_CONSOLE: "development only; ignored unless NODE_ENV=development",
  TELEGRAM_API_BASE_URL: "local-testing override of the Telegram Bot API",
};

/** Server keys the stack sets itself instead of reading them from deploy/.env. */
const SET_BY_STACK = new Set([
  "NODE_ENV",
  "BETTER_AUTH_URL",
  "CORS_ORIGIN",
  "STORAGE_LOCAL_DIR",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "CRON_SECRET",
  "TELEGRAM_WEBHOOK_SECRET",
]);

/**
 * Compose fallbacks (`${KEY:-fallback}`) that intentionally differ from the
 * schema default: the stack is production-only.
 */
const COMPOSE_DEFAULT_OVERRIDES: Record<string, string> = {
  // Same as the server's own production default; set explicitly so `web` agrees.
  CSP_MODE: "enforce",
  EMAIL_DRY_RUN: "false",
};

describe("deploy/compose.yml", () => {
  test("only caddy publishes ports", () => {
    const publishers = Object.entries(services)
      .filter(([, service]) => service.ports !== undefined)
      .map(([name]) => name);
    expect(publishers).toEqual(["caddy"]);
  });

  test("postgres is reachable only on the internal db network", () => {
    expect(compose.networks.db?.internal).toBe(true);
    expect(services.postgres!.networks).toEqual(["db"]);
    expect(services.web!.networks).not.toContain("db");
    expect(services.caddy!.networks).not.toContain("db");
  });

  test("third-party images are pinned by version and digest; app images by version", () => {
    for (const name of ["caddy", "postgres"]) {
      expect(services[name]!.image).toMatch(/^[a-z]+:\d+\.\d+(\.\d+)?@sha256:[0-9a-f]{64}$/);
    }
    for (const name of ["server", "migrate", "web"]) {
      expect(services[name]!.image).toMatch(/:\$\{OPENVALENS_VERSION:\?/);
    }
    // Issue #64 — the backup image is built locally FROM the exact pinned
    // Postgres image the stack runs, so pg_dump always matches the server.
    const dockerfile = readFileSync(join(deploy, "backup", "Dockerfile"), "utf8");
    expect(/^FROM (\S+)$/m.exec(dockerfile)?.[1]).toBe(services.postgres!.image!);
    for (const name of ["backup", "backup-scheduler", "backup-tools"]) {
      expect(services[name]!.image).toMatch(/^openvalens-backup:\$\{OPENVALENS_VERSION:\?/);
    }
  });

  test("secrets are never interpolated into the environment, only *_FILE paths", () => {
    for (const [name, service] of Object.entries(services)) {
      for (const key of SECRET_KEYS) {
        expect({ name, key, value: service.environment?.[key] }).toEqual({
          name,
          key,
          value: undefined,
        });
      }
    }
    expect(services.server!.environment?.DATABASE_URL_FILE).toBe("/run/secrets/DATABASE_URL");
    expect(services.postgres!.environment?.POSTGRES_PASSWORD_FILE).toBe(
      "/run/secrets/POSTGRES_PASSWORD",
    );
  });

  test("backups (Issue #64): db network only, key and password as files, storage writable only by tools", () => {
    for (const name of ["backup", "backup-scheduler", "backup-tools"]) {
      const service = services[name]!;
      expect(service.networks).toEqual(["db"]);
      expect(service.ports).toBeUndefined();
      expect(service.volumes).toContain("./secrets/backup:/run/backup-secrets:ro");
      expect(service.volumes).toContain("./secrets/postgres:/run/secrets:ro");
      expect(service.volumes).toContain(
        "./backup/openvalens-backup.sh:/opt/openvalens/openvalens-backup.sh:ro",
      );
      expect(service.environment?.OPENVALENS_BACKUP_IDENTITY_FILE).toBe(
        "/run/backup-secrets/age-identity",
      );
      for (const value of Object.values(service.environment ?? {}))
        expect(value).not.toMatch(/AGE-SECRET-KEY/);
    }
    expect(services.backup!.volumes).toContain("storage:/storage:ro");
    expect(services["backup-scheduler"]!.volumes).toContain("storage:/storage:ro");
    expect(services["backup-tools"]!.volumes).toContain("storage:/storage");
    // The scheduler starts after migrations and keeps running; tools never start on `up`.
    expect(services["backup-scheduler"]!.depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
    });
    expect(services["backup-scheduler"]!.restart).toBe("unless-stopped");
    expect(services["backup-scheduler"]!.command).toEqual(["schedule"]);
    expect(services["backup-tools"]!.profiles).toEqual(["tools"]);
    // Defaults: daily at 03:00 UTC, keep 14 daily and 10 pre-migrate backups.
    const env = services["backup-scheduler"]!.environment!;
    expect(env.OPENVALENS_BACKUP_HOUR).toBe("${OPENVALENS_BACKUP_HOUR:-3}");
    expect(env.OPENVALENS_BACKUP_DAILY_RETAIN).toBe("${OPENVALENS_BACKUP_DAILY_RETAIN:-14}");
    expect(env.OPENVALENS_BACKUP_RETAIN).toBe("${OPENVALENS_BACKUP_RETAIN:-10}");
  });

  test("startup is gated: postgres -> backup -> migrate -> server", () => {
    expect(services.backup!.depends_on).toEqual({ postgres: { condition: "service_healthy" } });
    expect(services.migrate!.depends_on).toEqual({
      backup: { condition: "service_completed_successfully" },
    });
    expect(services.server!.depends_on).toEqual({
      migrate: { condition: "service_completed_successfully" },
    });
    expect(services.backup!.restart).toBe("no");
    expect(services.migrate!.restart).toBe("no");
    expect(services.migrate!.image).toBe(services.server!.image);
  });

  test("every server schema key is passed through or explicitly excluded", () => {
    const env = services.server!.environment!;
    expect(services.migrate!.environment).toEqual(env);
    const problems: string[] = [];
    for (const key of serverSchema.keys()) {
      const name = SECRET_KEYS.includes(key) ? `${key}_FILE` : key;
      const value = env[name];
      if (key in NOT_PASSED_THROUGH) {
        if (env[key] !== undefined || env[`${key}_FILE`] !== undefined) {
          problems.push(`${key} is listed as not passed through but is set`);
        }
      } else if (value === undefined) {
        problems.push(`${name} is not passed through to the server`);
      } else if (!SET_BY_STACK.has(key) && !value.startsWith(`\${${name}`)) {
        problems.push(`${name} is not read from deploy/.env`);
      }
    }
    for (const key of Object.keys(NOT_PASSED_THROUGH)) expect(serverSchema.has(key)).toBe(true);
    // Sensitive keys only travel as files, and only keys that support `_FILE`.
    for (const key of SECRET_KEYS.filter((k) => k !== "POSTGRES_PASSWORD")) {
      expect(FILE_SECRET_KEYS).toContain(key as (typeof FILE_SECRET_KEYS)[number]);
    }
    expect(problems).toEqual([]);
  });

  test("compose fallbacks match the server schema defaults", () => {
    const env = services.server!.environment!;
    const mismatches: string[] = [];
    for (const [name, value] of Object.entries(env)) {
      const match = /^\$\{([A-Z][A-Z0-9_]*):-(.*)\}$/.exec(value);
      if (!match || !serverSchema.has(match[1]!)) continue;
      const expected = COMPOSE_DEFAULT_OVERRIDES[match[1]!] ?? serverSchema.get(match[1]!);
      if (match[2] !== expected) mismatches.push(`${name}: ${match[2]} != ${expected}`);
    }
    expect(mismatches).toEqual([]);
  });

  test("web and server get the same CSP mode", () => {
    expect(services.web!.environment?.CSP_MODE).toBe(services.server!.environment!.CSP_MODE!);
  });

  test("the server runs in production mode on one HTTPS origin", () => {
    const env = services.server!.environment!;
    expect(env.NODE_ENV).toBe("production");
    expect(env.BETTER_AUTH_URL).toMatch(/^https:\/\//);
    expect(env.CORS_ORIGIN).toBe(env.BETTER_AUTH_URL!);
  });
});

describe("deploy/Caddyfile", () => {
  test("routes every server path prefix to the server", async () => {
    const caddyfile = await Bun.file(join(deploy, "Caddyfile")).text();
    const matcher = caddyfile.split("\n").find((line) => line.includes("@api path"))!;
    for (const prefix of ["/api/*", "/rpc/*", "/api-reference/*"]) {
      expect(matcher).toContain(prefix);
    }
    expect(CSP_REPORT_PATH.startsWith("/api/")).toBe(true);
    expect(caddyfile).toContain("reverse_proxy server:3000");
    expect(caddyfile).toContain("reverse_proxy web:80");
  });

  test("serves HTTPS unless OPENVALENS_SITE_SCHEME says a proxy terminates TLS", async () => {
    const caddyfile = await Bun.file(join(deploy, "Caddyfile")).text();
    expect(caddyfile).toContain("{$OPENVALENS_SITE_SCHEME:https}://{$OPENVALENS_DOMAIN} {");
    const compose = await Bun.file(join(deploy, "compose.yml")).text();
    expect(compose).toContain("OPENVALENS_SITE_SCHEME: ${OPENVALENS_SITE_SCHEME:-https}");
  });
});

describe("image build context", () => {
  test("self-host secrets and state are excluded from image layers", async () => {
    const dockerignore = await Bun.file(join(repo, ".dockerignore")).text();
    expect(dockerignore.split("\n")).toContain("deploy/secrets");
    expect(dockerignore.split("\n")).toContain("**/.env");
    // Multi-GB food catalog downloads must never reach the build context.
    expect(dockerignore.split("\n")).toContain("deploy/catalogs");
  });
});

function runBackupHook(env: Record<string, string>) {
  const result = Bun.spawnSync(["sh", join(deploy, "pre-migrate-backup.sh")], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

describe("deploy/pre-migrate-backup.sh", () => {
  test("refuses to migrate without a backup unless explicitly overridden", () => {
    const refused = runBackupHook({ OPENVALENS_PRE_MIGRATE_BACKUP: "none" });
    expect(refused.exitCode).toBe(1);
    expect(refused.output).toContain("refusing to migrate");

    const wrongOverride = runBackupHook({
      OPENVALENS_PRE_MIGRATE_BACKUP: "none",
      OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP: "yes",
    });
    expect(wrongOverride.exitCode).toBe(1);

    const allowed = runBackupHook({
      OPENVALENS_PRE_MIGRATE_BACKUP: "none",
      OPENVALENS_ALLOW_MIGRATE_WITHOUT_BACKUP: "I_HAVE_A_BACKUP",
    });
    expect(allowed.exitCode).toBe(0);
    expect(allowed.output).toContain("WITHOUT a pre-migrate backup");
  });

  test("rejects an unknown mode and an invalid retention count", () => {
    expect(runBackupHook({ OPENVALENS_PRE_MIGRATE_BACKUP: "s3" }).exitCode).toBe(1);
    expect(runBackupHook({ OPENVALENS_BACKUP_RETAIN: "-1" }).exitCode).toBe(1);
  });

  test("hook mode requires an executable hook and propagates its failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "ov-backup-hook-"));
    try {
      const hook = join(dir, "pre-migrate");
      expect(
        runBackupHook({ OPENVALENS_PRE_MIGRATE_BACKUP: "hook", OPENVALENS_BACKUP_HOOK: hook })
          .exitCode,
      ).toBe(1);

      writeFileSync(hook, "#!/bin/sh\nexit 3\n");
      chmodSync(hook, 0o700);
      const failed = runBackupHook({
        OPENVALENS_PRE_MIGRATE_BACKUP: "hook",
        OPENVALENS_BACKUP_HOOK: hook,
      });
      expect(failed.exitCode).toBe(1);
      expect(failed.output).toContain("refusing to migrate");

      writeFileSync(hook, "#!/bin/sh\nexit 0\n");
      expect(
        runBackupHook({ OPENVALENS_PRE_MIGRATE_BACKUP: "hook", OPENVALENS_BACKUP_HOOK: hook })
          .exitCode,
      ).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deploy/setup.sh", () => {
  test("parses as bash", () => {
    expect(Bun.spawnSync(["bash", "-n", join(deploy, "setup.sh")]).exitCode).toBe(0);
  });

  test("rejects unknown options without echoing them", () => {
    const result = Bun.spawnSync(["bash", join(deploy, "setup.sh"), "install", "--token=s3cr3t"]);
    expect(result.exitCode).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain("s3cr3t");
  });

  test("manages a _FILE path for every optional secret the stack accepts", () => {
    const script = readFileSync(join(deploy, "setup.sh"), "utf8");
    const listed = /^SECRET_FILE_KEYS="([^"]*)"/m.exec(script)?.[1]?.split(/\s+/).filter(Boolean);
    // Optional secrets reach the server only as `${KEY_FILE:-}`, set by setup.sh.
    const optional = Object.entries(services.server!.environment ?? {})
      .filter(([key, value]) => key.endsWith("_FILE") && value === `\${${key}:-}`)
      .map(([key]) => key.slice(0, -"_FILE".length));
    expect(optional).toContain("POSTHOG_PROJECT_TOKEN");
    expect([...(listed ?? [])].sort()).toEqual([...optional].sort());
    for (const key of listed ?? []) expect(FILE_SECRET_KEYS as readonly string[]).toContain(key);
  });

  const hasDocker =
    Bun.which("docker") !== null &&
    Bun.spawnSync(["docker", "compose", "version"], { stdout: "ignore", stderr: "ignore" })
      .exitCode === 0;

  test.skipIf(!hasDocker)(
    "install --dry-run validates the stack and leaves no state behind",
    () => {
      const hadEnv = existsSync(join(deploy, ".env"));
      const hadSecrets = existsSync(join(deploy, "secrets"));
      const result = Bun.spawnSync(
        ["bash", join(deploy, "setup.sh"), "install", "--dry-run", "--non-interactive"],
        {
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: process.env.HOME ?? tmpdir(),
            OPENVALENS_DOMAIN: "health.example.org",
            ACME_EMAIL: "ops@example.org",
            EMAIL_FROM: "OpenValens <noreply@example.org>",
          },
        },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect({ exitCode: result.exitCode, output }).toMatchObject({ exitCode: 0 });
      expect(output).toContain("only caddy publishes ports");
      expect(output).toContain("[dry-run] would run: compose up -d");
      // Generated secrets are never printed.
      expect(output).not.toContain("postgresql://");
      expect(existsSync(join(deploy, ".env"))).toBe(hadEnv);
      expect(existsSync(join(deploy, "secrets"))).toBe(hadSecrets);
    },
    60_000,
  );
});

/**
 * A copy of `deploy/` in a temp directory with a fake `docker` on PATH, so
 * `setup.sh install` runs end to end (secrets, deploy/.env, compose calls)
 * without Docker. The fake answers the few queries setup.sh makes and records
 * every call; it never sees a secret value.
 */
function installSandbox() {
  const root = mkdtempSync(join(tmpdir(), "ov-setup-"));
  const dir = join(root, "deploy");
  const bin = join(root, "bin");
  mkdirSync(dir);
  mkdirSync(bin);
  for (const file of ["setup.sh", "compose.yml"]) cpSync(join(deploy, file), join(dir, file));
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh
printf '%s\\n' "$*" >>"${root}/docker.log"
case " $* " in
  *" config --quiet "*) exit 0 ;;
  *" config "*) printf 'services:\\n  caddy:\\n    ports:\\n      - 443\\n' ;;
  *" ps -q "*) echo fake-container ;;
  " inspect "*) echo healthy ;;
  *" admission.sh mint "*) echo fake-setup-token ;;
  *" --entrypoint age-keygen "*) echo AGE-SECRET-KEY-1FAKESYNTHETICKEYFORTESTS ;;
  *" backup-tools import "*) cat >/dev/null ;;
esac
exit 0
`,
  );
  chmodSync(join(bin, "docker"), 0o755);

  const settings = {
    OPENVALENS_DOMAIN: "health.example.org",
    ACME_EMAIL: "ops@example.org",
    EMAIL_FROM: "OpenValens <noreply@example.org>",
  };
  return {
    dir,
    envFile: join(dir, ".env"),
    secret: (name: string) => join(dir, "secrets", "server", name),
    readEnv: () => readFileSync(join(dir, ".env"), "utf8"),
    run(args: string[], overrides: Record<string, string> = {}) {
      const result = Bun.spawnSync(["bash", join(dir, "setup.sh"), ...args], {
        env: {
          PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          HOME: process.env.HOME ?? root,
          TMPDIR: root,
          ...settings,
          ...overrides,
        },
      });
      return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const MARKER = "# --- Your settings: deploy/setup.sh install keeps everything below ---";

/** Values of `key` in a dotenv text, in order. */
const valuesOf = (text: string, key: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));

describe("deploy/setup.sh install re-runs (Issue #63)", () => {
  const install = ["install", "--non-interactive"];

  test("keeps hand-added keys and existing values, and is idempotent", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      const first = box.readEnv();
      expect(first.trimEnd().endsWith(MARKER)).toBe(true);

      const generated = readFileSync(box.secret("BETTER_AUTH_SECRET"), "utf8").trim();
      writeFileSync(box.secret("AI_API_KEY"), "sk-synthetic-ai-key\n");
      const added = [
        "# local model",
        "AI_PROVIDER=openai-compatible",
        "AI_BASE_URL=http://ollama.internal:11434/v1",
        "AI_MODEL=synthetic-model",
        "CSP_MODE=report-only",
        "OPENVALENS_BACKUP_RETAIN=3",
      ];
      writeFileSync(box.envFile, `${first}${added.join("\n")}\n`);

      // A re-run reuses the domain from deploy/.env, not the environment.
      const second = box.run(install, { OPENVALENS_DOMAIN: "other.example.org" });
      expect({ exitCode: second.exitCode, output: second.output }).toMatchObject({ exitCode: 0 });
      const env = box.readEnv();
      expect(env.split(`${MARKER}\n`)[1]).toBe(
        `${added.filter((line) => !line.startsWith("OPENVALENS_BACKUP_RETAIN")).join("\n")}\n`,
      );
      expect(valuesOf(env, "OPENVALENS_DOMAIN")).toEqual(["health.example.org"]);
      expect(valuesOf(env, "OPENVALENS_BACKUP_RETAIN")).toEqual(["3"]);
      expect(valuesOf(env, "AI_API_KEY_FILE")).toEqual(["/run/secrets/AI_API_KEY"]);
      expect(readFileSync(box.secret("BETTER_AUTH_SECRET"), "utf8").trim()).toBe(generated);

      // No secret value reaches the output or deploy/.env.
      for (const text of [second.output, env]) {
        expect(text).not.toContain("sk-synthetic-ai-key");
        expect(text).not.toContain(generated);
      }

      expect(box.run(install).exitCode).toBe(0);
      expect(box.readEnv()).toBe(env);
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("points POSTHOG_PROJECT_TOKEN_FILE at a dropped secret file (#243)", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      expect(valuesOf(box.readEnv(), "POSTHOG_PROJECT_TOKEN_FILE")).toEqual([""]);
      writeFileSync(box.secret("POSTHOG_PROJECT_TOKEN"), "phc_synthetic_token\n");
      const result = box.run(install);
      expect(result.exitCode).toBe(0);
      const env = box.readEnv();
      expect(valuesOf(env, "POSTHOG_PROJECT_TOKEN_FILE")).toEqual([
        "/run/secrets/POSTHOG_PROJECT_TOKEN",
      ]);
      for (const text of [result.output, env]) expect(text).not.toContain("phc_synthetic_token");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("migrates a deploy/.env written before the marker existed", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      writeFileSync(
        box.envFile,
        [
          "# Written by deploy/setup.sh.",
          "OPENVALENS_DOMAIN=health.example.org",
          "ACME_EMAIL=ops@example.org",
          "EMAIL_FROM=OpenValens <noreply@example.org>",
          "OPENVALENS_VERSION=old",
          "RESEND_API_KEY_FILE=",
          "EMAIL_DRY_RUN=true",
          "ANTHROPIC_API_KEY_FILE=/run/secrets/ANTHROPIC_API_KEY",
          "AI_API_KEY=sk-inline-synthetic",
          "",
        ].join("\n"),
      );

      const result = box.run(install);
      expect(result.exitCode).toBe(0);
      const env = box.readEnv();
      expect(env.split(`${MARKER}\n`)[1]).toBe(
        "EMAIL_DRY_RUN=true\nAI_API_KEY=sk-inline-synthetic\n",
      );
      // A `_FILE` path without its secret file is cleared, not left dangling.
      expect(valuesOf(env, "ANTHROPIC_API_KEY_FILE")).toEqual([""]);
      expect(result.output).toContain("clearing ANTHROPIC_API_KEY_FILE");
      expect(result.output).toContain("deploy/.env sets AI_API_KEY directly");
      expect(result.output).not.toContain("sk-inline-synthetic");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("--reconfigure replaces the domain and email settings only", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      writeFileSync(box.envFile, `${box.readEnv()}EMAIL_REPLY_TO=support@example.org\n`);
      const result = box.run([...install, "--reconfigure"], {
        OPENVALENS_DOMAIN: "other.example.org",
      });
      expect(result.exitCode).toBe(0);
      const env = box.readEnv();
      expect(valuesOf(env, "OPENVALENS_DOMAIN")).toEqual(["other.example.org"]);
      expect(valuesOf(env, "EMAIL_REPLY_TO")).toEqual(["support@example.org"]);
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("records OPENVALENS_SITE_SCHEME, keeps it on re-runs and rejects other values", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      expect(valuesOf(box.readEnv(), "OPENVALENS_SITE_SCHEME")).toEqual(["https"]);

      expect(box.run(install, { OPENVALENS_SITE_SCHEME: "http" }).exitCode).toBe(0);
      expect(box.run(install).exitCode).toBe(0);
      expect(valuesOf(box.readEnv(), "OPENVALENS_SITE_SCHEME")).toEqual(["http"]);

      const bad = box.run(install, { OPENVALENS_SITE_SCHEME: "ftp" });
      expect(bad.exitCode).not.toBe(0);
      expect(bad.output).toContain("OPENVALENS_SITE_SCHEME must be https (default) or http");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("--dry-run previews an existing install without changing it", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      writeFileSync(box.envFile, `${box.readEnv()}CSP_MODE=report-only\n`);
      const before = box.readEnv();
      const secretsBefore = readdirSync(join(box.dir, "secrets"), { recursive: true }).sort();
      const generated = readFileSync(box.secret("CRON_SECRET"), "utf8").trim();

      const result = box.run([...install, "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("reusing settings from deploy/.env");
      expect(result.output).toContain("[dry-run] nothing was changed");
      expect(result.output).not.toContain(generated);
      expect(box.readEnv()).toBe(before);
      expect(readdirSync(join(box.dir, "secrets"), { recursive: true }).sort()).toEqual(
        secretsBefore,
      );
    } finally {
      box.cleanup();
    }
  }, 30_000);
});

/**
 * A fake `curl` for the sandbox: records each call and, for `-o <file>`,
 * writes a tiny placeholder stamped with a fixed upstream time — unless the
 * call is conditional (`-z`), which it answers as "not modified" (no body).
 */
function fakeCurl(dir: string) {
  const root = join(dir, "..");
  writeFileSync(
    join(root, "bin", "curl"),
    `#!/bin/sh
printf '%s\\n' "$*" >>"${root}/curl.log"
out=""; conditional=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -z) conditional=1; shift ;;
  esac
  shift
done
[ "$conditional" -eq 1 ] && exit 0
printf 'placeholder\\n' >"$out"
TZ=UTC touch -t 202610241218 "$out"
`,
  );
  chmodSync(join(root, "bin", "curl"), 0o755);
  const log = (name: string) => {
    const path = join(root, name);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
  };
  return {
    curlLog: () => log("curl.log"),
    dockerLog: () => log("docker.log"),
    reset: () => {
      rmSync(join(root, "curl.log"), { force: true });
      rmSync(join(root, "docker.log"), { force: true });
    },
  };
}

describe("deploy/setup.sh catalogs", () => {
  const catalogs = ["catalogs", "--non-interactive"];

  test("requires a known --source and never echoes a rejected value", () => {
    const box = installSandbox();
    try {
      expect(box.run(catalogs).exitCode).toBe(2);
      const unknown = box.run([...catalogs, "--source", "fdc,s3cr3t"]);
      expect(unknown.exitCode).toBe(2);
      expect(unknown.output).not.toContain("s3cr3t");
      expect(box.run([...catalogs, "--source"]).exitCode).toBe(2);
      // --source belongs to catalogs only.
      expect(box.run(["install", "--non-interactive", "--source", "fdc"]).exitCode).toBe(2);
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("refuses to run before install, and a dry run downloads nothing", () => {
    const box = installSandbox();
    try {
      const tools = fakeCurl(box.dir);
      const refused = box.run([...catalogs, "--source", "fdc"]);
      expect(refused.exitCode).toBe(1);
      expect(refused.output).toContain("run 'deploy/setup.sh install' first");

      const dry = box.run([...catalogs, "--source", "all", "--dry-run"]);
      expect(dry.exitCode).toBe(0);
      expect(dry.output).toContain("Open Database License");
      expect(dry.output).toContain("CC0 1.0");
      expect(dry.output).toContain(
        "would download https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz",
      );
      expect(dry.output).toContain("FoodData_Central_branded_food_json_");
      expect(dry.output).toContain("[dry-run] nothing was downloaded or imported");
      expect(tools.curlLog()).toBe("");
      expect(tools.dockerLog()).not.toContain(" run ");
      expect(existsSync(join(box.dir, "catalogs"))).toBe(false);
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("asks before downloading unless --non-interactive", () => {
    const box = installSandbox();
    try {
      const tools = fakeCurl(box.dir);
      expect(box.run(["install", "--non-interactive"]).exitCode).toBe(0);
      const cancelled = box.run(["catalogs", "--source", "fdc"]);
      expect(cancelled.exitCode).toBe(1);
      expect(cancelled.output).toContain("cancelled; nothing was downloaded");
      expect(tools.curlLog()).toBe("");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("downloads, imports in a one-off server container, and re-runs as an update", () => {
    const box = installSandbox();
    try {
      const tools = fakeCurl(box.dir);
      expect(box.run(["install", "--non-interactive"]).exitCode).toBe(0);
      tools.reset();

      const first = box.run([...catalogs, "--source", "fdc,off"]);
      expect({ exitCode: first.exitCode, output: first.output }).toMatchObject({ exitCode: 0 });
      expect(first.output).toContain("food catalogs are ready");
      const downloads = tools.curlLog();
      expect(downloads).toContain("FoodData_Central_foundation_food_json_");
      expect(downloads).toContain("FoodData_Central_sr_legacy_food_json_2018-04.zip");
      expect(downloads).toContain("openfoodfacts-products.jsonl.gz");
      expect(downloads).not.toContain("branded");
      expect(existsSync(join(box.dir, "catalogs", "openfoodfacts-products.jsonl.gz"))).toBe(true);
      expect(readdirSync(join(box.dir, "catalogs")).some((n) => n.endsWith(".part"))).toBe(false);

      const imports = tools
        .dockerLog()
        .split("\n")
        .filter((line) => line.includes("food-catalog-import.ts"));
      expect(imports).toHaveLength(3);
      for (const line of imports) {
        // The server image's one-off `migrate` service: db network only, no deps.
        expect(line).toContain(" run --rm --no-deps -T --workdir /app ");
        expect(line).toContain(`${join(box.dir, "catalogs")}:/catalogs:ro migrate bun`);
        expect(line).toContain("--allow-remote");
      }
      expect(imports[2]).toContain(
        "--source off --file /catalogs/openfoodfacts-products.jsonl.gz --dataset products --version 2026-10-24",
      );
      expect(tools.dockerLog()).toContain("up -d --wait postgres");

      // Re-run: dated FDC releases are not fetched again; OFF is conditional.
      tools.reset();
      const again = box.run([...catalogs, "--source", "fdc,off"]);
      expect(again.exitCode).toBe(0);
      expect(again.output).toContain("is already downloaded");
      expect(again.output).toContain("openfoodfacts-products.jsonl.gz is up to date");
      const refetches = tools.curlLog().trim().split("\n");
      expect(refetches).toHaveLength(1);
      expect(refetches[0]).toContain(" -z ");
    } finally {
      box.cleanup();
    }
  }, 30_000);
});

describe("deploy/setup.sh backup and restore (Issue #64)", () => {
  const install = ["install", "--non-interactive"];
  const ID = "20261025T030000Z-daily";
  const dockerLog = (box: ReturnType<typeof installSandbox>) =>
    readFileSync(join(box.dir, "..", "docker.log"), "utf8");

  test("install generates the backup key once, as a file, and never prints it", () => {
    const box = installSandbox();
    try {
      const first = box.run(install);
      expect(first.exitCode).toBe(0);
      const key = join(box.dir, "secrets", "backup", "age-identity");
      const value = readFileSync(key, "utf8");
      expect(value).toStartWith("AGE-SECRET-KEY-");
      expect(statSync(key).mode & 0o777).toBe(0o444);
      expect(statSync(join(box.dir, "secrets")).mode & 0o777).toBe(0o700);
      expect(first.output).toContain("Copy that file OFF this server");
      expect(first.output).not.toContain(value.trim());
      expect(box.readEnv()).not.toContain("AGE-SECRET-KEY");
      expect(valuesOf(box.readEnv(), "OPENVALENS_BACKUP_HOUR")).toEqual(["3"]);
      expect(valuesOf(box.readEnv(), "OPENVALENS_BACKUP_DAILY_RETAIN")).toEqual(["14"]);

      // A re-run keeps the key: replacing it would orphan every backup.
      writeFileSync(join(box.dir, "..", "docker.log"), "");
      expect(box.run(install).exitCode).toBe(0);
      expect(readFileSync(key, "utf8")).toBe(value);
      expect(dockerLog(box)).not.toContain("age-keygen");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("rejects bad ids and stray arguments without echoing them", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      const bad = box.run(["restore", "../../s3cr3t", "--force"]);
      expect(bad.exitCode).not.toBe(0);
      expect(bad.output).not.toContain("s3cr3t");
      expect(box.run(["restore"]).exitCode).not.toBe(0);
      expect(box.run(["restore", ID, ID]).exitCode).not.toBe(0);
      expect(box.run(["install", "s3cr3t"]).exitCode).toBe(2);
      expect(box.run(["backup", "frobnicate"]).exitCode).not.toBe(0);
      expect(dockerLog(box)).not.toContain("restore-db");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("refuses without the backup key and points at the escrowed copy", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      rmSync(join(box.dir, "secrets", "backup", "age-identity"));
      const result = box.run(["restore", ID, "--force"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("escrowed copy");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("a non-interactive restore needs --force and changes nothing without it", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      const result = box.run(["restore", ID, "--non-interactive"]);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain("needs --force");
      const log = dockerLog(box);
      // It verified first, then stopped before touching anything.
      expect(log).toContain(`backup-tools verify ${ID}`);
      expect(log).not.toContain("restore-db");
      expect(log).not.toContain("stop caddy");
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("restore: verify, stop, keep + restore, migrate, merge and replay the ledger, start", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      writeFileSync(join(box.dir, "..", "docker.log"), "");
      const result = box.run(["restore", ID, "--non-interactive", "--force"]);
      expect({ exitCode: result.exitCode, output: result.output }).toMatchObject({ exitCode: 0 });
      const lines = dockerLog(box).split("\n");
      const at = (needle: string) => {
        const index = lines.findIndex((line) =>
          needle === "up -d" || needle === "build"
            ? line.endsWith(` ${needle}`)
            : line.includes(needle),
        );
        expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
        return index;
      };
      const steps = [
        "build",
        `backup-tools verify ${ID}`,
        "stop caddy web server backup-scheduler",
        `backup-tools restore-db ${ID} `,
        "run --rm --no-deps -T migrate",
        "backup-tools ledger-merge ",
        "server bun --no-env-file scripts/erasure-replay.ts --allow-remote",
        `backup-tools record restore manual ok ${ID}`,
        "up -d",
      ].map(at);
      expect([...steps].sort((a, b) => a - b)).toEqual(steps);
      expect(result.output).toContain("openvalens_pre_restore_");
      expect(result.output).toContain("deploy/setup.sh backup undo-restore");

      // --no-build (the rollback rehearsal) keeps the pre-built images.
      writeFileSync(join(box.dir, "..", "docker.log"), "");
      expect(box.run(["restore", ID, "--force", "--no-build"]).exitCode).toBe(0);
      expect(
        dockerLog(box)
          .split("\n")
          .some((line) => line.endsWith(" build")),
      ).toBe(false);
    } finally {
      box.cleanup();
    }
  }, 30_000);

  test("backup export and import move encrypted copies through stdin/stdout only", () => {
    const box = installSandbox();
    try {
      expect(box.run(install).exitCode).toBe(0);
      const src = join(box.dir, "..", "offsite", ID);
      mkdirSync(src, { recursive: true });
      writeFileSync(join(src, "SHA256SUMS"), "");
      const imported = box.run(["backup", "import", src]);
      expect({ exitCode: imported.exitCode, output: imported.output }).toMatchObject({
        exitCode: 0,
      });
      expect(dockerLog(box)).toContain(`backup-tools import ${ID}`);
      const notBackup = join(box.dir, "..", "offsite", "random");
      mkdirSync(notBackup);
      expect(box.run(["backup", "import", notBackup]).exitCode).not.toBe(0);
    } finally {
      box.cleanup();
    }
  }, 30_000);
});

describe("deploy/backup/openvalens-backup.sh (Issue #64)", () => {
  const tool = join(deploy, "backup", "openvalens-backup.sh");
  const runTool = (args: string[], env: Record<string, string> = {}) => {
    const result = Bun.spawnSync(["bash", tool, ...args], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
    });
    return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}` };
  };

  test("parses as bash", () => {
    expect(Bun.spawnSync(["bash", "-n", tool]).exitCode).toBe(0);
    expect(Bun.spawnSync(["sh", "-n", join(deploy, "pre-migrate-backup.sh")]).exitCode).toBe(0);
  });

  test("refuses unknown commands and bad ids, and fails clearly without a key", () => {
    expect(runTool(["frobnicate"]).exitCode).toBe(1);
    const dir = mkdtempSync(join(tmpdir(), "ov-backup-tool-"));
    try {
      const noKey = runTool(["create", "manual"], {
        OPENVALENS_BACKUP_DIR: dir,
        OPENVALENS_BACKUP_IDENTITY_FILE: join(dir, "missing"),
      });
      expect(noKey.exitCode).toBe(1);
      expect(noKey.output).toContain("no backup key");
      expect(runTool(["create", "hourly"], { OPENVALENS_BACKUP_DIR: dir }).exitCode).toBe(1);
      const badId = runTool(["restore-db", "../etc", "20261025000000"], {
        OPENVALENS_BACKUP_DIR: dir,
      });
      expect(badId.exitCode).toBe(1);
      expect(badId.output).not.toContain("../etc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("records only value-free status: no path, key or connection string in backup_run", () => {
    const script = readFileSync(tool, "utf8");
    const records = [...script.matchAll(/record (backup|verify|restore) [^\n]*/g)].map((m) => m[0]);
    expect(records.length).toBeGreaterThan(5);
    for (const line of records) expect(line).not.toMatch(/IDENTITY|PGPASSWORD|\$work|\$dir/);
  });
});

describe("scripts/rollback-rehearsal.sh (Issue #129)", () => {
  const script = join(repo, "scripts", "rollback-rehearsal.sh");

  test("parses as bash", () => {
    expect(Bun.spawnSync(["bash", "-n", script]).exitCode).toBe(0);
  });

  test("rejects unknown options without echoing them and requires both refs", () => {
    const unknown = Bun.spawnSync(["bash", script, "--token=s3cr3t"]);
    expect(unknown.exitCode).toBe(2);
    expect(`${unknown.stdout}${unknown.stderr}`).not.toContain("s3cr3t");
    expect(Bun.spawnSync(["bash", script, "--from", "HEAD"]).exitCode).toBe(2);
  });

  test("refuses a remote Docker daemon before touching anything", () => {
    const result = Bun.spawnSync(["bash", script, "--from", "HEAD~1", "--to", "HEAD"], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", DOCKER_HOST: "tcp://203.0.113.1:2376" },
    });
    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("non-local DOCKER_HOST");
  });
});
