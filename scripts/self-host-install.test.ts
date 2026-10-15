/**
 * Static and dry-run checks for the production self-host install (Issue #63):
 * `deploy/compose.yml`, `deploy/Caddyfile`, `deploy/setup.sh` and the
 * pre-migrate backup hook. Nothing here starts containers or touches a
 * database; the live install/upgrade/failed-migration evidence is in the PR.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
];

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
    for (const name of ["caddy", "postgres", "backup"]) {
      expect(services[name]!.image).toMatch(/^[a-z]+:\d+\.\d+(\.\d+)?@sha256:[0-9a-f]{64}$/);
    }
    for (const name of ["server", "migrate", "web"]) {
      expect(services[name]!.image).toMatch(/:\$\{OPENVALENS_VERSION:\?/);
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
});

describe("image build context", () => {
  test("self-host secrets and state are excluded from image layers", async () => {
    const dockerignore = await Bun.file(join(repo, ".dockerignore")).text();
    expect(dockerignore.split("\n")).toContain("deploy/secrets");
    expect(dockerignore.split("\n")).toContain("**/.env");
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
