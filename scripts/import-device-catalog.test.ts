import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCatalog,
  checkCatalog,
  normalizeTimestamp,
  parseArgs,
  serializeCatalog,
  sha256Hex,
} from "./import-device-catalog";

const REVISION = "a".repeat(40);
const RETRIEVED_AT = "2026-11-09T16:33:39Z";

// Small synthetic snapshot. It mirrors the upstream shape (anchors,
// vendor_mappings, device_support) without copying the 90 KB source.
const FIXTURE = `__aliases:
  - &flags_high_free [feature_high, pair_free, feature_high]
  - &flags_ring [feature_most, pair_zepp, os_zepp]
  - &link_fw ../../../internals/specifics/x
vendor_mappings:
  wearables:
    honor: huawei-honor
  rings:
    colmi: yawell
device_support:
  watch_honor:
    category: wearables
    vendor: honor
    flags: *flags_high_free
    links:
      protocol: *link_fw
      firmware_info: *link_fw
  ring_colmi:
    category: rings
    vendor: colmi
    flags: *flags_ring
  bare_device:
    category: wearables
    vendor: acme
    flags: [pair_free]
  experimental_device:
    category: others
    vendor: acme
    flags: [feature_unknown, pair_unknown, experimental]
`;

const FIXTURE_BYTES = new TextEncoder().encode(FIXTURE);
const FIXTURE_SHA = sha256Hex(FIXTURE_BYTES);

function fixtureCatalog() {
  return buildCatalog(FIXTURE, {
    revision: REVISION,
    retrievedAt: RETRIEVED_AT,
    sha256: FIXTURE_SHA,
  });
}

const temporaryDirs: string[] = [];

function writeFixturePair(artifact = serializeCatalog(fixtureCatalog())) {
  const dir = mkdtempSync(join(tmpdir(), "device-catalog-test-"));
  temporaryDirs.push(dir);
  const sourcePath = join(dir, "device_support.yml");
  const artifactPath = join(dir, "gadgetbridge-catalog.json");
  writeFileSync(sourcePath, FIXTURE);
  writeFileSync(artifactPath, artifact);
  return { sourcePath, artifactPath };
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("catalog normalization", () => {
  test("resolves aliases through anchors", () => {
    const catalog = fixtureCatalog();
    expect(catalog.devices.watch_honor.flags).toEqual(["feature_high", "pair_free"]);
    expect(catalog.devices.watch_honor.links).toEqual({
      firmware_info: "../../../internals/specifics/x",
      protocol: "../../../internals/specifics/x",
    });
  });

  test("applies vendor_mappings per category", () => {
    const catalog = fixtureCatalog();
    expect(catalog.devices.watch_honor.vendor).toBe("honor");
    expect(catalog.devices.watch_honor.resolvedVendor).toBe("huawei-honor");
    expect(catalog.devices.ring_colmi.vendor).toBe("colmi");
    expect(catalog.devices.ring_colmi.resolvedVendor).toBe("yawell");
    // A vendor without a mapping keeps its upstream value.
    expect(catalog.devices.bare_device.resolvedVendor).toBe("acme");
  });

  test("normalizes flags, feature level, pair mode, os and experimental", () => {
    const catalog = fixtureCatalog();
    expect(catalog.devices.ring_colmi).toMatchObject({
      featureLevel: "most",
      pairMode: "zepp",
      os: "zepp",
      experimental: false,
    });
    expect(catalog.devices.bare_device).toMatchObject({
      flags: ["pair_free"],
      featureLevel: "unknown",
      pairMode: "free",
      os: null,
      experimental: false,
    });
    expect(catalog.devices.experimental_device).toMatchObject({
      featureLevel: "unknown",
      pairMode: "unknown",
      os: null,
      experimental: true,
    });
  });

  test("is deterministic across runs", () => {
    const first = serializeCatalog(fixtureCatalog());
    const second = serializeCatalog(fixtureCatalog());
    expect(first).toBe(second);
    // Device keys and flag lists are sorted.
    expect(first.indexOf('"bare_device"')).toBeLessThan(first.indexOf('"ring_colmi"'));
  });

  test("records provenance and device count", () => {
    const catalog = fixtureCatalog();
    expect(catalog.meta).toMatchObject({
      source: "device_support.yml",
      repository: "https://codeberg.org/Freeyourgadget/website",
      sourceUrl: `https://codeberg.org/Freeyourgadget/website/raw/commit/${REVISION}/device_support.yml`,
      revision: REVISION,
      retrievedAt: RETRIEVED_AT,
      sha256: FIXTURE_SHA,
      license: "AGPL-3.0-or-later",
      deviceCount: 4,
    });
    expect(catalog.meta.attribution).toContain(`revision ${REVISION}.`);
  });
});

describe("checkCatalog", () => {
  test("accepts a matching source and artifact", async () => {
    const result = await checkCatalog(writeFixturePair());
    expect(result).toEqual({ ok: true, deviceCount: 4, sha256: FIXTURE_SHA });
  });

  test("detects a SHA-256 mismatch", async () => {
    const paths = writeFixturePair();
    const artifact = readFileSync(paths.artifactPath, "utf8").replace(FIXTURE_SHA, "0".repeat(64));
    writeFileSync(paths.artifactPath, artifact);

    const result = await checkCatalog(paths);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("SHA-256 mismatch");
  });

  test("detects artifact drift", async () => {
    const paths = writeFixturePair();
    const artifact = readFileSync(paths.artifactPath, "utf8").replace(
      '"featureLevel": "high"',
      '"featureLevel": "most"',
    );
    writeFileSync(paths.artifactPath, artifact);

    const result = await checkCatalog(paths);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("does not match");
      expect(result.details).toContain("featureLevel");
    }
  });

  test("detects a deviceCount mismatch", async () => {
    const paths = writeFixturePair();
    const artifact = readFileSync(paths.artifactPath, "utf8").replace(
      '"deviceCount": 4',
      '"deviceCount": 3',
    );
    writeFileSync(paths.artifactPath, artifact);

    const result = await checkCatalog(paths);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("deviceCount mismatch");
  });
});

describe("CLI contract", () => {
  test("defaults to offline check", () => {
    expect(parseArgs([])).toEqual({ ok: true, command: { mode: "check" } });
    expect(parseArgs(["--check"])).toEqual({ ok: true, command: { mode: "check" } });
  });

  test("prints help", () => {
    expect(parseArgs(["--help"])).toEqual({ ok: true, command: { mode: "help" } });
  });

  test("accepts a full commit SHA", () => {
    expect(parseArgs(["--revision", REVISION])).toMatchObject({
      ok: true,
      command: { mode: "refresh", revision: REVISION },
    });
  });

  test("rejects branch names and short revisions", () => {
    const branch = parseArgs(["--revision", "main"]);
    expect(branch.ok).toBe(false);
    if (!branch.ok) expect(branch.error).toContain("40-character");

    expect(parseArgs(["--revision", "abc123"]).ok).toBe(false);
    expect(parseArgs(["--revision", REVISION.slice(0, 39)]).ok).toBe(false);
  });

  test("rejects contradictory or incomplete options", () => {
    expect(parseArgs(["--check", "--revision", REVISION]).ok).toBe(false);
    expect(parseArgs(["--retrieved-at", RETRIEVED_AT]).ok).toBe(false);
    expect(parseArgs(["--revision"]).ok).toBe(false);
    expect(parseArgs(["--unknown"]).ok).toBe(false);
  });
});

describe("normalizeTimestamp", () => {
  test("uses UTC seconds precision", () => {
    expect(normalizeTimestamp("2026-11-09T16:33:39.123Z")).toBe("2026-11-09T16:33:39Z");
    expect(normalizeTimestamp(new Date("2026-11-09T18:33:39+02:00"))).toBe("2026-11-09T16:33:39Z");
  });

  test("rejects invalid timestamps", () => {
    expect(normalizeTimestamp("not-a-date")).toBeNull();
  });
});
