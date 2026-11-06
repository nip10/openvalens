import { mkdtemp, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDb, sql, type Database } from "@openvalens/db";
import {
  exercise,
  exerciseCatalogAsset,
  exerciseCatalogBootstrap,
  exerciseMedia,
} from "@openvalens/db/schema/exercises";
import {
  importExerciseCatalogSample,
  importWgerSnapshot,
  normalizeWgerSnapshot,
  sampleFrameDir,
  sampleWorkoutGuideEntries,
} from "@openvalens/exercise-catalog";
import { pngWithMetadata } from "@openvalens/body/sanitize-image.fixtures";
import { LocalObjectStorage } from "@openvalens/storage/providers/local";

import { runExerciseCatalogBootstrap, type CatalogBootstrapDeps } from "./exercise-catalog-bootstrap";
import { createExerciseCatalogAssetService } from "./exercise-catalog-assets";

/**
 * Issue #400 — the automatic, once-per-server catalog setup against a real
 * PostgreSQL: sample instances, the upstream flow (with a fake network),
 * one image source per exercise, idempotence, the lease and retries.
 */
const url = process.env.EXERCISE_CATALOG_BOOTSTRAP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/exercise_catalog_bootstrap_test"
  )
    throw new Error("Empty disposable loopback exercise_catalog_bootstrap_test database required.");
}

async function migrate(db: Database) {
  const root = new URL("../../../../packages/db/src/migrations/", import.meta.url);
  for (const directory of (await readdir(root)).sort()) {
    if (!/^\d/.test(directory)) continue;
    const text = await Bun.file(new URL(`${directory}/migration.sql`, root)).text();
    for (const statement of text.split("--> statement-breakpoint"))
      if (statement.trim()) await db.execute(sql.raw(statement));
  }
}

const quietLogger = { info() {}, warn() {} };
const CC_BY_SA_4 = 1;

function rawExercise(id: number, name: string, images: Array<{ id: number; image: string }>) {
  return {
    id,
    license: CC_BY_SA_4,
    license_author: `author-${id}`,
    category: { id: 10, name: "Legs" },
    muscles: [{ id: 10, name: "Quadriceps femoris", name_en: "Quads", is_front: true }],
    muscles_secondary: [],
    equipment: [{ id: 3, name: "Barbell" }],
    translations: [
      {
        language: 2,
        name,
        license: CC_BY_SA_4,
        license_author: `translator-${id}`,
        description: `<p>${name}</p>`,
        description_source: `${name} instructions`,
      },
    ],
    images: images.map((image) => ({
      ...image,
      license: CC_BY_SA_4,
      license_author: `photographer-${id}`,
      license_title: `Photo of ${name}`,
    })),
  };
}

/** A fake wger API: the squat (Workout Guide match), bench press (match + a wger photo) and an unmatched exercise with a wger photo. */
function fakeNetwork(photo: Uint8Array, calls: string[]) {
  const page = (results: unknown[]) =>
    new Response(JSON.stringify({ count: results.length, next: null, results }), {
      headers: { "content-type": "application/json" },
    });
  return (async (input: string | URL | Request) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(href);
    if (href === "https://wger.de/api/v2/license/?format=json")
      return page([
        {
          id: CC_BY_SA_4,
          short_name: "CC-BY-SA 4",
          url: "https://creativecommons.org/licenses/by-sa/4.0/deed.en",
        },
      ]);
    if (href === "https://wger.de/api/v2/language/?format=json")
      return page([{ id: 2, short_name: "en" }]);
    if (href === "https://wger.de/api/v2/exerciseinfo/?format=json")
      return page([
        rawExercise(615, "Squats", []),
        rawExercise(73, "Bench Press", [
          { id: 501, image: "https://wger.de/media/exercise-images/73/bench.png" },
        ]),
        rawExercise(9001, "Unmatched lift", [
          { id: 502, image: "https://wger.de/media/exercise-images/9001/lift.png" },
          { id: 503, image: "https://wger.de/media/exercise-images/9001/lift.webp" },
        ]),
      ]);
    if (href.startsWith("https://wger.de/media/exercise-images/"))
      return new Response(photo, { headers: { "content-type": "image/png" } });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

describe.skipIf(!url)("exercise catalog bootstrap (#400)", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgres://unused" });
  let root = "";
  let storage: LocalObjectStorage;
  let assets: ReturnType<typeof createExerciseCatalogAssetService>;
  let photo: Uint8Array;

  const deps = (extra: Partial<CatalogBootstrapDeps> = {}): CatalogBootstrapDeps => ({
    db,
    getAssets: async () => assets,
    logger: quietLogger,
    sampleFrameDir: sampleFrameDir(),
    loadWorkoutGuideEntries: async () => sampleWorkoutGuideEntries(),
    concurrency: 2,
    ...extra,
  });

  const readyAssets = async () =>
    db
      .select({ asset: exerciseCatalogAsset, media: exerciseMedia })
      .from(exerciseCatalogAsset)
      .innerJoin(exerciseMedia, eq(exerciseCatalogAsset.exerciseMediaId, exerciseMedia.id))
      .where(eq(exerciseCatalogAsset.state, "ready"));
  const exerciseId = async (externalId: string) => {
    const [row] = await db
      .select({ id: exercise.id })
      .from(exercise)
      .where(and(eq(exercise.source, "wger"), eq(exercise.externalId, externalId)));
    return row!.id;
  };

  beforeAll(async () => {
    const existing = await db.execute(
      sql`select count(*)::int as n from information_schema.tables where table_schema='public'`,
    );
    if (Number((existing.rows[0] as { n: number }).n) !== 0)
      throw new Error("Exercise catalog bootstrap integration database must be empty.");
    await migrate(db);
    root = await mkdtemp(join(realpathSync(tmpdir()), "ov-catalog-bootstrap-"));
    photo = new Uint8Array(await pngWithMetadata());
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate exercise_catalog_asset, exercise_media, exercise, exercise_catalog_bootstrap restart identity cascade`,
    );
    storage = new LocalObjectStorage(await mkdtemp(join(root, "store-")));
    assets = createExerciseCatalogAssetService({
      db,
      storage,
      limits: {
        maxInputBytes: 10 * 1024 * 1024,
        maxInputPixels: 16_000_000,
        maxOutputEdge: 2048,
        maxOutputBytes: 8 * 1024 * 1024,
        maxPublishedBytes: 8 * 1024 * 1024,
        storageIdentity: storage.storeIdentity,
      },
    });
  });

  afterAll(async () => {
    await db.$client.end();
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("a sample instance publishes the committed frames offline, once", async () => {
    await importExerciseCatalogSample(db);
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      calls.push(String(input));
      throw new Error("no network in sample mode");
    }) as unknown as typeof fetch;

    expect(await runExerciseCatalogBootstrap(deps({ fetch: fetchImpl }))).toEqual({
      status: "done",
    });
    expect(calls).toEqual([]);
    const ready = await readyAssets();
    expect(ready).toHaveLength(36);
    expect(ready.every((row) => row.media.source === "workout-guide")).toBe(true);
    expect(ready.every((row) => row.asset.contentType === "image/png")).toBe(true);

    const squat = await exerciseId("615");
    const [preview] = await assets.listPublishedMetadata([squat]);
    expect(preview!.media.map((item) => item.source)).toEqual([
      "workout-guide",
      "workout-guide",
      "workout-guide",
    ]);
    expect(preview!.media[0]!.author).toBe("Bryl Lim, after Everkinetic");
    expect(preview!.media[0]!.attribution).toContain("Everkinetic");
    expect(preview!.media[0]!.license).toBe("CC-BY-SA-4.0");
    expect(preview!.media.map((item) => item.sourceUrl.split("/").at(-1))).toEqual([
      "frame-1.png",
      "frame-2.png",
      "frame-3.png",
    ]);
    const served = await assets.readPublishedAsset(preview!.media[0]!.assetId);
    expect(served?.contentType).toBe("image/png");

    // Finished: a second start does nothing (no lease taken, no new rows).
    const [before] = await db.select().from(exerciseCatalogBootstrap);
    expect(await runExerciseCatalogBootstrap(deps({ fetch: fetchImpl }))).toEqual({
      status: "done",
    });
    const [after] = await db.select().from(exerciseCatalogBootstrap);
    expect(after!.attempts).toBe(before!.attempts);
    expect(await readyAssets()).toHaveLength(36);
  });

  test("a new server imports wger, links Workout Guide and keeps one image source per exercise", async () => {
    const calls: string[] = [];
    const result = await runExerciseCatalogBootstrap(
      deps({ fetch: fakeNetwork(photo, calls), sampleFrameDir: sampleFrameDir() }),
    );
    expect(result).toEqual({ status: "done" });
    const [state] = await db.select().from(exerciseCatalogBootstrap);
    expect(state!.mode).toBe("upstream");
    expect(state!.catalogImportedAt).toBeInstanceOf(Date);
    expect(state!.mediaPublishedAt).toBeInstanceOf(Date);
    expect(state!.leaseUntil).toBeNull();

    const squat = await exerciseId("615");
    const bench = await exerciseId("73");
    const unmatched = await exerciseId("9001");
    const previews = new Map(
      (await assets.listPublishedMetadata([squat, bench, unmatched])).map((entry) => [
        entry.exerciseId,
        entry.media,
      ]),
    );
    // Workout Guide wins where it has a match; the bench press photo is not published.
    expect(previews.get(squat)!.map((item) => item.source)).toEqual(
      Array(3).fill("workout-guide"),
    );
    expect(previews.get(bench)!.map((item) => item.source)).toEqual(
      Array(3).fill("workout-guide"),
    );
    expect(calls).not.toContain("https://wger.de/media/exercise-images/73/bench.png");
    // wger photo only where Workout Guide has nothing; WebP is never fetched.
    expect(previews.get(unmatched)!.map((item) => item.source)).toEqual(["wger"]);
    expect(previews.get(unmatched)![0]!.author).toBe("photographer-9001");
    expect(calls).not.toContain("https://wger.de/media/exercise-images/9001/lift.webp");

    // A later wger re-import withdraws only wger media and leaves the frames served.
    const bundle = {
      source: "wger",
      complete: true,
      snapshotVersion: "wger-later",
      snapshotAt: "2026-12-01T00:00:00.000Z",
      results: [
        {
          id: 615,
          baseLicense: {
            short_name: "CC-BY-SA-4.0",
            url: "https://creativecommons.org/licenses/by-sa/4.0/",
          },
          baseAuthor: "author-615",
          translations: [
            {
              language: { short_name: "en" },
              name: "Squats",
              sourceUrl: "https://wger.de/api/v2/exerciseinfo/615/",
              license: {
                short_name: "CC-BY-SA-4.0",
                url: "https://creativecommons.org/licenses/by-sa/4.0/",
              },
              author: "translator-615",
            },
          ],
          images: [],
        },
      ],
    };
    await importWgerSnapshot(
      db,
      normalizeWgerSnapshot(bundle, new TextEncoder().encode(JSON.stringify(bundle))),
    );
    const frames = await db
      .select()
      .from(exerciseMedia)
      .where(and(eq(exerciseMedia.exerciseId, squat), eq(exerciseMedia.source, "workout-guide")));
    expect(frames).toHaveLength(3);
    expect(frames.every((row) => row.publicationActive)).toBe(true);
    const [again] = await assets.listPublishedMetadata([squat]);
    expect(again!.media).toHaveLength(3);
    expect(await assets.readPublishedAsset(again!.media[0]!.assetId)).not.toBeNull();
  });

  test("a failed capture is recorded and retried; a held lease makes other servers wait", async () => {
    const offline = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const failed = await runExerciseCatalogBootstrap(deps({ fetch: offline }));
    expect(failed.status).toBe("pending");
    const [state] = await db.select().from(exerciseCatalogBootstrap);
    expect(state!.catalogImportedAt).toBeNull();
    expect(state!.lastError).toBe("TypeError");
    expect(state!.leaseUntil).toBeNull();
    expect(state!.attempts).toBe(1);

    await db
      .update(exerciseCatalogBootstrap)
      .set({ leaseUntil: new Date(Date.now() + 60_000) })
      .where(eq(exerciseCatalogBootstrap.id, 1));
    const calls: string[] = [];
    expect(await runExerciseCatalogBootstrap(deps({ fetch: fakeNetwork(photo, calls) }))).toEqual(
      { status: "busy" },
    );
    expect(calls).toEqual([]);

    await db
      .update(exerciseCatalogBootstrap)
      .set({ leaseUntil: new Date(Date.now() - 1) })
      .where(eq(exerciseCatalogBootstrap.id, 1));
    expect(await runExerciseCatalogBootstrap(deps({ fetch: fakeNetwork(photo, calls) }))).toEqual(
      { status: "done" },
    );
  });

  test("without object storage the catalog imports and the images wait", async () => {
    const calls: string[] = [];
    const result = await runExerciseCatalogBootstrap(
      deps({ fetch: fakeNetwork(photo, calls), getAssets: async () => null }),
    );
    expect(result).toEqual({ status: "pending", reason: "storage_off" });
    const [state] = await db.select().from(exerciseCatalogBootstrap);
    expect(state!.catalogImportedAt).toBeInstanceOf(Date);
    expect(state!.mediaPublishedAt).toBeNull();
    // Storage appears later: only the images step runs, the catalog is not captured again.
    const later: string[] = [];
    expect(await runExerciseCatalogBootstrap(deps({ fetch: fakeNetwork(photo, later) }))).toEqual({
      status: "done",
    });
    expect(later.some((href) => href.includes("/api/v2/"))).toBe(false);
  });
});
