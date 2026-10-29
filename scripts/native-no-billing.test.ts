import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Issue #297 / #293 — the mobile app is a free companion with no purchase UI:
 * no prices, no "Subscribe" button, no Stripe and no link to checkout or to
 * Plan & billing (App Store Review Guideline 3.1.3(f)). Billing lives on the
 * web only. This guard scans the native app's source and config and fails on
 * anything that looks like billing.
 *
 * It is a tripwire, not a parser: when a legitimate non-billing word trips it,
 * reword the code rather than widening the allow-list.
 */

const repo = join(import.meta.dir, "..");
const native = join(repo, "apps", "native");
const SOURCE_DIRS = ["app", "components", "contexts", "lib", "utils"];
const CONFIG_FILES = ["app.json", "app.config.ts", "package.json", "eas.json"];
const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|json)$/;

/** Patterns that must never appear in the mobile app. */
export const BILLING_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "Stripe", pattern: /stripe/i },
  { name: "checkout", pattern: /check[\s_-]?out/i },
  { name: "billing", pattern: /billing/i },
  { name: "billing RPC", pattern: /\b(orpc|client)\s*\.\s*billing\b/ },
  { name: "price", pattern: /\bpric(e|es|ing)\b/i },
  { name: "currency amount", pattern: /€|\bEUR\b|\$\s?\d+[.,]\d{2}\b/ },
  { name: "Subscribe button", pattern: /\bSubscri(be|ption plan)\b/ },
  { name: "purchase", pattern: /\b(purchase|in-app purchase|buy now|upgrade now)\b/i },
  { name: "plan per period", pattern: /\b(per|\/)\s?(month|year)\b/i },
  { name: "Plan & billing link", pattern: /settings\/billing|plan (&|and) billing/i },
];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (SOURCE_FILE.test(name)) files.push(path);
  }
  return files;
}

export function billingViolations(text: string): string[] {
  return BILLING_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

describe("mobile app has no billing UI, prices or checkout links", () => {
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => walk(join(native, dir))),
    ...CONFIG_FILES.map((file) => join(native, file)),
  ];

  test("the guard scans the app's real source", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  test("no file in apps/native mentions billing, prices, Stripe or checkout", () => {
    const problems: string[] = [];
    for (const file of files) {
      const found = billingViolations(readFileSync(file, "utf8"));
      if (found.length) problems.push(`${relative(repo, file)}: ${found.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });

  test("the patterns catch what they must", () => {
    for (const sample of [
      'import Stripe from "stripe";',
      "<Button>Subscribe</Button>",
      "€7.99",
      "7,99 €",
      "$4.99",
      "Linking.openURL(`${server}/settings/billing`)",
      "await client.billing.checkout({ plan })",
      "See pricing",
      "€69 per year",
      "Plan & billing",
    ]) {
      expect(billingViolations(sample)).not.toEqual([]);
    }
    // Existing, unrelated native code must not trip it.
    for (const sample of [
      "const subscription = AppState.addEventListener('change', update);",
      "function subscribe(listener: () => void) {}",
      "useSyncExternalStore(subscribe, getSnapshot)",
      'name.replace(/([a-z0-9])([A-Z])/g, "$1_$2")',
    ]) {
      expect(billingViolations(sample)).toEqual([]);
    }
  });
});
