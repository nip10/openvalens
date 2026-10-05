import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { validateProductionSecrets } from "./validate-production-secrets";

const validAuthSecret = "synthetic-auth-secret-for-tests-0123456789";
const validCronSecret = "synthetic-cron-secret-for-tests-0123456789";

describe("validateProductionSecrets", () => {
  test("rejects each listed placeholder for either production secret", () => {
    const placeholders = [
      "changeme",
      "changeit",
      "password",
      "secret",
      "replaceme",
      "yoursecret",
      "yourauthsecret",
      "yourcronsecret",
      "example",
      "testsecret",
      "developmentsecret",
      "defaultsecret",
    ];

    for (const placeholder of placeholders) {
      for (const key of ["BETTER_AUTH_SECRET", "CRON_SECRET"] as const) {
        const env = {
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: validAuthSecret,
          CRON_SECRET: validCronSecret,
          [key]: placeholder,
        };

        expect(() => validateProductionSecrets(env)).toThrow(key);
      }
    }
  });

  test("rejects both invalid keys and normalized punctuation/case variants", () => {
    expect(() =>
      validateProductionSecrets({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "  ChAnGe-Me!!!  ",
        CRON_SECRET: "password".repeat(4),
      }),
    ).toThrow("BETTER_AUTH_SECRET, CRON_SECRET");

    expect(() =>
      validateProductionSecrets({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "change-me".repeat(4),
        CRON_SECRET: "synthetic-valid-cron-secret-value",
      }),
    ).toThrow("BETTER_AUTH_SECRET");
  });

  test("rejects empty normalized values and repeated single characters", () => {
    for (const secret of [
      "!!!",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "00000000000000000000000000000000",
    ]) {
      expect(() =>
        validateProductionSecrets({
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: secret,
          CRON_SECRET: validCronSecret,
        }),
      ).toThrow("BETTER_AUTH_SECRET");
    }
  });

  test("accepts unrelated production secrets unchanged", () => {
    const env = {
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "A-valid-secret-with-changeme-inside-0123456789",
      CRON_SECRET: "0123456789abcdef0123456789abcdef",
    };

    expect(() => validateProductionSecrets(env)).not.toThrow();
    expect(env.BETTER_AUTH_SECRET).toBe("A-valid-secret-with-changeme-inside-0123456789");
    expect(env.CRON_SECRET).toBe("0123456789abcdef0123456789abcdef");
  });

  test("does not add checks outside production", () => {
    for (const NODE_ENV of ["development", "test"]) {
      expect(() =>
        validateProductionSecrets({
          NODE_ENV,
          BETTER_AUTH_SECRET: "changeme",
          CRON_SECRET: "password",
        }),
      ).not.toThrow();
    }
  });

  test("production startup import uses the loaded Varlock ENV and reports names only", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "server-secret-startup-"));
    const schema = [
      "# @defaultRequired=true",
      "# ---",
      "# @public @type=enum(development, production, test)",
      "NODE_ENV=development",
      "# @type=string(minLength=32)",
      "BETTER_AUTH_SECRET=",
      "# @type=string(minLength=16)",
      "CRON_SECRET=",
    ].join("\n");

    try {
      await writeFile(join(fixtureDir, ".env.schema"), schema);
      const envServerUrl = new URL("./env.server.ts", import.meta.url).href;
      const child = spawn(
        process.execPath,
        ["-e", `await import(${JSON.stringify(envServerUrl)});`],
        {
          cwd: fixtureDir,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "production",
            BETTER_AUTH_SECRET: "changeme".repeat(4),
            CRON_SECRET: validCronSecret,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      const [exitCode] = await new Promise<[number | null]>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve([code]));
      });
      const output = `${stdout}\n${stderr}`;

      expect(exitCode).not.toBe(0);
      expect(output).toContain("BETTER_AUTH_SECRET");
      expect(output).not.toContain("changeme");
      expect(output).not.toContain(validCronSecret);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
