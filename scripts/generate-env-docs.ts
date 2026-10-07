#!/usr/bin/env bun
/**
 * Generate `docs/reference/env.md` from the committed `.env.schema` files
 * (Issue #58).
 *
 * Bounded and deterministic: it uses `@env-spec/parser` (the parser Varlock
 * ships) to read the four public schemas and emits a single Markdown reference.
 * It is pure with respect to the environment — it never reads `process.env`,
 * never loads a `.env` file, and never resolves `*_FILE` values. The `_FILE`
 * policy is imported as constants from `@openvalens/config/file-secrets` so the
 * documented keys cannot drift from the runtime resolver.
 *
 * Regenerate with `bun run docs:generate`; CI verifies with `bun run docs:check`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ParsedEnvSpecArrayLiteral,
  ParsedEnvSpecFunctionArgs,
  ParsedEnvSpecFunctionCall,
  ParsedEnvSpecKeyValuePair,
  ParsedEnvSpecStaticValue,
  parseEnvSpecDotEnvFile,
} from "@env-spec/parser";
import type {
  ParsedEnvSpecConfigItem,
  ParsedEnvSpecDecorator,
  ParsedEnvSpecFile,
} from "@env-spec/parser";
import { DATABASE_FILE_SECRET_KEYS, FILE_SECRET_KEYS } from "@openvalens/config/file-secrets";

// ---------------------------------------------------------------------------
// Schema allowlist
// ---------------------------------------------------------------------------

export type SchemaSourceId = "server" | "web" | "native" | "db";

interface SchemaSource {
  id: SchemaSourceId;
  label: string;
  /** Repository-relative path. */
  path: string;
}

export const SCHEMA_SOURCES: readonly SchemaSource[] = [
  { id: "server", label: "Server", path: "apps/server/.env.schema" },
  { id: "web", label: "Web", path: "apps/web/.env.schema" },
  { id: "native", label: "Native", path: "apps/native/.env.schema" },
  { id: "db", label: "Database", path: "packages/db/.env.schema" },
];

const SCHEMA_PATH_BY_ID = new Map<SchemaSourceId, string>(
  SCHEMA_SOURCES.map((source) => [source.id, source.path]),
);
const SCHEMA_ID_BY_PATH = new Map<string, SchemaSourceId>(
  SCHEMA_SOURCES.map((source) => [source.path, source.id]),
);

/** Repository-relative target of the generated reference. */
export const OUTPUT_PATH = "docs/reference/env.md";

/** Per-key decorators this generator understands. Anything else fails closed. */
const ITEM_DECORATORS = new Set(["public", "sensitive", "optional", "type"]);
/** Header decorators this generator understands. Anything else fails closed. */
const HEADER_DECORATORS = new Set([
  "defaultRequired",
  "defaultSensitive",
  "currentEnv",
  "generateTsTypes",
  "import",
]);

const UNSET = "—";
const HIDDEN = "Hidden (sensitive)";

// ---------------------------------------------------------------------------
// Errors (public and value-free)
// ---------------------------------------------------------------------------

/** Error raised for any unsupported or ambiguous schema construct. */
export class EnvDocsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvDocsError";
  }
}

/**
 * Fail closed with a message naming only the schema path and key — never a
 * parsed value, raw source snippet or parser error.
 */
function fail(code: string, context: { schema?: string; key?: string } = {}): never {
  const where = [context.schema, context.key ? `key ${context.key}` : undefined]
    .filter((part): part is string => Boolean(part))
    .join(" / ");
  throw new EnvDocsError(where ? `${code} (${where})` : code);
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function headerDecorators(file: ParsedEnvSpecFile): Record<string, ParsedEnvSpecDecorator> {
  // The parser merges decorators across all header comment blocks; using the
  // merged view prevents dropping metadata (or imports) that a blank line
  // splits into an earlier block.
  return file.decoratorsObject ?? {};
}

/** Parse a schema, converting any parser error into a value-free EnvDocsError. */
function parseSchema(text: string, schema: string): ParsedEnvSpecFile {
  try {
    return parseEnvSpecDotEnvFile(text);
  } catch {
    return fail("schema parse error", { schema });
  }
}

function decoratorBoolean(decorator: ParsedEnvSpecDecorator, schema: string, key: string): boolean {
  const value = decorator.value;
  if (value instanceof ParsedEnvSpecStaticValue && typeof value.value === "boolean") {
    return value.value;
  }
  return fail("unsupported boolean annotation", { schema, key });
}

function renderTypeArg(node: unknown, schema: string, key: string): string {
  if (node instanceof ParsedEnvSpecStaticValue) return String(node.value);
  if (node instanceof ParsedEnvSpecKeyValuePair) {
    return `${node.key}=${renderTypeArg(node.value, schema, key)}`;
  }
  if (node instanceof ParsedEnvSpecFunctionCall) {
    const args = node.data.args.values.map((arg) => renderTypeArg(arg, schema, key)).join(", ");
    return `${node.name}(${args})`;
  }
  return fail("unsupported @type argument", { schema, key });
}

function renderType(value: unknown, schema: string, key: string): string {
  if (value instanceof ParsedEnvSpecStaticValue) return String(value.value);
  if (value instanceof ParsedEnvSpecFunctionCall) {
    const args = value.data.args.values.map((arg) => renderTypeArg(arg, schema, key)).join(", ");
    return `${value.name}(${args})`;
  }
  return fail("unsupported @type value", { schema, key });
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** Escape content that must survive inside a Markdown table cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

/** Render a raw literal (default) as an escaped inline code span. */
function renderLiteral(value: string): string {
  return `\`${escapeCell(value).replace(/`/g, "\\`")}\``;
}

/** Descriptions are schema Markdown: keep intentional code spans. */
function renderDescription(text: string): string {
  return escapeCell(text);
}

function renderDefault(item: ParsedEnvSpecConfigItem, sensitive: boolean, schema: string): string {
  const value = item.value;
  if (value === undefined) return UNSET;
  if (!(value instanceof ParsedEnvSpecStaticValue)) {
    // A resolver/function default is never executed; fail closed instead of
    // documenting a value we cannot prove.
    return fail("unsupported default value", { schema, key: item.key });
  }
  if (sensitive) return HIDDEN;
  const raw = value.value;
  if (raw === "") {
    const quote = value.data.quote ?? '"';
    return `\`${quote}${quote}\``;
  }
  if (typeof raw === "boolean" || typeof raw === "number") {
    return renderLiteral(String(raw));
  }
  if (typeof raw === "string") return renderLiteral(raw);
  return fail("unsupported default value type", { schema, key: item.key });
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedVariable {
  key: string;
  required: boolean;
  sensitive: boolean;
  type: string;
  defaultText: string;
  description: string;
  fileVariant: boolean;
  originPath: string;
}

export interface ResolvedSection {
  id: SchemaSourceId;
  label: string;
  path: string;
  variables: ResolvedVariable[];
}

function fileVariantFor(id: SchemaSourceId, key: string): boolean {
  if (id === "server") return (FILE_SECRET_KEYS as readonly string[]).includes(key);
  if (id === "db") {
    return (DATABASE_FILE_SECRET_KEYS as readonly string[]).includes(key);
  }
  return false;
}

function resolveDefaults(
  file: ParsedEnvSpecFile,
  schema: string,
): { required: boolean; sensitive: boolean } {
  const decorators = headerDecorators(file);
  for (const name of Object.keys(decorators)) {
    if (!HEADER_DECORATORS.has(name)) {
      fail(`unsupported header decorator @${name}`, { schema });
    }
  }
  const required = decorators.defaultRequired
    ? decoratorBoolean(decorators.defaultRequired, schema, "defaultRequired")
    : true;
  const sensitive = decorators.defaultSensitive
    ? decoratorBoolean(decorators.defaultSensitive, schema, "defaultSensitive")
    : true;
  return { required, sensitive };
}

function resolveItem(
  item: ParsedEnvSpecConfigItem,
  schema: string,
  defaults: { required: boolean; sensitive: boolean },
): ResolvedVariable {
  const decorators = item.decoratorsObject;
  for (const name of Object.keys(decorators)) {
    if (!ITEM_DECORATORS.has(name)) {
      fail(`unsupported decorator @${name}`, { schema, key: item.key });
    }
  }
  if (decorators.public && decorators.sensitive) {
    fail("ambiguous @public and @sensitive", { schema, key: item.key });
  }

  let sensitive = defaults.sensitive;
  if (decorators.public) {
    sensitive = !decoratorBoolean(decorators.public, schema, item.key);
  } else if (decorators.sensitive) {
    sensitive = decoratorBoolean(decorators.sensitive, schema, item.key);
  }

  let required = defaults.required;
  if (decorators.optional) {
    required = !decoratorBoolean(decorators.optional, schema, item.key);
  }

  return {
    key: item.key,
    required,
    sensitive,
    type: decorators.type ? renderType(decorators.type.value, schema, item.key) : UNSET,
    defaultText: renderDefault(item, sensitive, schema),
    description: renderDescription(item.description),
    fileVariant: false,
    originPath: schema,
  };
}

interface ImportSpec {
  targetId: SchemaSourceId;
  picks: string[];
}

/** Anchored literal-glob match for `@import` picks (`*` is the only wildcard). */
function matchesPick(key: string, pattern: string): boolean {
  if (!pattern.includes("*")) return key === pattern;
  const escaped = pattern
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(key);
}

function parseImport(
  decorator: ParsedEnvSpecDecorator,
  fromPath: string,
  schema: string,
): ImportSpec {
  const args =
    decorator.bareFnArgs ??
    (decorator.value instanceof ParsedEnvSpecFunctionArgs ? decorator.value : undefined);
  if (!args) return fail("unsupported @import form", { schema });
  const values = args.values;

  const pathNode = values[0];
  if (!(pathNode instanceof ParsedEnvSpecStaticValue) || typeof pathNode.value !== "string") {
    return fail("unsupported @import path", { schema });
  }

  // Normalize against the allowlist before any IO so traversal cannot escape.
  const candidate = posix.normalize(
    posix.join(posix.dirname(fromPath), pathNode.value, ".env.schema"),
  );
  const targetId = SCHEMA_ID_BY_PATH.get(candidate);
  if (!targetId) return fail("unsupported @import target", { schema });

  const picks: string[] = [];
  for (const node of values.slice(1)) {
    if (!(node instanceof ParsedEnvSpecKeyValuePair) || node.key !== "pick") {
      return fail("unsupported @import argument", { schema });
    }
    if (!(node.value instanceof ParsedEnvSpecArrayLiteral)) {
      return fail("unsupported @import pick", { schema });
    }
    for (const entry of node.value.values) {
      if (!(entry instanceof ParsedEnvSpecStaticValue) || typeof entry.value !== "string") {
        return fail("unsupported @import pick entry", { schema });
      }
      picks.push(entry.value);
    }
  }
  if (picks.length === 0) return fail("empty @import pick", { schema });
  return { targetId, picks };
}

function collectImports(file: ParsedEnvSpecFile, fromPath: string): ImportSpec[] {
  // Merged across all header blocks, so an import split off by a blank line is
  // not silently dropped.
  const decorators = file.decoratorsArray ?? [];
  return decorators
    .filter((decorator) => decorator.name === "import")
    .map((decorator) => parseImport(decorator, fromPath, fromPath));
}

/**
 * Build the resolved model from explicit schema texts (pure: no IO, no env).
 * Unknown or ambiguous constructs fail closed via {@link EnvDocsError}.
 */
export function buildModel(sources: Partial<Record<SchemaSourceId, string>>): ResolvedSection[] {
  const cache = new Map<SchemaSourceId, ResolvedVariable[]>();

  const resolveSection = (id: SchemaSourceId, stack: SchemaSourceId[]): ResolvedVariable[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    const schema = SCHEMA_PATH_BY_ID.get(id);
    if (!schema) return fail("unknown schema source", { schema: id });
    if (stack.includes(id)) return fail("cyclic @import", { schema });
    const text = sources[id];
    if (typeof text !== "string") return fail("missing schema source", { schema });

    const file = parseSchema(text, schema);
    const defaults = resolveDefaults(file, schema);
    const variables: ResolvedVariable[] = [];
    const seen = new Set<string>();
    const push = (variable: ResolvedVariable): void => {
      if (seen.has(variable.key)) {
        return fail("duplicate variable key", { schema, key: variable.key });
      }
      seen.add(variable.key);
      variables.push(variable);
    };

    for (const spec of collectImports(file, schema)) {
      const inherited = resolveSection(spec.targetId, [...stack, id]);
      for (const variable of inherited) {
        if (!spec.picks.some((pick) => matchesPick(variable.key, pick))) continue;
        // Preserve the inherited origin; only the `_FILE` policy is local.
        push({ ...variable, fileVariant: fileVariantFor(id, variable.key) });
      }
    }

    for (const item of file.configItems) {
      const resolved = resolveItem(item, schema, defaults);
      resolved.fileVariant = fileVariantFor(id, item.key);
      push(resolved);
    }

    cache.set(id, variables);
    return variables;
  };

  return SCHEMA_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    path: source.path,
    variables: resolveSection(source.id, []),
  }));
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function sourceLink(path: string): string {
  // docs/reference/env.md -> repository root is two levels up.
  return `../../${path}`;
}

/**
 * Render a Markdown table with the same column padding oxfmt applies, so the
 * generated file is already formatter-stable (and `docs:check` is exact).
 */
function renderTable(header: string[], rows: string[][]): string[] {
  const widths = header.map((cell, column) =>
    rows.reduce((max, row) => Math.max(max, (row[column] ?? "").length), Math.max(3, cell.length)),
  );
  const renderRow = (cells: string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 3)).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [renderRow(header), separator, ...rows.map(renderRow)];
}

export function renderMarkdown(sections: ResolvedSection[]): string {
  const lines: string[] = [];

  lines.push("# Environment reference");
  lines.push("");
  lines.push(
    "> **Generated file — do not edit by hand.** Regenerate with " +
      "`bun run docs:generate`; CI fails if this file is stale (`bun run docs:check`).",
  );
  lines.push("");
  lines.push(
    "Each section below is generated from the committed `.env.schema` file linked " +
      "in its heading. Defaults are the schema defaults only; at runtime the process " +
      "environment supplies the actual values.",
  );
  lines.push("");
  lines.push("## Legend");
  lines.push("");
  lines.push(
    "- **Required** — the schema marks the variable required (`@defaultRequired` / `@optional`). " +
      "This is independent of whether a default exists.",
  );
  lines.push(
    "- **Sensitive** — marked as sensitive for Varlock redaction; sensitive defaults are never included here.",
  );
  lines.push("- **Type** — the `@type` constraint declared in the schema.");
  lines.push(
    `- **Default** — the schema default. \`${UNSET}\` means unset; \`${HIDDEN}\` means a ` +
      "sensitive default exists but is not shown.",
  );
  lines.push("- **\\_FILE** — `Yes` when a `<KEY>_FILE` companion is supported for this variable.");
  lines.push("");

  for (const section of sections) {
    lines.push(`## ${section.label} — [\`${section.path}\`](${sourceLink(section.path)})`);
    lines.push("");
    if (section.variables.length === 0) {
      lines.push("_No variables._");
      lines.push("");
      continue;
    }
    const header = ["Variable", "Required", "Sensitive", "Type", "Default", "Description", "_FILE"];
    const rows = section.variables.map((variable) => [
      `\`${variable.key}\``,
      variable.required ? "Yes" : "No",
      variable.sensitive ? "Yes" : "No",
      escapeCell(variable.type),
      variable.defaultText,
      variable.description,
      variable.fileVariant ? "Yes" : "No",
    ]);
    lines.push(...renderTable(header, rows));
    lines.push("");
  }

  lines.push("## File-based secrets");
  lines.push("");
  lines.push(
    "Every sensitive server variable whose `_FILE` column is `Yes` also accepts a " +
      "`<KEY>_FILE` companion pointing at a file whose contents become the value " +
      "(Docker/Kubernetes secret mounts, systemd `LoadCredential`, etc.). The " +
      "database profile resolves only `DATABASE_URL` through `DATABASE_URL_FILE`.",
  );
  lines.push("");
  lines.push(
    "- `_FILE` values are read from the **runtime environment**; a standalone " +
      "`varlock load` / `varlock run` does **not** resolve them.",
  );
  lines.push(
    "- Relative paths resolve against the process working directory; absolute paths " +
      "such as `/run/secrets/<key>` are recommended in containers.",
  );
  lines.push(
    "- File-resolution errors fail closed and name keys only — never paths or contents. Values must " +
      "be strict UTF-8, non-empty, at most 64 KiB, and free of NUL bytes.",
  );
  lines.push("");
  lines.push(
    "See [File-based secrets in CONTRIBUTING.md](../../CONTRIBUTING.md#file-based-secrets) " +
      "for the full policy.",
  );
  lines.push("");
  lines.push("## Bootstrap runtime environment");
  lines.push("");
  lines.push(
    "The defaults listed above are the schema defaults only. At runtime the process " +
      "environment (or a `.env` file loaded by Bun) supplies the actual values, and " +
      "Varlock validates them against the same schema. `_FILE` companions are not a " +
      "Varlock feature — this repository's bootstrap code resolves them before Varlock " +
      "runs.",
  );
  lines.push("");

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Convenience wrapper: build the model and render it. */
export function generateDocument(sources: Partial<Record<SchemaSourceId, string>>): string {
  return renderMarkdown(buildModel(sources));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function repositoryRoot(): string {
  // Fixed to the script location, never the current working directory.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/** Read the four allowlisted schemas from `root` (read-only). */
export function loadSources(root: string): Record<SchemaSourceId, string> {
  const sources = {} as Record<SchemaSourceId, string>;
  for (const source of SCHEMA_SOURCES) {
    sources[source.id] = readFileSync(resolve(root, source.path), "utf8");
  }
  return sources;
}

function main(): void {
  const root = repositoryRoot();
  const target = resolve(root, OUTPUT_PATH);
  const sources = loadSources(root);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, generateDocument(sources), "utf8");
  process.stdout.write(`Wrote ${relative(root, target)}\n`);
}

if (import.meta.main) main();
