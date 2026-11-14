import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

import { isMemberPrivateEvent, isMemberPrivateMetric, ownOrUnattributed } from "./member-private";
import { healthEvent } from "./schema/health-record";

const dialect = new PgDialect();

describe("ownOrUnattributed (#509, the workout rule)", () => {
  test("a member reads their own rows and rows with no author", () => {
    const query = dialect.sqlToQuery(ownOrUnattributed(healthEvent.userId, "user-a"));
    expect(query.sql).toBe(
      '(("health_event"."user_id" = $1) or (("health_event"."user_id" is null)))',
    );
    expect(query.params).toEqual(["user-a"]);
  });

  test("with no member, only rows with no author match", () => {
    for (const userId of [null, undefined, ""]) {
      const query = dialect.sqlToQuery(ownOrUnattributed(healthEvent.userId, userId));
      expect(query.sql).toBe('("health_event"."user_id" is null)');
      expect(query.params).toEqual([]);
    }
  });
});

describe("isMemberPrivateMetric", () => {
  test("weigh-ins, body composition and sleep belong to their member", () => {
    for (const code of ["weight", "body_fat", "muscle_mass", "bone_mass", "body_water"])
      expect(isMemberPrivateMetric(code)).toBe(true);
    expect(isMemberPrivateMetric("sleep_duration")).toBe(true);
  });

  test("other metrics stay with the workspace", () => {
    for (const code of ["heart_rate", "resting_heart_rate", "steps", "height", "blood_marker"])
      expect(isMemberPrivateMetric(code)).toBe(false);
  });
});

describe("isMemberPrivateEvent", () => {
  test("sleep nights and device workouts belong to their member", () => {
    expect(isMemberPrivateEvent("sleep_session")).toBe(true);
    expect(isMemberPrivateEvent("workout")).toBe(true);
  });

  test("other events stay with the workspace", () => {
    for (const type of ["mindfulness_session", "menstruation_period", "medication"])
      expect(isMemberPrivateEvent(type)).toBe(false);
  });
});
