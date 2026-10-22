import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ORIGIN = "https://wger.de";
const API = `${ORIGIN}/api/v2/`;
const MAX_PAGES = 100;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_MS = 120_000;
const LICENSES = ["license", "language"] as const;

function fail(message: string): never {
  throw new Error(message);
}
function normalizeLicense(raw: any, lookup: Map<number, any>) {
  const value = typeof raw === "number" ? lookup.get(raw) : raw;
  if (!value) return raw;
  const rawCode = String(value.short_name ?? value.code ?? "");
  const rawUrl = String(value.url ?? value.license_url ?? "");
  const aliases: Record<string, [string, string]> = {
    "CC-BY-SA 3": ["CC-BY-SA-3.0", "https://creativecommons.org/licenses/by-sa/3.0/"],
    "CC-BY-SA 4": ["CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
    CC0: ["CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  };
  const pair = aliases[rawCode];
  const aliasUrl = rawUrl.replace(/\/deed\.en$/, "/").replace(/^http:\/\//, "https://");
  if (pair && pair[1] === aliasUrl) return { id: value.id, short_name: pair[0], url: pair[1] };
  return { id: value.id, short_name: rawCode, url: rawUrl };
}
function safeSource(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const url = new URL(value, ORIGIN);
  if (url.protocol !== "https:" || url.username || url.password)
    fail("Invalid source URL in public response.");
  return url.href;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun run exercises:prepare --output <snapshot.json> [--media-dir <directory>]\nCaptures a bounded complete public wger snapshot. It never opens a database; run exercises:import --file <snapshot.json> --apply separately to import.",
    );
    return;
  }
  const outputAt = args.indexOf("--output");
  const mediaAt = args.indexOf("--media-dir");
  if (
    outputAt < 0 ||
    !args[outputAt + 1] ||
    args.some(
      (arg, i) =>
        !["--output", "--media-dir"].includes(arg) && i !== outputAt + 1 && i !== mediaAt + 1,
    )
  )
    fail("Invalid arguments; use --help.");
  if (mediaAt >= 0)
    fail("Optional media staging is not yet available; no upstream media is fetched.");
  const started = Date.now();
  let totalBytes = 0;
  const fetched: Array<{ url: string; retrievedAt: string; sha256: string; bytes: number }> = [];
  async function get(url: string) {
    if (Date.now() - started > MAX_MS) fail("Capture time limit exceeded.");
    const parsed = new URL(url);
    if (
      parsed.origin !== ORIGIN ||
      parsed.protocol !== "https:" ||
      !parsed.pathname.startsWith("/api/v2/")
    )
      fail("Unexpected capture URL.");
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(Math.max(1, MAX_MS - (Date.now() - started))),
    });
    if (response.status >= 300 && response.status < 400) fail("Unexpected upstream redirect.");
    if (!response.ok) fail(`wger request failed (${response.status}).`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 10 * 1024 * 1024 || totalBytes + declaredLength > MAX_BYTES)
      fail("Capture byte limit exceeded.");
    if (!response.body) fail("Empty wger response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 10 * 1024 * 1024 || totalBytes + length > MAX_BYTES) {
        await reader.cancel();
        fail("Capture byte limit exceeded.");
      }
      chunks.push(part.value);
    }
    if (
      declaredLength > 0 &&
      !response.headers.has("content-encoding") &&
      length !== declaredLength
    )
      fail("Truncated upstream response.");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > 10 * 1024 * 1024 || totalBytes > MAX_BYTES)
      fail("Capture byte limit exceeded.");
    const retrievedAt = new Date().toISOString();
    fetched.push({
      url,
      retrievedAt,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    });
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as any;
    } catch {
      fail("Invalid JSON from wger.");
    }
  }
  const lookup: Record<string, any[]> = {};
  for (const endpoint of LICENSES) {
    const values: any[] = [];
    let next: string | null = `${API}${endpoint}/?format=json`;
    const seen = new Set<string>();
    const lookupIds = new Set<number>();
    let lookupCount: number | null = null;
    while (next) {
      if (seen.has(next) || seen.size >= MAX_PAGES)
        fail("Lookup pagination loop or page limit exceeded.");
      seen.add(next);
      const page = await get(next);
      if (!Array.isArray(page.results) || !Number.isSafeInteger(page.count) || page.count < 0)
        fail("Invalid lookup page.");
      if (lookupCount === null) lookupCount = page.count;
      if (lookupCount !== page.count) fail("Inconsistent lookup result count.");
      for (const entry of page.results) {
        if (!Number.isSafeInteger(entry.id) || entry.id < 1 || lookupIds.has(entry.id))
          fail("Invalid or duplicate lookup ID.");
        lookupIds.add(entry.id);
        values.push(entry);
      }
      next = page.next;
      if (next && new URL(next, ORIGIN).origin !== ORIGIN) fail("Unexpected lookup next URL.");
    }
    if (values.length !== lookupCount) fail("Incomplete lookup capture.");
    lookup[endpoint === "license" ? "licenses" : "languages"] = values;
  }
  const all: any[] = [];
  let next: string | null = `${API}exerciseinfo/?format=json`;
  let declaredCount: number | null = null;
  const seenPages = new Set<string>();
  const ids = new Set<number>();
  while (next) {
    if (seenPages.has(next) || seenPages.size >= MAX_PAGES)
      fail("Exercise pagination loop or page limit exceeded.");
    seenPages.add(next);
    const page = await get(next);
    if (!Array.isArray(page.results) || !Number.isSafeInteger(page.count) || page.count < 0)
      fail("Invalid exercise page.");
    if (declaredCount === null) declaredCount = page.count;
    if (declaredCount !== page.count) fail("Inconsistent exercise result count.");
    for (const item of page.results) {
      if (!Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id))
        fail("Invalid or duplicate exercise ID.");
      ids.add(item.id);
      all.push(item);
    }
    next = page.next;
    if (next && new URL(next, ORIGIN).origin !== ORIGIN) fail("Unexpected exercise next URL.");
  }
  if (all.length !== declaredCount) fail("Incomplete exercise capture.");
  const languages = new Map<number, any>(lookup.languages.map((x) => [x.id, x]));
  const licenses = new Map<number, any>(lookup.licenses.map((x) => [x.id, x]));
  const results = all.map((row) => ({
    ...row,
    sourceUrl: `${API}exerciseinfo/${row.id}/`,
    translations: (row.translations ?? []).map((translation: any) => ({
      ...translation,
      language: languages.get(translation.language) ?? translation.language,
      license: normalizeLicense(translation.license, licenses),
      author: translation.license_author ?? translation.author ?? null,
      description: translation.description_source ?? null,
      instructions: translation.description_source ? translation.description : null,
      sourceUrl: safeSource(
        translation.license_derivative_source_url,
        `${API}exerciseinfo/${row.id}/`,
      ),
      attribution:
        [
          translation.license_derivative_source_url,
          translation.license_author_url,
          translation.license_author,
        ]
          .filter(Boolean)
          .join("; ") || null,
    })),
    license: normalizeLicense(row.license, licenses),
    baseLicense: normalizeLicense(row.license, licenses),
    author: row.license_author ?? null,
    baseAttribution:
      [row.license_derivative_source_url, row.license_author_url, row.license_author]
        .filter(Boolean)
        .join("; ") || null,
    images: (row.images ?? []).map((image: any) => ({
      ...image,
      license: normalizeLicense(image.license, licenses),
      author: image.license_author ?? image.author ?? null,
      attribution:
        [
          image.license_derivative_source_url,
          image.license_author_url,
          image.license_author ?? image.author,
        ]
          .filter(Boolean)
          .join("; ") || null,
      image: image.image,
    })),
  }));
  const snapshotAt = new Date().toISOString();
  const bundle = {
    source: "wger",
    complete: true,
    snapshotVersion: `wger-${snapshotAt}`,
    snapshotAt,
    results,
    rawRecords: all,
    rawLookups: lookup,
    lookups: {
      licenses: Object.fromEntries(lookup.licenses.map((x) => [String(x.id), x])),
      languages: Object.fromEntries(lookup.languages.map((x) => [String(x.id), x])),
    },
    capture: { origin: ORIGIN, declaredCount, capturedCount: all.length, fetched },
  };
  const bytes = Buffer.from(JSON.stringify(bundle));
  if (bytes.byteLength > MAX_BYTES) fail("Serialized snapshot exceeds byte limit.");
  const output = resolve(args[outputAt + 1]!);
  await mkdir(dirname(output), { recursive: true });
  const handle = await open(output, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  console.log(
    JSON.stringify({
      output,
      sourceCount: all.length,
      rawArtifactSha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
      fetched: fetched.length,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Snapshot preparation failed.");
  process.exitCode = 1;
});
