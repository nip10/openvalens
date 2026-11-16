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
    // The default demo keeps its zone label and never reads the clock.
    expect(calendar.timeZone).toBe("Europe/London");
    expect(calendar.until.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  test("a zoned calendar puts hours on that zone's wall clock", () => {
    const calendar = createCalendar("2026-11-16", { timeZone: "America/Los_Angeles" });
    expect(calendar.timeZone).toBe("America/Los_Angeles");
    // 07:30 in Los Angeles (PST, UTC-8), and the evening before.
    expect(calendar.at(0, 7.5).toISOString()).toBe("2026-11-16T15:30:00.000Z");
    expect(calendar.at(0, -1.5).toISOString()).toBe("2026-11-16T06:30:00.000Z");
    // Summer time (PDT, UTC-7).
    expect(calendar.at(130, 7.5).toISOString()).toBe("2026-07-09T14:30:00.000Z");
    // The repeated hour when summer time ends is the earlier one; the hour
    // skipped when it starts moves forward.
    const autumn = createCalendar("2026-11-01", { timeZone: "America/Los_Angeles" });
    expect(autumn.at(0, 1.5).toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(autumn.at(0, 3).toISOString()).toBe("2026-11-01T11:00:00.000Z");
    const spring = createCalendar("2026-03-08", { timeZone: "America/Los_Angeles" });
    expect(spring.at(0, 2.5).toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(spring.at(0, 1.5).toISOString()).toBe("2026-03-08T09:30:00.000Z");
    expect(() => createCalendar("2026-11-16", { timeZone: "Mars/Olympus" })).toThrow();
  });

  test("nothing is later than now", () => {
    const now = new Date("2026-11-16T09:28:00Z"); // 01:28 in Los Angeles
    const calendar = createCalendar("2026-11-16", { timeZone: "America/Los_Angeles", now });
    expect(calendar.until).toEqual(now);
    expect(calendar.past(calendar.at(0, 1))).toBe(true);
    expect(calendar.past(calendar.at(0, 7.5))).toBe(false);
    expect(calendar.clamp(calendar.at(0, 9))).toEqual(now);
    // A `now` after the end of today stops at the end of today.
    const late = createCalendar("2026-11-15", { timeZone: "America/Los_Angeles", now });
    expect(late.until.toISOString()).toBe("2026-11-16T08:00:00.000Z");
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
