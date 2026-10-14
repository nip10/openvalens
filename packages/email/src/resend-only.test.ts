import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Issue #61 — Resend is the only email transport. This guard fails if an SMTP
 * (or nodemailer) transport, dependency or environment variable reappears in
 * the email package, the server, or the server environment schema.
 */

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const FORBIDDEN = /\bsmtp\b|SMTP_|nodemailer|mailhog|mailpit/i;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry === "dist") {
      return [];
    }
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const SCANNED = [
  ...listFiles(join(REPO_ROOT, "packages/email/src")).filter(
    (path) => !path.endsWith("resend-only.test.ts"),
  ),
  join(REPO_ROOT, "packages/email/package.json"),
  ...listFiles(join(REPO_ROOT, "apps/server/src")),
  join(REPO_ROOT, "apps/server/package.json"),
  join(REPO_ROOT, "apps/server/.env.schema"),
];

describe("Resend-only email transport", () => {
  test("no SMTP transport, dependency or env var remains", () => {
    const offenders = SCANNED.filter((path) => FORBIDDEN.test(readFileSync(path, "utf8")));
    expect(offenders.map((path) => path.slice(REPO_ROOT.length + 1))).toEqual([]);
  });
});
