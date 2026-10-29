#!/usr/bin/env bun
/**
 * Issue #306 — is `apps/native/eas.json` ready for `eas submit`?
 *
 * `submit.production` ships with placeholders (`REPLACE_WITH_…`) for the
 * values only the owner has (the App Store Connect app id, from #304). The
 * release workflow asks this script before it adds `--auto-submit`, so a
 * placeholder means "build, but do not submit" instead of a failed submit.
 *
 *   bun scripts/eas-submit-config.ts ios|android|all
 *
 * Exit 0 when every named platform is ready; otherwise prints what is
 * missing and exits 1.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PLACEHOLDER = /REPLACE_WITH_[A-Z0-9_]+/;
export type Platform = "ios" | "android";

type SubmitProfile = {
  ios?: { ascAppId?: unknown };
  android?: { track?: unknown; serviceAccountKeyPath?: unknown };
};
export type EasJson = { submit?: Record<string, SubmitProfile | undefined> };

/** What still stops `eas submit --profile <profile>` for one platform. */
export function submitProblems(eas: EasJson, platform: Platform, profile = "production"): string[] {
  const submit = eas.submit?.[profile];
  if (!submit) return [`eas.json has no submit.${profile}`];
  const section = submit[platform];
  if (!section) return [`eas.json has no submit.${profile}.${platform}`];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(section)) {
    if (typeof value === "string" && PLACEHOLDER.test(value))
      problems.push(`submit.${profile}.${platform}.${key} is still ${value}`);
  }
  if (platform === "ios" && typeof submit.ios?.ascAppId !== "string")
    problems.push(`submit.${profile}.ios.ascAppId is not set`);
  if (platform === "android" && typeof submit.android?.track !== "string")
    problems.push(`submit.${profile}.android.track is not set`);
  return problems;
}

function main(argv: string[]): number {
  const which = argv[0] ?? "all";
  if (!["ios", "android", "all"].includes(which)) {
    console.error("usage: bun scripts/eas-submit-config.ts ios|android|all");
    return 1;
  }
  const platforms: Platform[] = which === "all" ? ["ios", "android"] : [which as Platform];
  const eas = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "apps", "native", "eas.json"), "utf8"),
  ) as EasJson;
  const problems = platforms.flatMap((platform) => submitProblems(eas, platform));
  if (problems.length === 0) {
    console.log(`eas.json submit.production is ready for ${platforms.join(" and ")}.`);
    return 0;
  }
  for (const problem of problems) console.log(problem);
  console.log("See docs/releasing.md#one-time-setup-owner.");
  return 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
