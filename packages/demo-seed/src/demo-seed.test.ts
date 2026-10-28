import { describe, expect, test } from "bun:test";

import { createCalendar, DEMO_DAYS } from "./dates";
import { planDeviceDays } from "./device";
import { assertDisposableDemoDatabase, DemoGuardError } from "./guard";
import { demoUuid } from "./ids";
import { DEFAULT_DEMO_TODAY, parseOptions } from "./options";
import { createRandom } from "./random";

describe("assertDisposableDemoDatabase", () => {
  test.each([
    "postgres://postgres:pw@127.0.0.1:5432/openvalens_demo",
    "postgresql://localhost/openvalens_demo_test",
    "postgres://[::1]:5432/openvalens_demo_screens",
  ])("accepts the disposable %s", (url) => {
    expect(assertDisposableDemoDatabase(url)).toBe(url);
  });

  test.each([
    undefined,
    "",
    "not a url",
    "postgres://postgres:pw@127.0.0.1:5432/openvalens",
    "postgres://postgres:pw@127.0.0.1:5432/postgres",
    "postgres://postgres:pw@db.example.org:5432/openvalens_demo",
    "postgres://postgres:pw@10.0.0.5:5432/openvalens_demo",
    "postgres://127.0.0.1/openvalens_demo_Prod",
    "postgres://127.0.0.1/my_openvalens_demo",
    "postgres://127.0.0.1/openvalens_demo?host=db.example.org",
    "postgres://127.0.0.1/openvalens_demo?dbname=openvalens",
    "mysql://127.0.0.1/openvalens_demo",
  ])("refuses %p", (url) => {
    expect(() => assertDisposableDemoDatabase(url)).toThrow(DemoGuardError);
  });

  test("never echoes the URL or its credentials", () => {
    try {
      assertDisposableDemoDatabase("postgres://admin:s3cret@prod.example.org/health");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(String(error)).not.toContain("s3cret");
      expect(String(error)).not.toContain("prod.example.org");
    }
  });
});

describe("parseOptions", () => {
  test("defaults to the fixed demo day without --cloud", () => {
    expect(parseOptions([], {})).toEqual({
      ok: true,
      options: { today: DEFAULT_DEMO_TODAY, cloud: false },
    });
  });

  test("--today wins over DEMO_SEED_TODAY", () => {
    expect(
      parseOptions(["--today", "2027-01-31", "--cloud"], { DEMO_SEED_TODAY: "2026-12-01" }),
    ).toEqual({
      ok: true,
      options: { today: "2027-01-31", cloud: true },
    });
    expect(parseOptions(["--today=2027-02-01"], {})).toMatchObject({
      options: { today: "2027-02-01" },
    });
    expect(parseOptions([], { DEMO_SEED_TODAY: "2026-12-01" })).toMatchObject({
      options: { today: "2026-12-01" },
    });
  });

  test.each(["--today 2026-02-30", "--today yesterday", "--today", "--reset"])(
    "rejects %p",
    (args) => {
      expect(parseOptions(args.split(" "), {}).ok).toBe(false);
    },
  );
});

describe("determinism", () => {
  test("the same seed draws the same numbers, and forks are independent streams", () => {
    const a = createRandom();
    const b = createRandom();
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
    expect(createRandom().fork("sleep").next()).toBe(createRandom().fork("sleep").next());
    expect(createRandom().fork("sleep").next()).not.toBe(createRandom().fork("steps").next());
  });

  test("the plan is a pure function of the day", () => {
    const plan = (today: string) =>
      planDeviceDays(createCalendar(today), createRandom().fork("plan"));
    expect(plan("2026-10-28")).toEqual(plan("2026-10-28"));
    expect(plan("2026-10-28")).toHaveLength(DEMO_DAYS);
  });

  test("the calendar counts back from today in UTC", () => {
    const calendar = createCalendar("2026-03-01");
    expect(calendar.day(0)).toBe("2026-03-01");
    expect(calendar.day(1)).toBe("2026-02-28");
    expect(calendar.at(1, 7.5).toISOString()).toBe("2026-02-28T07:30:00.000Z");
    expect(calendar.offsets()[0]).toBe(DEMO_DAYS - 1);
    expect(calendar.offsets().at(-1)).toBe(0);
  });

  test("demo ids are stable, well-formed UUIDs", () => {
    expect(demoUuid("workout-2026-10-28")).toBe(demoUuid("workout-2026-10-28"));
    expect(demoUuid("a")).not.toBe(demoUuid("b"));
    expect(demoUuid("a")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("demo:seed CLI", () => {
  const cli = new URL("./cli.ts", import.meta.url).pathname;
  const run = async (env: Record<string, string>) => {
    const child = Bun.spawn(["bun", "--no-env-file", cli], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    return { stderr, code };
  };

  test("refuses a non-disposable database before connecting", async () => {
    // Port 9 (discard) is never a Postgres server: a connection attempt would
    // fail differently, so the refusal must come from the guard.
    const result = await run({ DEMO_DATABASE_URL: "postgres://u:pw@127.0.0.1:9/openvalens" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Refusing to seed");
    expect(result.stderr).not.toContain("pw@");
  });

  test("ignores DATABASE_URL", async () => {
    const result = await run({ DATABASE_URL: "postgres://u:pw@127.0.0.1:9/openvalens_demo" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Refusing to seed");
  });
});
