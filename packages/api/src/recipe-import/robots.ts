/**
 * Minimal robots.txt matcher (RFC 9309) for recipe imports (Issue #82).
 *
 * Picks the group whose user-agent matches our product token, falling back to
 * `*`; within it the longest matching `Allow`/`Disallow` path wins, `Allow`
 * winning a tie. `*` and a trailing `$` are supported in paths.
 */

type Rule = { allow: boolean; pattern: string };

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(path);
}

/** True when `path` (including any query) may be fetched by `productToken`. */
export function isAllowedByRobots(robotsTxt: string, productToken: string, path: string): boolean {
  const token = productToken.toLowerCase();
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/).slice(0, 10_000)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== "allow" && field !== "disallow")) continue;
    // An empty Disallow allows everything; it adds no rule.
    // Oversized or wildcard-heavy patterns are skipped to keep matching cheap.
    if (value && value.length <= 500 && value.split("*").length <= 9)
      current.rules.push({ allow: field === "allow", pattern: value });
  }
  const named = groups.filter((group) => group.agents.includes(token));
  const chosen = named.length ? named : groups.filter((group) => group.agents.includes("*"));
  let best: Rule | null = null;
  for (const rule of chosen.flatMap((group) => group.rules)) {
    if (!matches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    )
      best = rule;
  }
  return best ? best.allow : true;
}
