/**
 * Command-line options for `bun run demo:seed` (Issue #301).
 */

/**
 * The default "today" every demo date is relative to. Fixed so two runs (and
 * two machines) produce the same data; override it with `--today` or
 * `DEMO_SEED_TODAY` so the newest day lines up with the real clock, which the
 * app reads when it decides what "today" and "last 7 days" are.
 */
export const DEFAULT_DEMO_TODAY = "2026-10-28";

export type DemoSeedOptions = {
  /** Calendar day (`YYYY-MM-DD`, UTC) the newest demo data belongs to. */
  today: string;
  /** Also prepare the Cloud variant (trialing subscription; see `cloud.ts`). */
  cloud: boolean;
};

export type ParsedOptions = { ok: true; options: DemoSeedOptions } | { ok: false; message: string };

export const USAGE = "Usage: bun run demo:seed [--today YYYY-MM-DD] [--cloud]";

/** A real calendar day in `YYYY-MM-DD` form, or `null`. */
export function parseDay(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function parseOptions(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): ParsedOptions {
  let today: string | undefined = env.DEMO_SEED_TODAY || undefined;
  let cloud = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--cloud") {
      cloud = true;
    } else if (arg === "--today") {
      today = argv[i + 1] ?? "";
      i += 1;
    } else if (arg.startsWith("--today=")) {
      today = arg.slice("--today=".length);
    } else {
      return { ok: false, message: `Unknown option.\n${USAGE}` };
    }
  }
  const day = parseDay(today ?? DEFAULT_DEMO_TODAY);
  if (!day) return { ok: false, message: `--today must be a calendar day (YYYY-MM-DD).\n${USAGE}` };
  return { ok: true, options: { today: day, cloud } };
}
