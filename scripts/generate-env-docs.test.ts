import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DATABASE_FILE_SECRET_KEYS, FILE_SECRET_KEYS } from "@openvalens/config/file-secrets";

import {
  buildModel,
  EnvDocsError,
  generateDocument,
  loadSources,
  loadVersion,
  OUTPUT_PATH,
  SCHEMA_SOURCES,
} from "./generate-env-docs";
import type { ResolvedSection, ResolvedVariable, SchemaSourceId } from "./generate-env-docs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REAL = loadSources(ROOT);

const HEADER = "# @defaultRequired=true\n# @defaultSensitive=true\n# ---\n";

function synthetic(
  overrides: Partial<Record<SchemaSourceId, string>>,
): Partial<Record<SchemaSourceId, string>> {
  return {
    server: HEADER,
    web: HEADER,
    native: HEADER,
    db: "# ---\n",
    ...overrides,
  };
}

function section(model: ResolvedSection[], id: SchemaSourceId): ResolvedSection {
  const found = model.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing section ${id}`);
  return found;
}

function byKey(target: ResolvedSection, key: string): ResolvedVariable {
  const found = target.variables.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing key ${key}`);
  return found;
}

describe("real committed schemas", () => {
  test("section variable counts", () => {
    const model = buildModel(REAL);
    expect(Object.fromEntries(model.map((entry) => [entry.id, entry.variables.length]))).toEqual({
      server: 45,
      web: 2,
      native: 2,
      db: 2,
    });
    expect(section(model, "server").variables.filter((v) => v.sensitive)).toHaveLength(14);
  });

  test("_FILE support is limited to the documented keys", () => {
    const model = buildModel(REAL);
    const serverFiles = section(model, "server")
      .variables.filter((v) => v.fileVariant)
      .map((v) => v.key)
      .sort();
    expect(serverFiles).toEqual([...FILE_SECRET_KEYS].sort());
    expect(
      section(model, "db")
        .variables.filter((v) => v.fileVariant)
        .map((v) => v.key),
    ).toEqual([...DATABASE_FILE_SECRET_KEYS]);
    expect(section(model, "web").variables.some((v) => v.fileVariant)).toBe(false);
    expect(section(model, "native").variables.some((v) => v.fileVariant)).toBe(false);
  });

  test("database imports picked server keys with inherited metadata", () => {
    const db = section(buildModel(REAL), "db");
    expect(db.variables.map((v) => v.key)).toEqual(["NODE_ENV", "DATABASE_URL"]);
    const nodeEnv = byKey(db, "NODE_ENV");
    expect(nodeEnv.sensitive).toBe(false);
    expect(nodeEnv.required).toBe(true);
    expect(nodeEnv.defaultText).toBe("`development`");
    expect(nodeEnv.originPath).toBe("apps/server/.env.schema");
    const databaseUrl = byKey(db, "DATABASE_URL");
    expect(databaseUrl.sensitive).toBe(true);
    expect(databaseUrl.required).toBe(true);
    expect(databaseUrl.type).toBe("string(minLength=1)");
    expect(databaseUrl.fileVariant).toBe(true);
  });

  test("committed reference matches generation (drift guard)", () => {
    const committed = readFileSync(resolve(ROOT, OUTPUT_PATH), "utf8");
    expect(generateDocument(REAL, loadVersion(ROOT))).toBe(committed);
  });

  test("states the root package.json version it applies to", () => {
    const version = loadVersion(ROOT);
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(generateDocument(REAL, version)).toContain(`**Applies to:** OpenValens ${version}\n`);
    expect(generateDocument(REAL)).not.toContain("Applies to");
  });

  test("generation is deterministic and free of paths or timestamps", () => {
    const first = generateDocument(REAL);
    const second = generateDocument(REAL);
    expect(first).toBe(second);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(first).not.toContain("/Users/");
    expect(first).not.toContain(ROOT);
  });

  test("headings link every source schema and the secrets policy", () => {
    const doc = generateDocument(REAL);
    for (const source of SCHEMA_SOURCES) {
      expect(doc).toContain(`../../${source.path}`);
    }
    expect(doc).toContain("../../CONTRIBUTING.md#file-based-secrets");
  });

  test("loadSources reads only the allowlisted schemas from the given root", () => {
    expect(Object.keys(loadSources(ROOT)).sort()).toEqual(["db", "native", "server", "web"]);
  });
});

describe("resolution semantics", () => {
  test("optional/public/sensitive annotations resolve", () => {
    const server =
      HEADER +
      `
# @optional @type=string
OPT=

# @sensitive=false @type=string
NOT_SECRET=

# @public @type=string
PUB=

# @public=false @type=string
PUB_FALSE=
`;
    const resolved = section(buildModel(synthetic({ server })), "server");
    expect(byKey(resolved, "OPT").required).toBe(false);
    expect(byKey(resolved, "NOT_SECRET").sensitive).toBe(false);
    expect(byKey(resolved, "PUB").sensitive).toBe(false);
    expect(byKey(resolved, "PUB_FALSE").sensitive).toBe(true);
  });

  test("unset and quoted-empty defaults are distinguished", () => {
    const server =
      HEADER +
      `
# @public @type=string
UNSET_KEY=

# @public @type=string
EMPTY_KEY=""
`;
    const resolved = section(buildModel(synthetic({ server })), "server");
    expect(byKey(resolved, "UNSET_KEY").defaultText).toBe("—");
    expect(byKey(resolved, "EMPTY_KEY").defaultText).toBe('`""`');
  });

  test("type annotations render human-legibly with constraints", () => {
    const server =
      HEADER +
      `
# @public @type=string(minLength=32)
MIN_LEN=

# @public @type=email
MAIL=

# @public @type=enum(a, b, c)
CHOICE=
`;
    const resolved = section(buildModel(synthetic({ server })), "server");
    expect(byKey(resolved, "MIN_LEN").type).toBe("string(minLength=32)");
    expect(byKey(resolved, "MAIL").type).toBe("email");
    expect(byKey(resolved, "CHOICE").type).toBe("enum(a, b, c)");
  });

  test("descriptions escape pipes and newlines but keep code spans", () => {
    const server =
      HEADER +
      `
# first | line
# second \`line\`
# @public @type=string
DESC=
`;
    const resolved = section(buildModel(synthetic({ server })), "server");
    expect(byKey(resolved, "DESC").description).toBe("first \\| line<br>second `line`");
  });

  test("_FILE is never offered for web or native, even when sensitive", () => {
    const web = HEADER + "\n# @sensitive @type=string\nSECRET=\n";
    const native = HEADER + "\n# @sensitive @type=string\nSECRET=\n";
    const model = buildModel(synthetic({ web, native }));
    expect(byKey(section(model, "web"), "SECRET").sensitive).toBe(true);
    expect(byKey(section(model, "native"), "SECRET").sensitive).toBe(true);
    expect(section(model, "web").variables.every((v) => !v.fileVariant)).toBe(true);
    expect(section(model, "native").variables.every((v) => !v.fileVariant)).toBe(true);
  });

  test("wildcard pick matches an anchored literal glob", () => {
    const server =
      HEADER +
      `
# @public @type=string
DATABASE_URL=

# @public @type=string
DATABASE_EXTRA=

# @public @type=string
OTHER=
`;
    const sources = synthetic({
      server,
      db: "# @import(../../apps/server/, pick=[DATABASE_*])\n# ---\n",
    });
    const db = section(buildModel(sources), "db");
    expect(db.variables.map((v) => v.key)).toEqual(["DATABASE_URL", "DATABASE_EXTRA"]);
  });
});

describe("fails closed", () => {
  const CANARY = "CANARY_default_3f9a2b7c8d1e";
  const canarySchema =
    HEADER +
    `
# @type=string
SECRET_CANARY=${CANARY}

# @type=string
QUOTED_CANARY="${CANARY}_quoted"

# @public @type=string
PUBLIC_VALUE=visible
`;

  test("sensitive defaults are never rendered", () => {
    const doc = generateDocument(synthetic({ server: canarySchema }));
    expect(doc).not.toContain(CANARY);
    expect(doc).toContain("Hidden (sensitive)");
    expect(doc).toContain("visible");
  });

  test("sensitive values never appear in error messages", () => {
    const broken = canarySchema + "\n# @mystery\nBROKEN=1\n";
    let message = "";
    try {
      buildModel(synthetic({ server: broken }));
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toContain("unsupported decorator @mystery");
    expect(message).not.toContain(CANARY);
  });

  test("unknown decorators fail closed", () => {
    const server = HEADER + "\n# @mystery @type=string\nKEY=value\n";
    expect(() => buildModel(synthetic({ server }))).toThrow(EnvDocsError);
    expect(() => buildModel(synthetic({ server }))).toThrow(/unsupported decorator/);
  });

  test("ambiguous @public and @sensitive fail closed", () => {
    const server = HEADER + "\n# @public @sensitive @type=string\nKEY=value\n";
    expect(() => buildModel(synthetic({ server }))).toThrow(/ambiguous/);
  });

  test("unsupported @type shapes fail closed", () => {
    const server = HEADER + "\n# @public @type=string(minLength=32)\nKEY=value\n";
    expect(() => buildModel(synthetic({ server }))).not.toThrow();
    const bad = HEADER + "\n# @public @type=[a, b]\nKEY=value\n";
    expect(() => buildModel(synthetic({ server: bad }))).toThrow(/unsupported @type/);
  });

  test("unknown import targets fail closed without IO", () => {
    const sources = synthetic({
      db: "# @import(../../../etc/passwd/, pick=[X])\n# ---\n",
    });
    expect(() => buildModel(sources)).toThrow(/unsupported @import target/);
  });

  test("cyclic imports fail closed", () => {
    const sources = synthetic({
      server: "# @import(../web/, pick=[X])\n" + HEADER,
      web: "# @import(../server/, pick=[Y])\n" + HEADER,
    });
    expect(() => buildModel(sources)).toThrow(/cyclic/);
  });

  test("parse errors are generic and leak no snippet or value", () => {
    const bad = '# @defaultRequired=true\n# ---\nKEY="unterminated CANARY_LEAK_123\n';
    let message = "";
    try {
      buildModel(synthetic({ server: bad }));
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toContain("schema parse error");
    expect(message).toContain("apps/server/.env.schema");
    expect(message).not.toContain("CANARY_LEAK_123");
    expect(message).not.toContain("unterminated");
  });

  test("ambient process.env is never read", () => {
    const key = "OPENVALENS_DOCS_CANARY";
    const original = process.env[key];
    process.env[key] = "AMBIENT_CANARY_9f3c";
    try {
      const withAmbient = generateDocument(synthetic({ server: canarySchema }));
      delete process.env[key];
      const withoutAmbient = generateDocument(synthetic({ server: canarySchema }));
      expect(withAmbient).toBe(withoutAmbient);
      expect(withAmbient).not.toContain("AMBIENT_CANARY_9f3c");
    } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });
});

describe("duplicate keys fail closed", () => {
  test("local/local duplicate", () => {
    const server = HEADER + "\n# @public @type=string\nDUP=a\n\n# @public @type=string\nDUP=b\n";
    expect(() => buildModel(synthetic({ server }))).toThrow(/duplicate variable key/);
  });

  test("inherited/inherited duplicate from a repeated @import", () => {
    const sources = synthetic({
      server: HEADER + "\n# @public @type=string\nNODE_ENV=development\n",
      db:
        "# @import(../../apps/server/, pick=[NODE_ENV])\n" +
        "# @import(../../apps/server/, pick=[NODE_ENV])\n# ---\n",
    });
    expect(() => buildModel(sources)).toThrow(/duplicate variable key/);
  });

  test("inherited/local duplicate", () => {
    const sources = synthetic({
      server: HEADER + "\n# @public @type=string\nNODE_ENV=development\n",
      db:
        "# @import(../../apps/server/, pick=[NODE_ENV])\n# ---\n\n" +
        "# @public @type=string\nNODE_ENV=x\n",
    });
    expect(() => buildModel(sources)).toThrow(/duplicate variable key/);
  });

  test("several picks matching one variable are not duplicated", () => {
    const sources = synthetic({
      server: HEADER + "\n# @public @type=string\nDATABASE_URL=\n",
      db: "# @import(../../apps/server/, pick=[DATABASE_*, DATABASE_URL])\n# ---\n",
    });
    const db = section(buildModel(sources), "db");
    expect(db.variables.map((v) => v.key)).toEqual(["DATABASE_URL"]);
  });
});

describe("split header blocks", () => {
  test("an import in an earlier block is preserved", () => {
    const sources = synthetic({
      server: HEADER + "\n# @public @type=string\nNODE_ENV=development\n",
      db: "# @import(../../apps/server/, pick=[NODE_ENV])\n\n# @defaultRequired=true\n# ---\n",
    });
    const db = section(buildModel(sources), "db");
    expect(db.variables.map((v) => v.key)).toEqual(["NODE_ENV"]);
  });

  test("an unknown earlier header annotation fails closed", () => {
    const sources = synthetic({ server: "# @mysteryHeader\n\n" + HEADER });
    expect(() => buildModel(sources)).toThrow(/unsupported header decorator @mysteryHeader/);
  });

  test("defaults split across blocks are retained", () => {
    const server =
      "# @defaultRequired=false\n\n# @defaultSensitive=true\n# ---\n\n# @type=string\nS=value\n";
    const resolved = section(buildModel(synthetic({ server })), "server");
    expect(byKey(resolved, "S").required).toBe(false);
    expect(byKey(resolved, "S").sensitive).toBe(true);

    const canary = server.replace("S=value", "S=CANARY_SPLIT_777");
    const doc = generateDocument(synthetic({ server: canary }));
    expect(doc).not.toContain("CANARY_SPLIT_777");
    expect(doc).toContain("Hidden (sensitive)");
  });
});
